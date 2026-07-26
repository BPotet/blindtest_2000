// Contrat de types partagé entre le serveur et le client Blindtest 2000.
// (Le client vanilla ne l'importe pas directement, mais ces types documentent
//  la forme exacte des évènements Socket.IO échangés.)

export type ClipSource = 'youtube';

/** Une manche telle que stockée côté serveur (contient la réponse — jamais envoyée aux joueurs). */
export interface Round {
  id: string;
  /** ID de la vidéo YouTube (pas l'URL complète). */
  youtubeId: string;
  /** Seconde de départ de l'extrait dans la vidéo. */
  startSeconds: number;
  /** Durée de l'extrait joué sur l'écran de l'hôte. */
  durationSeconds: number;
  /** L'intitulé de la question posée aux joueurs. */
  question: string;
  /** Les propositions du QCM (2 à 6). */
  options: string[];
  /** Index de la bonne réponse dans `options`. */
  correctIndex: number;
  /** Le titre/artiste révélé après la manche. */
  answerLabel: string;
}

export interface Quiz {
  id: string;
  title: string;
  rounds: Round[];
}

/** La vue d'une manche envoyée aux JOUEURS — sans la réponse ni la vidéo. */
export interface PublicRound {
  roundIndex: number;
  totalRounds: number;
  question: string;
  options: string[];
  durationSeconds: number;
}

/** La vue d'une manche envoyée à l'HÔTE — contient de quoi jouer et révéler. */
export interface HostRound extends PublicRound {
  youtubeId: string;
  startSeconds: number;
  correctIndex: number;
  answerLabel: string;
}

export type RoomState = 'lobby' | 'playing' | 'roundResult' | 'ended';

export interface PlayerView {
  id: string;
  pseudo: string;
  score: number;
  connected: boolean;
}

export interface LeaderboardEntry {
  playerId: string;
  pseudo: string;
  score: number;
  rank: number;
}

/** Résultat d'une manche pour un joueur donné. */
export interface PlayerRoundResult {
  correct: boolean;
  pointsAwarded: number;
  correctIndex: number;
  answerLabel: string;
  totalScore: number;
}
