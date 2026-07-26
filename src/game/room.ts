import type {
  Quiz,
  RoomState,
  PlayerView,
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
}

interface RecordedAnswer {
  optionIndex: number;
  /** Temps de réponse mesuré côté serveur (ms depuis le début de la manche). */
  elapsedMs: number;
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
  private readonly players = new Map<string, Player>();
  private answers = new Map<string, RecordedAnswer>();
  createdAt = Date.now();
  lastActivityAt = Date.now();

  constructor(quiz: Quiz, code = generateRoomCode()) {
    this.quiz = quiz;
    this.code = code;
    this.hostToken = generateId('host');
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

  /** Ajoute un joueur (uniquement dans le lobby). Renvoie le joueur ou une erreur. */
  addPlayer(rawPseudo: string, socketId: string): { player: PlayerView } | { error: string } {
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
    const player: Player = {
      id: generateId('p'),
      pseudo,
      score: 0,
      connected: true,
      socketId,
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

  get playerCount(): number {
    return this.players.size;
  }

  hasAnswered(playerId: string): boolean {
    return this.answers.has(playerId);
  }

  // ---- Déroulé de la partie ---------------------------------------------

  /** Démarre la manche suivante. Renvoie les vues hôte + joueur, ou null si terminé. */
  startNextRound(now = Date.now()): { hostRound: HostRound; publicRound: PublicRound } | null {
    if (this.state !== 'lobby' && this.state !== 'roundResult') return null;
    if (this.isLastRound() && this.currentRoundIndex >= 0) return null;

    this.currentRoundIndex += 1;
    const round = this.quiz.rounds[this.currentRoundIndex];
    if (!round) return null;

    this.state = 'playing';
    this.roundStartedAt = now;
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
    const player = this.players.get(playerId);
    if (!player) {
      return { accepted: false, reason: 'Joueur inconnu.' };
    }
    if (this.answers.has(playerId)) {
      return { accepted: false, reason: 'Réponse déjà enregistrée.' };
    }
    const round = this.quiz.rounds[this.currentRoundIndex];
    if (!round || optionIndex < 0 || optionIndex >= round.options.length) {
      return { accepted: false, reason: 'Réponse invalide.' };
    }
    this.answers.set(playerId, { optionIndex, elapsedMs: now - this.roundStartedAt });
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
    perPlayer: Map<string, PlayerRoundResult>;
  } | null {
    if (this.state !== 'playing') return null;
    const round = this.quiz.rounds[this.currentRoundIndex];
    if (!round) return null;

    const answerWindowMs = round.durationSeconds * 1000;
    const perPlayer = new Map<string, PlayerRoundResult>();

    for (const player of this.players.values()) {
      const answer = this.answers.get(player.id);
      const correct = answer?.optionIndex === round.correctIndex;
      const pointsAwarded = answer
        ? computeScore({ correct, elapsedMs: answer.elapsedMs, answerWindowMs })
        : 0;
      player.score += pointsAwarded;
      perPlayer.set(player.id, {
        correct,
        pointsAwarded,
        correctIndex: round.correctIndex,
        answerLabel: round.answerLabel,
        totalScore: player.score,
      });
    }

    this.state = 'roundResult';
    this.touch();
    return { correctIndex: round.correctIndex, answerLabel: round.answerLabel, perPlayer };
  }

  endGame(): void {
    this.state = 'ended';
    this.touch();
  }

  leaderboard(): LeaderboardEntry[] {
    const ranked = rankPlayers(
      [...this.players.values()].map((p) => ({ id: p.id, pseudo: p.pseudo, score: p.score })),
    );
    return ranked.map((p) => ({ playerId: p.id, pseudo: p.pseudo, score: p.score, rank: p.rank }));
  }

  private toView(player: Player): PlayerView {
    return {
      id: player.id,
      pseudo: player.pseudo,
      score: player.score,
      connected: player.connected,
    };
  }
}

/** Gère l'ensemble des salles actives et garantit l'unicité des codes. */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  create(quiz: Quiz): Room {
    let code = generateRoomCode();
    while (this.rooms.has(code)) {
      code = generateRoomCode();
    }
    const room = new Room(quiz, code);
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
