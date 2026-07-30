import type {
  Quiz,
  RoomState,
  RoomMode,
  PlayerView,
  TeamView,
  LeaderboardEntry,
  PublicRound,
  HostRound,
  PlayerRoundResult,
} from '../types';
import { computeScore, rankPlayers, streakBonus } from './scoring';
import { generateRoomCode, generateId } from './codes';

export const MAX_PSEUDO_LENGTH = 24;

interface Player {
  id: string;
  pseudo: string;
  score: number;
  connected: boolean;
  socketId: string | null;
  teamId: string | null;
  /** Série de bonnes réponses consécutives (mode solo). */
  streak: number;
}

interface Team {
  id: string;
  name: string;
  /** Score cumulé de l'équipe (une réponse commune par manche). */
  score: number;
  /** Série de bonnes réponses consécutives (mode équipes). */
  streak: number;
}

interface RecordedAnswer {
  optionIndex: number;
  /** Temps de réponse mesuré côté serveur (ms depuis le début de la manche). */
  elapsedMs: number;
  /** Joueur ayant réellement répondu (pour l'équipe, le premier à voter). */
  byPlayerId: string;
}

/** Stats cumulées d'une unité (joueur/équipe) sur toute la partie, pour le palmarès. */
interface UnitStats {
  name: string;
  fastestWins: number; // nb de manches où l'unité a été la plus rapide (bonne réponse)
  slowestWins: number; // nb de manches où elle a été la plus lente (bonne réponse)
  buzzerWins: number; // nb de bonnes réponses données dans la dernière seconde
  maxStreak: number; // plus longue série de bonnes réponses atteinte
  correctRounds: number; // nb de manches trouvées
  answeredRounds: number; // nb de manches où elle a répondu
  firstRank: number | null; // rang après la 1re manche notée
  lastRank: number; // rang courant (mis à jour à chaque manche)
}

/** Un titre décerné en fin de partie (palmarès). */
export interface Award {
  key: string;
  emoji: string;
  title: string;
  winner: string;
  detail: string;
}

/**
 * Détermine l'option gagnante d'un vote d'équipe : plus grand nombre de voix,
 * départage par le vote le plus précoce (la première option vers laquelle
 * l'équipe a penché). Renvoie null si aucun vote.
 */
function teamWinner(
  votes: Map<string, { optionIndex: number; atMs: number }>,
): { optionIndex: number; count: number } | null {
  const acc = new Map<number, { count: number; earliest: number }>();
  for (const v of votes.values()) {
    const e = acc.get(v.optionIndex) ?? { count: 0, earliest: Infinity };
    e.count += 1;
    e.earliest = Math.min(e.earliest, v.atMs);
    acc.set(v.optionIndex, e);
  }
  let best: { optionIndex: number; count: number; earliest: number } | null = null;
  for (const [optionIndex, { count, earliest }] of acc) {
    if (!best || count > best.count || (count === best.count && earliest < best.earliest)) {
      best = { optionIndex, count, earliest };
    }
  }
  return best ? { optionIndex: best.optionIndex, count: best.count } : null;
}

/**
 * Une salle de jeu isolée. Toute la logique de partie (état, réponses, scoring)
 * vit ici ; la couche Socket.IO ne fait qu'appeler ces méthodes et diffuser les
 * résultats. Aucune donnée d'une salle n'est accessible depuis une autre.
 */
export class Room {
  readonly code: string;
  readonly hostToken: string;
  readonly quiz: Quiz;
  hostSocketId: string | null = null;

  private state: RoomState = 'lobby';
  private currentRoundIndex = -1;
  private roundStartedAt = 0;
  /** Vrai une fois que l'extrait a réellement commencé à jouer chez l'hôte. */
  private clipStarted = false;
  /** Manche en pause (l'hôte a mis en pause). */
  private paused = false;
  private pausedAt = 0;
  private readonly players = new Map<string, Player>();
  private readonly teams = new Map<string, Team>();
  private answers = new Map<string, RecordedAnswer>();
  // Mode équipes : votes par membre + réponse verrouillée par équipe.
  private teamVotes = new Map<string, Map<string, { optionIndex: number; atMs: number }>>();
  private teamLock = new Map<string, { optionIndex: number; elapsedMs: number }>();
  /** Stats cumulées de la partie (par nom d'unité), pour le palmarès de fin. */
  private gameStats = new Map<string, UnitStats>();
  readonly mode: RoomMode;
  readonly comboEnabled: boolean;
  /** Son joué sur le téléphone des joueurs (opt-in de l'hôte). */
  readonly playerAudio: boolean;
  /** Révélation manuelle : la manche attend l'hôte après le minuteur. */
  readonly manualReveal: boolean;
  /** Réponses closes (fin du minuteur) mais manche pas encore révélée. */
  private answersClosed = false;
  createdAt = Date.now();
  lastActivityAt = Date.now();

  constructor(
    quiz: Quiz,
    code = generateRoomCode(),
    mode: RoomMode = 'solo',
    comboEnabled = true,
    playerAudio = false,
    manualReveal = false,
  ) {
    this.quiz = quiz;
    this.code = code;
    this.mode = mode;
    this.comboEnabled = comboEnabled;
    this.playerAudio = playerAudio;
    this.manualReveal = manualReveal;
    this.hostToken = generateId('host');
  }

  getMode(): RoomMode {
    return this.mode;
  }

  private touch(): void {
    this.lastActivityAt = Date.now();
  }

  getState(): RoomState {
    return this.state;
  }

  getCurrentRoundIndex(): number {
    return this.currentRoundIndex;
  }

  get totalRounds(): number {
    return this.quiz.rounds.length;
  }

  isLastRound(): boolean {
    return this.currentRoundIndex >= this.quiz.rounds.length - 1;
  }

  // ---- Joueurs -----------------------------------------------------------

  /**
   * Ajoute un joueur (uniquement dans le lobby). En mode équipes, `rawTeamName`
   * est requis : le joueur rejoint l'équipe existante de ce nom, ou la crée.
   */
  addPlayer(
    rawPseudo: string,
    socketId: string,
    rawTeamName?: string,
  ): { player: PlayerView } | { error: string } {
    if (this.state !== 'lobby') {
      return { error: 'La partie a déjà commencé.' };
    }
    const pseudo = rawPseudo.trim().slice(0, MAX_PSEUDO_LENGTH);
    if (pseudo.length === 0) {
      return { error: 'Choisis un pseudo.' };
    }
    const taken = [...this.players.values()].some(
      (p) => p.pseudo.toLowerCase() === pseudo.toLowerCase(),
    );
    if (taken) {
      return { error: 'Ce pseudo est déjà pris dans cette salle.' };
    }

    let teamId: string | null = null;
    if (this.mode === 'teams') {
      const teamName = (rawTeamName ?? '').trim().slice(0, MAX_PSEUDO_LENGTH);
      if (teamName.length === 0) {
        return { error: 'Choisis ou crée une équipe.' };
      }
      const existing = [...this.teams.values()].find(
        (t) => t.name.toLowerCase() === teamName.toLowerCase(),
      );
      const team = existing ?? { id: generateId('t'), name: teamName, score: 0, streak: 0 };
      if (!existing) this.teams.set(team.id, team);
      teamId = team.id;
    }

    const player: Player = {
      id: generateId('p'),
      pseudo,
      score: 0,
      connected: true,
      socketId,
      teamId,
      streak: 0,
    };
    this.players.set(player.id, player);
    this.touch();
    return { player: this.toView(player) };
  }

  /** Reconnecte un joueur existant sur un nouveau socket. */
  reconnectPlayer(playerId: string, socketId: string): PlayerView | null {
    const player = this.players.get(playerId);
    if (!player) return null;
    player.socketId = socketId;
    player.connected = true;
    this.touch();
    return this.toView(player);
  }

  markDisconnected(socketId: string): PlayerView | null {
    for (const player of this.players.values()) {
      if (player.socketId === socketId) {
        player.connected = false;
        player.socketId = null;
        this.touch();
        return this.toView(player);
      }
    }
    return null;
  }

  getPlayer(playerId: string): PlayerView | null {
    const player = this.players.get(playerId);
    return player ? this.toView(player) : null;
  }

  listPlayers(): PlayerView[] {
    return [...this.players.values()].map((p) => this.toView(p));
  }

  /** Équipes avec leur nombre de membres et leur score commun (mode équipes). */
  listTeams(): TeamView[] {
    return [...this.teams.values()].map((t) => ({
      id: t.id,
      name: t.name,
      memberCount: [...this.players.values()].filter((p) => p.teamId === t.id).length,
      score: t.score,
    }));
  }

  get playerCount(): number {
    return this.players.size;
  }

  /** Une unité a "répondu" = solo : le joueur a voté ; équipes : l'équipe est verrouillée. */
  hasAnswered(playerId: string): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;
    if (this.mode === 'teams') return player.teamId ? this.teamLock.has(player.teamId) : false;
    return this.answers.has(playerId);
  }

  /** Nombre d'unités ayant validé leur réponse (équipes verrouillées / joueurs ayant voté). */
  answeredUnitCount(): number {
    return this.mode === 'teams' ? this.teamLock.size : this.answers.size;
  }

  /**
   * Répartition EN DIRECT des réponses reçues jusqu'ici (index = proposition),
   * pour que l'hôte voie où penchent les joueurs pendant que l'extrait joue.
   * En équipes : réponses verrouillées par équipe ; en solo : réponses des joueurs.
   */
  liveDistribution(): number[] {
    const round = this.quiz.rounds[this.currentRoundIndex];
    if (!round) return [];
    const dist = new Array<number>(round.options.length).fill(0);
    const bump = (i: number): void => { if (i >= 0 && i < dist.length) dist[i] += 1; };
    if (this.mode === 'teams') {
      for (const lock of this.teamLock.values()) bump(lock.optionIndex);
    } else {
      for (const a of this.answers.values()) bump(a.optionIndex);
    }
    return dist;
  }

  /** Nombre total d'unités pouvant répondre (équipes en mode équipes, sinon joueurs). */
  respondentCount(): number {
    return this.mode === 'teams' ? this.teams.size : this.players.size;
  }

  /** Sockets connectés de tous les membres d'une équipe (pour diffuser le tally). */
  getTeamMemberSocketIds(teamId: string): string[] {
    return [...this.players.values()]
      .filter((p) => p.teamId === teamId && p.socketId)
      .map((p) => p.socketId as string);
  }

  /** État de vote courant d'une équipe (pour affichage du tally + verrouillage). */
  getTeamVoteState(teamId: string): {
    counts: number[];
    voted: number;
    connected: number;
    locked: boolean;
    lockedIndex: number | null;
  } {
    const round = this.quiz.rounds[this.currentRoundIndex];
    const optionCount = round ? round.options.length : 0;
    const counts = new Array<number>(optionCount).fill(0);
    const votes = this.teamVotes.get(teamId);
    if (votes) {
      for (const v of votes.values()) {
        if (v.optionIndex >= 0 && v.optionIndex < optionCount) counts[v.optionIndex] += 1;
      }
    }
    const connected = [...this.players.values()].filter(
      (p) => p.teamId === teamId && p.connected,
    ).length;
    const lock = this.teamLock.get(teamId);
    return {
      counts,
      voted: votes ? votes.size : 0,
      connected,
      locked: !!lock,
      lockedIndex: lock ? lock.optionIndex : null,
    };
  }

  private finalTeamAnswer(
    teamId: string,
    answerWindowMs: number,
  ): { optionIndex: number; elapsedMs: number } | null {
    const lock = this.teamLock.get(teamId);
    if (lock) return lock;
    const votes = this.teamVotes.get(teamId);
    if (!votes || votes.size === 0) return null;
    const winner = teamWinner(votes);
    // Pas de verrouillage anticipé -> pas de bonus de vitesse (fenêtre pleine).
    return winner ? { optionIndex: winner.optionIndex, elapsedMs: answerWindowMs } : null;
  }

  // ---- Déroulé de la partie ---------------------------------------------

  /**
   * Prépare la manche suivante (charge la vidéo côté hôte). La fenêtre de
   * réponse ne s'ouvre PAS ici : elle démarre à `markClipStarted()`, quand
   * l'extrait joue réellement — pour ne pas pénaliser les joueurs pendant le
   * chargement de la vidéo. Renvoie les vues hôte + joueur, ou null si terminé.
   */
  startNextRound(): { hostRound: HostRound; publicRound: PublicRound } | null {
    if (this.state !== 'lobby' && this.state !== 'roundResult') return null;
    if (this.isLastRound() && this.currentRoundIndex >= 0) return null;

    this.currentRoundIndex += 1;
    if (!this.quiz.rounds[this.currentRoundIndex]) return null;

    // Nouvelle partie : on repart d'un palmarès vierge.
    if (this.currentRoundIndex === 0) this.gameStats.clear();

    return this.openRoundState();
  }

  /**
   * Rejoue la manche EN COURS : réponses effacées, minuteur remis à zéro, tout
   * le monde peut répondre à nouveau (« nouvelle chance » quand personne n'a
   * reconnu l'extrait). N'avance pas la manche et ne touche ni aux scores ni au
   * palmarès (rien n'était encore appliqué : le scoring a lieu à la révélation).
   */
  replayRound(): { hostRound: HostRound; publicRound: PublicRound } | null {
    if (this.state !== 'playing') return null;
    return this.openRoundState();
  }

  /** Réinitialise l'état de manche (réponses, minuteur) et construit les vues. */
  private openRoundState(): { hostRound: HostRound; publicRound: PublicRound } | null {
    const round = this.quiz.rounds[this.currentRoundIndex];
    if (!round) return null;

    this.state = 'playing';
    this.clipStarted = false;
    this.paused = false;
    this.pausedAt = 0;
    this.roundStartedAt = 0;
    this.answersClosed = false;
    this.answers = new Map();
    this.teamVotes = new Map();
    this.teamLock = new Map();
    this.touch();

    const publicRound: PublicRound = {
      roundIndex: this.currentRoundIndex,
      totalRounds: this.totalRounds,
      question: round.question,
      options: [...round.options],
      durationSeconds: round.durationSeconds,
    };
    const hostRound: HostRound = {
      ...publicRound,
      youtubeId: round.youtubeId,
      startSeconds: round.startSeconds,
      correctIndex: round.correctIndex,
      answerLabel: round.answerLabel,
    };
    return { hostRound, publicRound };
  }

  /**
   * Marque le vrai début de l'extrait : ouvre la fenêtre de réponse et fixe
   * l'origine des temps pour le scoring. Idempotent par manche.
   */
  markClipStarted(now = Date.now()): boolean {
    if (this.state !== 'playing' || this.clipStarted) return false;
    this.clipStarted = true;
    this.roundStartedAt = now;
    this.touch();
    return true;
  }

  isClipStarted(): boolean {
    return this.clipStarted;
  }

  isPaused(): boolean {
    return this.paused;
  }

  /** Met la manche en pause (gèle la fenêtre de réponse). */
  pause(now = Date.now()): boolean {
    if (this.state !== 'playing' || this.paused) return false;
    this.paused = true;
    this.pausedAt = now;
    this.touch();
    return true;
  }

  /** Reprend la manche : le temps de pause est exclu du chrono de scoring. */
  resume(now = Date.now()): boolean {
    if (!this.paused) return false;
    this.roundStartedAt += now - this.pausedAt;
    this.paused = false;
    this.touch();
    return true;
  }

  /** Passe la manche en cours sans la noter (aucun point, séries inchangées). */
  skipRound(): boolean {
    if (this.state !== 'playing') return false;
    this.state = 'roundResult';
    this.paused = false;
    this.touch();
    return true;
  }

  /** Exclut un joueur de la salle. Renvoie son socketId pour le prévenir. */
  removePlayer(playerId: string): string | null {
    const player = this.players.get(playerId);
    if (!player) return null;
    const socketId = player.socketId;
    this.players.delete(playerId);
    this.answers.delete(playerId);
    for (const votes of this.teamVotes.values()) votes.delete(playerId);
    this.touch();
    return socketId;
  }

  /**
   * Enregistre la réponse d'un joueur. Le temps de réponse est mesuré ici, côté
   * serveur (jamais fourni par le client). Le premier tap verrouille.
   */
  submitAnswer(
    playerId: string,
    optionIndex: number,
    now = Date.now(),
  ): { accepted: true; teamId?: string } | { accepted: false; reason: string } {
    if (this.state !== 'playing') {
      return { accepted: false, reason: 'Aucune manche en cours.' };
    }
    if (!this.clipStarted) {
      return { accepted: false, reason: "L'extrait n'a pas encore démarré." };
    }
    if (this.paused) {
      return { accepted: false, reason: 'Manche en pause.' };
    }
    if (this.answersClosed) {
      return { accepted: false, reason: 'Temps écoulé.' };
    }
    const player = this.players.get(playerId);
    if (!player) {
      return { accepted: false, reason: 'Joueur inconnu.' };
    }
    const round = this.quiz.rounds[this.currentRoundIndex];
    if (!round || optionIndex < 0 || optionIndex >= round.options.length) {
      return { accepted: false, reason: 'Réponse invalide.' };
    }

    if (this.mode === 'teams') {
      const teamId = player.teamId;
      if (!teamId) return { accepted: false, reason: 'Aucune équipe.' };
      if (this.teamLock.has(teamId)) {
        return { accepted: false, reason: 'Ton équipe a déjà validé sa réponse.' };
      }
      let votes = this.teamVotes.get(teamId);
      if (!votes) {
        votes = new Map();
        this.teamVotes.set(teamId, votes);
      }
      votes.set(playerId, { optionIndex, atMs: now - this.roundStartedAt }); // vote modifiable
      // Pas de verrouillage automatique : un membre doit verrouiller (lockTeam),
      // sinon la fin du timer tranchera avec la réponse la plus votée.
      this.touch();
      return { accepted: true, teamId };
    }

    // Solo : première (et unique) réponse du joueur.
    if (this.answers.has(playerId)) {
      return { accepted: false, reason: 'Réponse déjà enregistrée.' };
    }
    this.answers.set(playerId, {
      optionIndex,
      elapsedMs: now - this.roundStartedAt,
      byPlayerId: playerId,
    });
    this.touch();
    return { accepted: true };
  }

  /**
   * Verrouille la réponse d'une équipe à la demande d'un de ses membres. La
   * réponse retenue est la plus votée (départage : le vote le plus précoce).
   */
  lockTeam(playerId: string, now = Date.now()): { locked: true; teamId: string } | { locked: false; reason: string } {
    if (this.mode !== 'teams') return { locked: false, reason: 'Pas en mode équipes.' };
    if (this.state !== 'playing') return { locked: false, reason: 'Aucune manche en cours.' };
    const player = this.players.get(playerId);
    if (!player || !player.teamId) return { locked: false, reason: 'Aucune équipe.' };
    const teamId = player.teamId;
    if (this.teamLock.has(teamId)) return { locked: false, reason: 'Déjà verrouillé.' };
    const votes = this.teamVotes.get(teamId);
    const winner = votes ? teamWinner(votes) : null;
    if (!winner) return { locked: false, reason: 'Votez avant de verrouiller.' };
    this.teamLock.set(teamId, { optionIndex: winner.optionIndex, elapsedMs: now - this.roundStartedAt });
    this.touch();
    return { locked: true, teamId };
  }

  /**
   * Clôt la manche en cours, calcule et applique les scores.
   * Renvoie le résultat par joueur + les infos de révélation.
   */
  endRound(): {
    correctIndex: number;
    answerLabel: string;
    options: string[];
    /** ID vidéo YouTube de la manche — dévoilé au résultat (payoff : miniature). */
    youtubeId: string;
    /** Nombre de réponses reçues par proposition (index = proposition). */
    distribution: number[];
    answeredCount: number;
    correctCount: number;
    totalPlayers: number;
    /** Unité ayant répondu la première (bonne OU mauvaise) — la « main la plus rapide ». */
    fastest: { name: string; elapsedMs: number } | null;
    /** Unité ayant répondu la dernière, ou n'ayant pas répondu — la « main la plus lente ». */
    slowest: { name: string; elapsedMs: number } | null;
    /** La main la plus lente a répondu dans la dernière seconde (« au buzzer »). */
    atBuzzer: boolean;
    /** La main la plus lente n'a en fait pas répondu (a laissé filer le temps). */
    slowestNoAnswer: boolean;
    /** Nom de l'unité si elle est la SEULE à avoir trouvé (« seul contre tous »). */
    soloCorrect: string | null;
    /** Proposition (leurre) la plus cochée parmi les mauvaises — le « piège du jour ». */
    topTrap: string | null;
    /** Tout le monde a trouvé (« carton plein »). */
    allCorrect: boolean;
    /** Des gens ont répondu mais personne n'a trouvé. */
    noneCorrect: boolean;
    perPlayer: Map<string, PlayerRoundResult>;
  } | null {
    if (this.state !== 'playing') return null;
    const round = this.quiz.rounds[this.currentRoundIndex];
    if (!round) return null;

    const answerWindowMs = round.durationSeconds * 1000;
    const perPlayer = new Map<string, PlayerRoundResult>();
    const distribution = new Array<number>(round.options.length).fill(0);
    let answeredCount = 0;
    let correctCount = 0;

    // Toutes les réponses de la manche (bonnes OU mauvaises) + les unités qui n'ont
    // PAS répondu. On en déduit la main la plus rapide / la plus lente (réflexes,
    // pas justesse ; ne pas répondre = la plus lente) et « seul contre tous » (justesse).
    const allHands: Array<{ name: string; elapsedMs: number }> = [];
    const nonAnswerers: string[] = [];
    const correctNames: string[] = [];
    // Récupère/crée la fiche de stats cumulées d'une unité (par nom, unique dans la salle).
    const stat = (name: string): UnitStats => {
      let s = this.gameStats.get(name);
      if (!s) {
        s = { name, fastestWins: 0, slowestWins: 0, buzzerWins: 0, maxStreak: 0, correctRounds: 0, answeredRounds: 0, firstRank: null, lastRank: 0 };
        this.gameStats.set(name, s);
      }
      return s;
    };

    // Comptabilise une réponse d'unité (équipe ou joueur) dans les stats de manche.
    const tally = (answer: RecordedAnswer | undefined): { correct: boolean; points: number } => {
      const correct = answer?.optionIndex === round.correctIndex;
      const points = answer
        ? computeScore({ correct, elapsedMs: answer.elapsedMs, answerWindowMs })
        : 0;
      if (answer) {
        answeredCount += 1;
        if (answer.optionIndex >= 0 && answer.optionIndex < distribution.length) {
          distribution[answer.optionIndex] += 1;
        }
      }
      if (correct) correctCount += 1;
      return { correct, points };
    };

    if (this.mode === 'teams') {
      // Réponse commune décidée au vote : tous les membres partagent le résultat.
      for (const team of this.teams.values()) {
        const final = this.finalTeamAnswer(team.id, answerWindowMs);
        const correct = final ? final.optionIndex === round.correctIndex : false;
        const base = final ? computeScore({ correct, elapsedMs: final.elapsedMs, answerWindowMs }) : 0;
        let comboBonus = 0;
        if (correct) {
          team.streak += 1;
          comboBonus = this.comboEnabled ? streakBonus(team.streak) : 0;
          correctNames.push(team.name);
        } else {
          team.streak = 0;
        }
        if (final) allHands.push({ name: team.name, elapsedMs: final.elapsedMs });
        else nonAnswerers.push(team.name);
        const ts = stat(team.name);
        if (final) ts.answeredRounds += 1;
        if (correct) ts.correctRounds += 1;
        ts.maxStreak = Math.max(ts.maxStreak, team.streak);
        const awarded = base + comboBonus;
        team.score += awarded;
        if (final) {
          answeredCount += 1;
          if (final.optionIndex >= 0 && final.optionIndex < distribution.length) {
            distribution[final.optionIndex] += 1;
          }
        }
        if (correct) correctCount += 1;
        for (const p of this.players.values()) {
          if (p.teamId !== team.id) continue;
          perPlayer.set(p.id, {
            correct,
            pointsAwarded: awarded,
            correctIndex: round.correctIndex,
            answerLabel: round.answerLabel,
            totalScore: team.score,
            answeredBy: null,
            streak: team.streak,
            comboBonus,
          });
        }
      }
    } else {
      for (const player of this.players.values()) {
        const ans = this.answers.get(player.id);
        const { correct, points } = tally(ans);
        let comboBonus = 0;
        if (correct) {
          player.streak += 1;
          comboBonus = this.comboEnabled ? streakBonus(player.streak) : 0;
          correctNames.push(player.pseudo);
        } else {
          player.streak = 0;
        }
        if (ans) allHands.push({ name: player.pseudo, elapsedMs: ans.elapsedMs });
        else nonAnswerers.push(player.pseudo);
        const ps = stat(player.pseudo);
        if (ans) ps.answeredRounds += 1;
        if (correct) ps.correctRounds += 1;
        ps.maxStreak = Math.max(ps.maxStreak, player.streak);
        const awarded = points + comboBonus;
        player.score += awarded;
        perPlayer.set(player.id, {
          correct,
          pointsAwarded: awarded,
          correctIndex: round.correctIndex,
          answerLabel: round.answerLabel,
          totalScore: player.score,
          streak: player.streak,
          comboBonus,
        });
      }
    }

    // Mains la plus rapide / la plus lente parmi TOUTES les réponses (justes ou
    // fausses) : ce sont les réflexes qui comptent, pas la justesse.
    let fastest: { name: string; elapsedMs: number } | null = null;
    let slowest: { name: string; elapsedMs: number } | null = null;
    for (const h of allHands) {
      if (!fastest || h.elapsedMs < fastest.elapsedMs) fastest = h;
      if (!slowest || h.elapsedMs > slowest.elapsedMs) slowest = h;
    }
    // « Même si tu ne réponds pas, ça compte » : ne pas répondre = avoir laissé
    // filer tout le temps -> tu deviens la main la plus lente (dès que quelqu'un
    // d'autre a, lui, répondu).
    let slowestNoAnswer = false;
    if (allHands.length > 0 && nonAnswerers.length > 0) {
      slowest = { name: nonAnswerers[0], elapsedMs: answerWindowMs };
      slowestNoAnswer = true;
    }
    // « Seul contre tous » : une seule unité a trouvé (la justesse compte ici).
    const soloCorrect = correctNames.length === 1 ? correctNames[0] : null;
    // « Au buzzer » : la main la plus lente a bien répondu, dans la dernière seconde.
    const atBuzzer = slowest !== null && !slowestNoAnswer && slowest.elapsedMs >= answerWindowMs - 1000;

    // Badges de manche (depuis la répartition des votes) :
    // « Piège du jour » = le leurre (mauvaise proposition) le plus coché.
    let topTrap: string | null = null;
    let topTrapVotes = 0;
    for (let i = 0; i < distribution.length; i += 1) {
      if (i === round.correctIndex) continue;
      if (distribution[i] > topTrapVotes) { topTrapVotes = distribution[i]; topTrap = round.options[i]; }
    }
    if (topTrapVotes === 0) topTrap = null;
    // « Carton plein » = toutes les unités ont trouvé ; « Personne ! » = des gens
    // ont répondu mais aucune bonne réponse.
    const allCorrect = this.respondentCount() > 0 && correctCount === this.respondentCount();
    const noneCorrect = answeredCount > 0 && correctCount === 0;

    // Cumule les victoires de manche pour le palmarès de fin.
    if (fastest) stat(fastest.name).fastestWins += 1;
    if (slowest) {
      stat(slowest.name).slowestWins += 1;
      if (atBuzzer) stat(slowest.name).buzzerWins += 1;
    }
    // Mémorise les rangs (1re et courante) pour la « remontada ».
    for (const entry of this.leaderboard()) {
      const s = stat(entry.pseudo);
      if (s.firstRank === null) s.firstRank = entry.rank;
      s.lastRank = entry.rank;
    }

    this.state = 'roundResult';
    this.touch();
    return {
      correctIndex: round.correctIndex,
      answerLabel: round.answerLabel,
      options: [...round.options],
      youtubeId: round.youtubeId,
      distribution,
      answeredCount,
      correctCount,
      totalPlayers: this.respondentCount(),
      fastest,
      slowest,
      atBuzzer,
      slowestNoAnswer,
      soloCorrect,
      topTrap,
      allCorrect,
      noneCorrect,
      perPlayer,
    };
  }

  /**
   * Palmarès de fin de partie : décerne des titres à partir des stats cumulées.
   * Un titre n'est décerné que s'il a un gagnant pertinent (sinon omis).
   */
  computeAwards(): Award[] {
    const stats = [...this.gameStats.values()];
    const awards: Award[] = [];
    // Sélectionne l'unité qui maximise `score`, à condition de dépasser `min`.
    const best = (score: (s: UnitStats) => number, min = 1): UnitStats | null => {
      let winner: UnitStats | null = null;
      let bestScore = -Infinity;
      for (const s of stats) {
        const v = score(s);
        if (v > bestScore) { bestScore = v; winner = s; }
      }
      return winner && bestScore >= min ? winner : null;
    };

    const eclair = best((s) => s.fastestWins);
    if (eclair) awards.push({ key: 'eclair', emoji: '⚡', title: "L'Éclair", winner: eclair.name, detail: `${eclair.fastestWins} main(s) la plus rapide` });

    const tranquille = best((s) => s.slowestWins);
    if (tranquille) awards.push({ key: 'tranquille', emoji: '🐢', title: 'Le Tranquille', winner: tranquille.name, detail: `${tranquille.slowestWins} réponse(s) au ralenti` });

    const serie = best((s) => s.maxStreak, 2);
    if (serie) awards.push({ key: 'serie', emoji: '🔥', title: 'Meilleure série', winner: serie.name, detail: `série de ${serie.maxStreak}` });

    const sniper = best((s) => s.correctRounds);
    if (sniper) awards.push({ key: 'sniper', emoji: '🎯', title: 'Sniper', winner: sniper.name, detail: `${sniper.correctRounds} bonne(s) réponse(s)` });

    const remontada = best((s) => (s.firstRank !== null ? s.firstRank - s.lastRank : 0));
    if (remontada && remontada.firstRank !== null) {
      awards.push({ key: 'remontada', emoji: '🎢', title: 'Remontada', winner: remontada.name, detail: `+${remontada.firstRank - remontada.lastRank} place(s)` });
    }
    return awards;
  }

  /**
   * Clôt la fenêtre de réponses sans révéler (fin du minuteur en mode révélation
   * manuelle) : plus aucune réponse acceptée, mais la manche reste « en cours »
   * tant que l'hôte n'a pas révélé. Idempotent. Renvoie false si non applicable.
   */
  closeAnswers(): boolean {
    if (this.state !== 'playing' || this.answersClosed) return false;
    this.answersClosed = true;
    this.touch();
    return true;
  }

  /** Les réponses de la manche en cours sont-elles closes (attente de révélation) ? */
  areAnswersClosed(): boolean {
    return this.answersClosed;
  }

  endGame(): void {
    this.state = 'ended';
    this.touch();
  }

  /**
   * Annule la partie en cours : retour au lobby, scores et séries remis à zéro.
   * Les joueurs restent dans la salle (ils patientent), l'hôte peut relancer.
   */
  cancelGame(): boolean {
    if (this.state === 'lobby') return false;
    this.state = 'lobby';
    this.currentRoundIndex = -1;
    this.clipStarted = false;
    this.paused = false;
    this.pausedAt = 0;
    this.roundStartedAt = 0;
    this.answersClosed = false;
    this.answers = new Map();
    this.teamVotes = new Map();
    this.teamLock = new Map();
    for (const p of this.players.values()) { p.score = 0; p.streak = 0; }
    for (const t of this.teams.values()) { t.score = 0; t.streak = 0; }
    this.gameStats.clear();
    this.touch();
    return true;
  }

  /**
   * Classement : par équipe en mode équipes (score = somme des membres), par
   * joueur en mode solo. Dans les deux cas, `playerId` porte l'identifiant de
   * l'entité classée (joueur ou équipe) et `pseudo` son nom.
   */
  leaderboard(): LeaderboardEntry[] {
    if (this.mode === 'teams') return this.teamLeaderboard();
    const ranked = rankPlayers(
      [...this.players.values()].map((p) => ({ id: p.id, pseudo: p.pseudo, score: p.score })),
    );
    return ranked.map((p) => ({ playerId: p.id, pseudo: p.pseudo, score: p.score, rank: p.rank }));
  }

  private teamLeaderboard(): LeaderboardEntry[] {
    const ranked = rankPlayers(
      this.listTeams().map((t) => ({ id: t.id, pseudo: t.name, score: t.score })),
    );
    return ranked.map((t) => ({ playerId: t.id, pseudo: t.pseudo, score: t.score, rank: t.rank }));
  }

  private toView(player: Player): PlayerView {
    const team = player.teamId ? this.teams.get(player.teamId) : null;
    return {
      id: player.id,
      pseudo: player.pseudo,
      score: player.score,
      connected: player.connected,
      teamId: player.teamId,
      teamName: team ? team.name : null,
    };
  }
}

/** Gère l'ensemble des salles actives et garantit l'unicité des codes. */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  create(
    quiz: Quiz,
    mode: RoomMode = 'solo',
    comboEnabled = true,
    playerAudio = false,
    manualReveal = false,
  ): Room {
    let code = generateRoomCode();
    while (this.rooms.has(code)) {
      code = generateRoomCode();
    }
    const room = new Room(quiz, code, mode, comboEnabled, playerAudio, manualReveal);
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  remove(code: string): void {
    this.rooms.delete(code.toUpperCase());
  }

  get size(): number {
    return this.rooms.size;
  }

  /** Supprime les salles terminées ou inactives depuis `maxIdleMs`. */
  pruneStale(maxIdleMs: number, now = Date.now()): number {
    let removed = 0;
    for (const [code, room] of this.rooms) {
      const idle = now - room.lastActivityAt;
      if (room.getState() === 'ended' || idle > maxIdleMs) {
        this.rooms.delete(code);
        removed += 1;
      }
    }
    return removed;
  }
}
