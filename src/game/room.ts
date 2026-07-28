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
  readonly mode: RoomMode;
  readonly comboEnabled: boolean;
  /** Son joué sur le téléphone des joueurs (opt-in de l'hôte). */
  readonly playerAudio: boolean;
  createdAt = Date.now();
  lastActivityAt = Date.now();

  constructor(
    quiz: Quiz,
    code = generateRoomCode(),
    mode: RoomMode = 'solo',
    comboEnabled = true,
    playerAudio = false,
  ) {
    this.quiz = quiz;
    this.code = code;
    this.mode = mode;
    this.comboEnabled = comboEnabled;
    this.playerAudio = playerAudio;
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
    const round = this.quiz.rounds[this.currentRoundIndex];
    if (!round) return null;

    this.state = 'playing';
    this.clipStarted = false;
    this.paused = false;
    this.pausedAt = 0;
    this.roundStartedAt = 0;
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
    /** Nombre de réponses reçues par proposition (index = proposition). */
    distribution: number[];
    answeredCount: number;
    correctCount: number;
    totalPlayers: number;
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
        } else {
          team.streak = 0;
        }
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
        const { correct, points } = tally(this.answers.get(player.id));
        let comboBonus = 0;
        if (correct) {
          player.streak += 1;
          comboBonus = this.comboEnabled ? streakBonus(player.streak) : 0;
        } else {
          player.streak = 0;
        }
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

    this.state = 'roundResult';
    this.touch();
    return {
      correctIndex: round.correctIndex,
      answerLabel: round.answerLabel,
      options: [...round.options],
      distribution,
      answeredCount,
      correctCount,
      totalPlayers: this.respondentCount(),
      perPlayer,
    };
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
    this.answers = new Map();
    this.teamVotes = new Map();
    this.teamLock = new Map();
    for (const p of this.players.values()) { p.score = 0; p.streak = 0; }
    for (const t of this.teams.values()) { t.score = 0; t.streak = 0; }
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

  create(quiz: Quiz, mode: RoomMode = 'solo', comboEnabled = true, playerAudio = false): Room {
    let code = generateRoomCode();
    while (this.rooms.has(code)) {
      code = generateRoomCode();
    }
    const room = new Room(quiz, code, mode, comboEnabled, playerAudio);
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
