// Miroir navigateur des noms d'évènements Socket.IO — exposé en `window.BT_EVENTS`.
//
// Source unique côté serveur : `src/events.ts`. Ce fichier en est le miroir pour
// le client vanilla (pas de build/bundler). Le drift-guard `src/events.test.ts`
// évalue ce fichier dans un bac à sable et échoue si une paire clé→valeur diffère
// de `src/events.ts` — impossible donc de les désynchroniser en silence.
//
// À charger AVANT common.js/host.js/player.js dans les pages qui ouvrent un socket.
(function (root) {
  root.BT_EVENTS = {
    // Hôte
    HOST_CREATE_ROOM: 'host:createRoom',
    HOST_ROOM_CREATED: 'host:roomCreated',
    HOST_START_ROUND: 'host:startRound',
    HOST_CLIP_STARTED: 'host:clipStarted',
    HOST_END_ROUND: 'host:endRound',
    HOST_TIME_UP: 'host:timeUp',
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

    // Joueur
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

    // Salle
    ROOM_PLAYERS: 'room:players',
    ROOM_TEAMS: 'room:teams',

    // Manche
    ROUND_RESULT: 'round:result',
    ROUND_TIME_UP: 'round:timeUp',
    ROUND_PAUSED: 'round:paused',
    ROUND_RESUMED: 'round:resumed',
    ROUND_SKIPPED: 'round:skipped',
    ROUND_AUTO_NEXT: 'round:autoNext',

    // Partie
    GAME_ENDED: 'game:ended',
    GAME_CANCELLED: 'game:cancelled',
  };
})(typeof window !== 'undefined' ? window : this);
