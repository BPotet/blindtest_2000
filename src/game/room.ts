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
import { computeScore, rankPlayers } from './scoring';
import { generateRoomCode, generateId } from './codes';

export const MAX_PSEUDO_LENGTH = 24;

interface Player {
  id: string;
  pseudo: string;
  score: number;
  connected: boolean;
  socketId: string | null;
  teamId: string | null;
}

interface Team {
  id: string;
  name: string;
  /** Score cumulé de l'équipe (une réponse commune par manche). */
  score: number;
}

interface RecordedAnswer {
  optionIndex: number;
  /** Temps de réponse mesuré côté serveur (ms depuis le début de la manche). */
  elapsedMs: number;
  /** Joueur ayant réellement répondu (pour l'équipe, le premier à voter). */
  byPlayerId: string;
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
  private readonly players = new Map<string, Player>();
  private readonly teams = new Map<string, Team>();
  private answers = new Map<string, RecordedAnswer>();
  readonly mode: RoomMode;
  createdAt = Date.now();
  lastActivityAt = Date.now();

  constructor(quiz: Quiz, code = generateRoomCode(), mode: RoomMode = 'solo') {
    this.quiz = quiz;
    this.code = code;
    this.mode = mode;
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
      const team = existing ?? { id: generateId('t'), name: teamName, score: 0 };
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

  /** Identifiant de l'unité qui répond : l'équipe en mode équipes, sinon le joueur. */
  private unitIdOf(player: Player): string | null {
    return this.mode === 'teams' ? player.teamId : player.id;
  }

  hasAnswered(playerId: string): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;
    const unitId = this.unitIdOf(player);
    return unitId ? this.answers.has(unitId) : false;
  }

  /** Nombre d'unités ayant déjà répondu à la manche en cours. */
  answeredUnitCount(): number {
    return this.answers.size;
  }

  /** Nombre total d'unités pouvant répondre (équipes en mode équipes, sinon joueurs). */
  respondentCount(): number {
    return this.mode === 'teams' ? this.teams.size : this.players.size;
  }

  /** Sockets connectés des autres membres de l'équipe du joueur (pour verrouiller). */
  getTeammateSocketIds(playerId: string): string[] {
    const player = this.players.get(playerId);
    if (!player || !player.teamId) return [];
    return [...this.players.values()]
      .filter((p) => p.teamId === player.teamId && p.id !== playerId && p.socketId)
      .map((p) => p.socketId as string);
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
    this.roundStartedAt = 0;
    this.answers = new Map();
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

  /**
   * Enregistre la réponse d'un joueur. Le temps de réponse est mesuré ici, côté
   * serveur (jamais fourni par le client). Le premier tap verrouille.
   */
  submitAnswer(
    playerId: string,
    optionIndex: number,
    now = Date.now(),
  ): { accepted: true } | { accepted: false; reason: string } {
    if (this.state !== 'playing') {
      return { accepted: false, reason: 'Aucune manche en cours.' };
    }
    if (!this.clipStarted) {
      return { accepted: false, reason: "L'extrait n'a pas encore démarré." };
    }
    const player = this.players.get(playerId);
    if (!player) {
      return { accepted: false, reason: 'Joueur inconnu.' };
    }
    const unitId = this.unitIdOf(player);
    if (!unitId) {
      return { accepted: false, reason: 'Aucune équipe.' };
    }
    if (this.answers.has(unitId)) {
      return {
        accepted: false,
        reason: this.mode === 'teams' ? 'Ton équipe a déjà répondu.' : 'Réponse déjà enregistrée.',
      };
    }
    const round = this.quiz.rounds[this.currentRoundIndex];
    if (!round || optionIndex < 0 || optionIndex >= round.options.length) {
      return { accepted: false, reason: 'Réponse invalide.' };
    }
    this.answers.set(unitId, { optionIndex, elapsedMs: now - this.roundStartedAt, byPlayerId: playerId });
    this.touch();
    return { accepted: true };
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
      // Une seule réponse par équipe : tous les membres partagent le résultat.
      for (const team of this.teams.values()) {
        const answer = this.answers.get(team.id);
        const { correct, points } = tally(answer);
        team.score += points;
        const answeredBy = answer ? this.players.get(answer.byPlayerId)?.pseudo ?? null : null;
        for (const p of this.players.values()) {
          if (p.teamId !== team.id) continue;
          perPlayer.set(p.id, {
            correct,
            pointsAwarded: points,
            correctIndex: round.correctIndex,
            answerLabel: round.answerLabel,
            totalScore: team.score,
            answeredBy,
          });
        }
      }
    } else {
      for (const player of this.players.values()) {
        const { correct, points } = tally(this.answers.get(player.id));
        player.score += points;
        perPlayer.set(player.id, {
          correct,
          pointsAwarded: points,
          correctIndex: round.correctIndex,
          answerLabel: round.answerLabel,
          totalScore: player.score,
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

  create(quiz: Quiz, mode: RoomMode = 'solo'): Room {
    let code = generateRoomCode();
    while (this.rooms.has(code)) {
      code = generateRoomCode();
    }
    const room = new Room(quiz, code, mode);
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
