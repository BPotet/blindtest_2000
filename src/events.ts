// Source unique et typée des noms d'évènements Socket.IO (côté serveur).
//
// Le client vanilla ne peut pas importer ce module TS ; son miroir est
// `public/js/events.js` (exposé en `window.BT_EVENTS`). Les deux fichiers sont
// tenus synchronisés par le drift-guard `src/events.test.ts`, qui échoue si la
// moindre paire clé→valeur diffère. Un typo devient donc une erreur de
// compilation (serveur) ou un test rouge (client), plus un bug réseau silencieux.
export const EVENTS = {
  // Hôte → serveur / serveur → hôte
  HOST_CREATE_ROOM: 'host:createRoom',
  HOST_ROOM_CREATED: 'host:roomCreated',
  HOST_START_ROUND: 'host:startRound',
  HOST_CLIP_STARTED: 'host:clipStarted',
  HOST_END_ROUND: 'host:endRound',
  HOST_ROUND_STARTED: 'host:roundStarted',
  HOST_PAUSE_ROUND: 'host:pauseRound',
  HOST_RESUME_ROUND: 'host:resumeRound',
  HOST_SKIP_ROUND: 'host:skipRound',
  HOST_KICK_PLAYER: 'host:kickPlayer',
  HOST_END_GAME: 'host:endGame',
  HOST_CANCEL_GAME: 'host:cancelGame',
  HOST_RECONNECT: 'host:reconnect',
  HOST_SNAPSHOT: 'host:snapshot',
  HOST_ANSWER_UPDATE: 'host:answerUpdate',
  HOST_AUTO_NEXT: 'host:autoNext',
  HOST_BEGIN_COUNTDOWN: 'host:beginCountdown',
  HOST_ERROR: 'host:error',

  // Joueur → serveur / serveur → joueur
  PLAYER_JOIN: 'player:join',
  PLAYER_JOINED: 'player:joined',
  PLAYER_ANSWER: 'player:answer',
  PLAYER_ANSWER_ACCEPTED: 'player:answerAccepted',
  PLAYER_ANSWER_REJECTED: 'player:answerRejected',
  PLAYER_ROUND_LOADING: 'player:roundLoading',
  PLAYER_ROUND_STARTED: 'player:roundStarted',
  PLAYER_COUNTDOWN: 'player:countdown',
  PLAYER_SNAPSHOT: 'player:snapshot',
  PLAYER_RECONNECT: 'player:reconnect',
  PLAYER_KICKED: 'player:kicked',
  PLAYER_WATCH_ROOM: 'player:watchRoom',
  PLAYER_TEAM_VOTES: 'player:teamVotes',
  PLAYER_TEAM_LOCK: 'player:teamLock',
  PLAYER_ERROR: 'player:error',

  // Diffusions dans la salle
  ROOM_PLAYERS: 'room:players',
  ROOM_TEAMS: 'room:teams',

  // Cycle de manche
  ROUND_RESULT: 'round:result',
  ROUND_PAUSED: 'round:paused',
  ROUND_RESUMED: 'round:resumed',
  ROUND_SKIPPED: 'round:skipped',
  ROUND_AUTO_NEXT: 'round:autoNext',

  // Fin de partie
  GAME_ENDED: 'game:ended',
  GAME_CANCELLED: 'game:cancelled',
} as const;

export type EventKey = keyof typeof EVENTS;
export type EventName = (typeof EVENTS)[EventKey];
