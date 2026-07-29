import { createServer, type Server as HttpServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express, { type Express, type RequestHandler, type Request } from 'express';
import { Server as IOServer, type Socket } from 'socket.io';
import QRCode from 'qrcode';
import { ZodError } from 'zod';

import { MemoryQuizStore, canAccessQuiz, type QuizRepository } from './game/store';
import { RoomManager, type Room } from './game/room';
import {
  createRoomSchema,
  joinRoomSchema,
  reconnectSchema,
  hostReconnectSchema,
  answerSchema,
  kickSchema,
  resumeSchema,
  autoNextSchema,
  watchRoomSchema,
  credentialsSchema,
  importYoutubeSchema,
  createQuizSchema,
  type CreateQuizInput,
} from './validation';
import {
  parseYouTubePlaylistId,
  buildRoundsFromVideos,
  fetchPlaylistVideos,
  YouTubeImportError,
  type PlaylistVideo,
} from './game/youtube-import';
import {
  loadAuthConfig,
  hashPassword,
  verifyPassword,
  verifySession,
  createSession,
  parseCookies,
  buildSessionCookie,
  clearSessionCookie,
  SESSION_COOKIE,
  type AuthConfig,
} from './auth';
import type { PublicRound } from './types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const ROOM_IDLE_MS = 3 * 60 * 60 * 1000; // 3 h d'inactivité

interface SocketData {
  role?: 'host' | 'player';
  code?: string;
  playerId?: string;
  userId?: string;
}

export interface BuiltServer {
  app: Express;
  httpServer: HttpServer;
  io: IOServer;
  quizRepo: QuizRepository;
  roomManager: RoomManager;
}

/**
 * Construit l'application (HTTP + WebSocket) sans démarrer l'écoute.
 * `quizRepo` peut être injecté (Postgres en prod) ; par défaut, stockage mémoire.
 */
export function buildServer(
  opts: {
    quizRepo?: QuizRepository;
    authConfig?: AuthConfig;
    youtubeApiKey?: string;
    youtubeFetcher?: (playlistId: string) => Promise<PlaylistVideo[]>;
  } = {},
): BuiltServer {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  const quizRepo = opts.quizRepo ?? new MemoryQuizStore();
  const authConfig = opts.authConfig ?? loadAuthConfig();
  const roomManager = new RoomManager();

  // Import YouTube : actif seulement si une clé API est fournie (ou un fetcher
  // injecté en test). Sinon l'endpoint répond 503 et l'UI masque la fonction.
  const youtubeApiKey = opts.youtubeApiKey ?? process.env.YOUTUBE_API_KEY;
  const youtubeFetcher =
    opts.youtubeFetcher ??
    // On récupère jusqu'à 200 morceaux : les manches jouées sont un tirage
    // aléatoire là-dedans et les mauvaises réponses viennent de toute la playlist.
    (youtubeApiKey ? (id: string) => fetchPlaylistVideos(id, youtubeApiKey, undefined, 200) : null);
  const youtubeImportEnabled = Boolean(youtubeFetcher);

  const sessionUserId = (req: Request): string | null => {
    const cookies = parseCookies(req.headers.cookie);
    return verifySession(cookies[SESSION_COOKIE], authConfig.sessionSecret)?.uid ?? null;
  };

  const requireAuth: RequestHandler = (req, res, next) => {
    const uid = sessionUserId(req);
    if (!uid) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    res.locals.userId = uid;
    next();
  };

  // Anti-abus : brute-force de connexion et spam d'inscriptions (par IP).
  const loginLimiter = createRateLimiter(10, 60_000);
  const registerLimiter = createRateLimiter(10, 60_000);
  const tooMany = (res: import('express').Response): void => {
    res.status(429).json({ error: 'too_many_requests', message: 'Trop de tentatives, réessaie dans une minute.' });
  };

  // ---- Routes HTTP ------------------------------------------------------

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', rooms: roomManager.size, uptime: process.uptime() });
  });

  // ---- Authentification -------------------------------------------------

  // Inscription libre : n'importe qui peut créer un compte hôte et obtient
  // aussitôt une session. Chaque hôte ne voit que ses propres playlists (+ démos).
  app.post('/api/register', async (req, res) => {
    if (!registerLimiter(req)) { tooMany(res); return; }
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_input', message: parsed.error.issues[0]?.message });
      return;
    }
    const user = await quizRepo.createUser(
      parsed.data.username,
      hashPassword(parsed.data.password),
    );
    if (!user) {
      res.status(409).json({ error: 'username_taken', message: 'Ce nom est déjà pris.' });
      return;
    }
    res.setHeader(
      'Set-Cookie',
      buildSessionCookie(createSession(user.id, authConfig.sessionSecret), authConfig),
    );
    res.status(201).json({ username: user.username, youtubeImport: youtubeImportEnabled });
  });

  app.post('/api/login', async (req, res) => {
    if (!loginLimiter(req)) { tooMany(res); return; }
    const username = typeof req.body?.username === 'string' ? req.body.username : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const user = await quizRepo.getUserByUsername(username);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      res.status(401).json({ error: 'invalid_credentials' });
      return;
    }
    res.setHeader(
      'Set-Cookie',
      buildSessionCookie(createSession(user.id, authConfig.sessionSecret), authConfig),
    );
    res.json({ username: user.username, youtubeImport: youtubeImportEnabled });
  });

  app.post('/api/logout', (_req, res) => {
    res.setHeader('Set-Cookie', clearSessionCookie(authConfig));
    res.json({ ok: true });
  });

  app.get('/api/me', async (req, res) => {
    const uid = sessionUserId(req);
    const user = uid ? await quizRepo.getUserById(uid) : undefined;
    if (!user) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    res.json({ username: user.username, youtubeImport: youtubeImportEnabled });
  });

  // Import « semi-automatique » d'une playlist YouTube -> brouillon de quiz que
  // l'hôte relit dans le constructeur avant d'enregistrer.
  app.post('/api/import/youtube', requireAuth, async (req, res) => {
    if (!youtubeFetcher) {
      res.status(503).json({
        error: 'import_disabled',
        message: "L'import YouTube n'est pas configuré sur ce serveur (variable YOUTUBE_API_KEY).",
      });
      return;
    }
    const parsed = importYoutubeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_input', message: parsed.error.issues[0]?.message });
      return;
    }
    const playlistId = parseYouTubePlaylistId(parsed.data.url);
    if (!playlistId) {
      res.status(400).json({ error: 'invalid_playlist', message: 'Lien de playlist YouTube invalide.' });
      return;
    }
    try {
      const videos = await youtubeFetcher(playlistId);
      const rounds = buildRoundsFromVideos(videos, {
        startSeconds: parsed.data.startSeconds,
        durationSeconds: parsed.data.durationSeconds,
        maxRounds: parsed.data.maxRounds,
      });
      if (rounds.length === 0 || rounds.some((r) => r.options.length < 2)) {
        res.status(422).json({
          error: 'not_enough',
          message: 'Playlist trop courte ou titres trop similaires (2 morceaux distincts minimum).',
        });
        return;
      }
      const title = parsed.data.title?.trim() || 'Blindtest importé';
      if (parsed.data.save) {
        // Mode « surprise » : on crée le quiz directement et on ne renvoie JAMAIS
        // les morceaux — l'hôte ne connaît ni les questions ni les réponses.
        const quiz = await quizRepo.create(
          res.locals.userId as string,
          title,
          rounds.map((r) => ({
            youtubeId: r.youtube,
            startSeconds: r.startSeconds,
            durationSeconds: r.durationSeconds,
            question: r.question,
            options: r.options,
            correctIndex: r.correctIndex,
            answerLabel: r.answerLabel,
          })),
        );
        res.status(201).json({ id: quiz.id, title: quiz.title, count: quiz.rounds.length });
        return;
      }
      res.json({ title, rounds, count: rounds.length });
    } catch (err) {
      if (err instanceof YouTubeImportError) {
        // 404 = lien fautif (client) ; le reste = souci en amont.
        res.status(err.status === 404 ? 404 : 502).json({ error: 'import_failed', message: err.message });
        return;
      }
      res.status(502).json({ error: 'import_failed', message: "Échec de l'import YouTube." });
    }
  });

  app.get('/api/quizzes', requireAuth, async (_req, res) => {
    try {
      res.json({ quizzes: await quizRepo.list(res.locals.userId as string) });
    } catch {
      res.status(500).json({ error: 'server_error' });
    }
  });

  app.post('/api/quizzes', requireAuth, async (req, res) => {
    try {
      const input = createQuizSchema.parse(req.body);
      const quiz = await quizRepo.create(
        res.locals.userId as string,
        input.title,
        mapValidatedRounds(input.rounds),
      );
      res.status(201).json({ id: quiz.id, title: quiz.title, roundCount: quiz.rounds.length });
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({ error: 'invalid_quiz', issues: err.issues });
        return;
      }
      res.status(500).json({ error: 'server_error' });
    }
  });

  app.get('/api/quizzes/:id', requireAuth, async (req, res) => {
    const quiz = await quizRepo.get(req.params.id);
    if (!quiz || !canAccessQuiz(quiz, res.locals.userId as string)) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(quiz);
  });

  app.put('/api/quizzes/:id', requireAuth, async (req, res) => {
    try {
      const input = createQuizSchema.parse(req.body);
      const quiz = await quizRepo.update(
        req.params.id,
        res.locals.userId as string,
        input.title,
        mapValidatedRounds(input.rounds),
      );
      if (!quiz) {
        res.status(404).json({ error: 'not_found_or_forbidden' });
        return;
      }
      res.json({ id: quiz.id, title: quiz.title, roundCount: quiz.rounds.length });
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({ error: 'invalid_quiz', issues: err.issues });
        return;
      }
      res.status(500).json({ error: 'server_error' });
    }
  });

  app.delete('/api/quizzes/:id', requireAuth, async (req, res) => {
    const ok = await quizRepo.delete(req.params.id, res.locals.userId as string);
    if (!ok) {
      res.status(404).json({ error: 'not_found_or_forbidden' });
      return;
    }
    res.json({ ok: true });
  });

  app.get('/api/room/:code', (req, res) => {
    const room = roomManager.get(req.params.code);
    if (!room) {
      res.status(404).json({ error: 'room_not_found' });
      return;
    }
    res.json({
      code: room.code,
      state: room.getState(),
      quizTitle: room.quiz.title,
      totalRounds: room.totalRounds,
      playerCount: room.playerCount,
      mode: room.mode,
      teams: room.listTeams(),
    });
  });

  app.get('/api/room/:code/qr', async (req, res) => {
    const room = roomManager.get(req.params.code);
    if (!room) {
      res.status(404).json({ error: 'room_not_found' });
      return;
    }
    const joinUrl = buildJoinUrl(req, room.code);
    try {
      const png = await QRCode.toBuffer(joinUrl, { width: 320, margin: 1 });
      res.type('png').send(png);
    } catch {
      res.status(500).json({ error: 'qr_failed' });
    }
  });

  // Fichiers statiques du front (host + player), et fallback SPA-léger.
  app.use(express.static(PUBLIC_DIR));
  app.get('/join', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'join.html')));
  // Écran public (projeté / partagé) : tout sauf la vidéo YouTube.
  app.get('/present', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'present.html')));

  const httpServer = createServer(app);
  const io = new IOServer(httpServer);

  wireSockets(io, quizRepo, roomManager, authConfig);

  // Nettoyage périodique des salles inactives/terminées.
  const pruneTimer = setInterval(() => roomManager.pruneStale(ROOM_IDLE_MS), 15 * 60 * 1000);
  pruneTimer.unref?.();

  return { app, httpServer, io, quizRepo, roomManager };
}

function mapValidatedRounds(rounds: CreateQuizInput['rounds']) {
  return rounds.map((r) => ({
    youtubeId: r.youtube,
    startSeconds: r.startSeconds,
    durationSeconds: r.durationSeconds,
    question: r.question,
    options: r.options,
    correctIndex: r.correctIndex,
    // Réponse révélée facultative : par défaut, la bonne proposition.
    answerLabel: r.answerLabel?.trim() || r.options[r.correctIndex],
  }));
}

function buildJoinUrl(
  req: { protocol: string; get: (h: string) => string | undefined },
  code: string,
): string {
  const envBase = process.env.PUBLIC_BASE_URL ?? process.env.RENDER_EXTERNAL_URL;
  if (envBase) return `${envBase.replace(/\/$/, '')}/join?code=${code}`;
  const proto = req.get('x-forwarded-proto') ?? req.protocol;
  const host = req.get('x-forwarded-host') ?? req.get('host') ?? 'localhost';
  return `${proto}://${host}/join?code=${code}`;
}

function toPublicRound(room: Room): PublicRound | null {
  const index = room.getCurrentRoundIndex();
  const round = room.quiz.rounds[index];
  if (!round) return null;
  const pr: PublicRound = {
    roundIndex: index,
    totalRounds: room.totalRounds,
    question: round.question,
    options: [...round.options],
    durationSeconds: round.durationSeconds,
  };
  // Son sur les téléphones (opt-in) : on transmet de quoi jouer l'audio.
  if (room.playerAudio) {
    pr.audioYoutubeId = round.youtubeId;
    pr.audioStartSeconds = round.startSeconds;
  }
  return pr;
}

/**
 * Clôt la manche en cours et diffuse le résultat. Point d'entrée unique appelé
 * par la révélation manuelle de l'hôte ET par le minuteur serveur (backstop).
 * Idempotent : renvoie false si aucune manche n'était en cours.
 */
function emitRoundResult(io: IOServer, room: Room): boolean {
  const result = room.endRound();
  if (!result) return false;
  const results: Record<
    string,
    {
      correct: boolean;
      pointsAwarded: number;
      totalScore: number;
      answeredBy: string | null;
      streak: number;
      comboBonus: number;
    }
  > = {};
  for (const [playerId, r] of result.perPlayer) {
    results[playerId] = {
      correct: r.correct,
      pointsAwarded: r.pointsAwarded,
      totalScore: r.totalScore,
      answeredBy: r.answeredBy ?? null,
      streak: r.streak ?? 0,
      comboBonus: r.comboBonus ?? 0,
    };
  }
  io.to(room.code).emit('round:result', {
    correctIndex: result.correctIndex,
    answerLabel: result.answerLabel,
    options: result.options,
    distribution: result.distribution,
    answeredCount: result.answeredCount,
    correctCount: result.correctCount,
    totalPlayers: result.totalPlayers,
    results,
    leaderboard: room.leaderboard(),
    isLastRound: room.isLastRound(),
  });
  return true;
}

// Marge de sécurité : le minuteur serveur ne clôt la manche que ~2 s après la fin
// théorique, laissant l'hôte connecté piloter la révélation (UX/animations). Le
// backstop ne prend le relais que si l'hôte a disparu.
const ROUND_END_GRACE_MS = 2000;

function wireSockets(
  io: IOServer,
  quizRepo: QuizRepository,
  roomManager: RoomManager,
  authConfig: AuthConfig,
): void {
  // Minuteur serveur-autoritaire par salle : garantit qu'une manche se termine
  // même si le navigateur de l'hôte se ferme/gèle en plein milieu.
  const roundTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const clearRoundTimer = (code: string): void => {
    const t = roundTimers.get(code);
    if (t) { clearTimeout(t); roundTimers.delete(code); }
  };
  const scheduleRoundTimer = (room: Room, ms: number): void => {
    clearRoundTimer(room.code);
    const t = setTimeout(() => {
      roundTimers.delete(room.code);
      emitRoundResult(io, room);
    }, Math.max(0, ms));
    t.unref?.();
    roundTimers.set(room.code, t);
  };
  const currentRoundDurationMs = (room: Room): number => {
    const round = room.quiz.rounds[room.getCurrentRoundIndex()];
    return round ? round.durationSeconds * 1000 : 0;
  };

  io.on('connection', (socket: Socket) => {
    const data = socket.data as SocketData;

    // Enrobe un handler async : un rejet est loggé et signalé au socket au lieu
    // de devenir un « unhandled rejection ».
    const onSafe = (event: string, handler: (payload: unknown) => Promise<void>): void => {
      socket.on(event, (payload: unknown) => {
        Promise.resolve(handler(payload)).catch((err) => {
          console.error(`Handler Socket.IO "${event}" a échoué :`, (err as Error)?.message ?? err);
          socket.emit(event.startsWith('player:') ? 'player:error' : 'host:error', {
            message: 'Erreur serveur, réessaie.',
          });
        });
      });
    };

    // ---- Hôte ----------------------------------------------------------

    onSafe('host:createRoom', async (payload: unknown) => {
      const uid = socketUserId(socket, authConfig);
      if (!uid) {
        socket.emit('host:error', { message: 'Connecte-toi pour lancer une partie.', fatal: true });
        return;
      }
      const parsed = createRoomSchema.safeParse(payload);
      if (!parsed.success) {
        socket.emit('host:error', { message: 'Requête invalide.' });
        return;
      }
      const quiz = await quizRepo.get(parsed.data.quizId);
      if (!quiz) {
        socket.emit('host:error', { message: 'Quiz introuvable.' });
        return;
      }
      if (!canAccessQuiz(quiz, uid)) {
        socket.emit('host:error', { message: "Cette playlist ne t'appartient pas." });
        return;
      }
      data.userId = uid;
      const room = roomManager.create(
        quiz,
        parsed.data.mode ?? 'solo',
        parsed.data.combo ?? true,
        parsed.data.playerAudio ?? false,
      );
      room.hostSocketId = socket.id;
      data.role = 'host';
      data.code = room.code;
      void socket.join(room.code);
      socket.emit('host:roomCreated', {
        code: room.code,
        hostToken: room.hostToken,
        quizTitle: quiz.title,
        totalRounds: room.totalRounds,
        mode: room.mode,
        combo: room.comboEnabled,
        playerAudio: room.playerAudio,
        players: room.listPlayers(),
        teams: room.listTeams(),
      });
    });

    socket.on('host:reconnect', (payload: unknown) => {
      const parsed = hostReconnectSchema.safeParse(payload);
      if (!parsed.success) {
        socket.emit('host:error', { message: 'Requête invalide.' });
        return;
      }
      const room = roomManager.get(parsed.data.code);
      if (!room || room.hostToken !== parsed.data.hostToken) {
        socket.emit('host:error', { message: 'Salle introuvable.', fatal: true });
        return;
      }
      room.hostSocketId = socket.id;
      data.role = 'host';
      data.code = room.code;
      void socket.join(room.code);
      socket.emit('host:snapshot', {
        code: room.code,
        quizTitle: room.quiz.title,
        totalRounds: room.totalRounds,
        mode: room.mode,
        playerAudio: room.playerAudio,
        state: room.getState(),
        currentRoundIndex: room.getCurrentRoundIndex(),
        players: room.listPlayers(),
        teams: room.listTeams(),
        leaderboard: room.leaderboard(),
      });
    });

    socket.on('host:startRound', () => {
      const room = getHostRoom(socket, roomManager);
      if (!room) return;
      clearRoundTimer(room.code);
      const started = room.startNextRound();
      if (!started) {
        socket.emit('host:error', { message: 'Plus de manche à lancer.' });
        return;
      }
      socket.emit('host:roundStarted', {
        hostRound: started.hostRound,
        answeredCount: 0,
        playerCount: room.respondentCount(),
      });
      // Les joueurs patientent pendant le chargement de la vidéo : la question
      // et le minuteur n'arrivent qu'au vrai démarrage de l'extrait.
      socket.to(room.code).emit('player:roundLoading', {
        roundIndex: started.publicRound.roundIndex,
        totalRounds: started.publicRound.totalRounds,
      });
    });

    // L'hôte lance le décompte « 3·2·1 » -> on le diffuse aux joueurs.
    socket.on('host:beginCountdown', () => {
      const room = getHostRoom(socket, roomManager);
      if (!room) return;
      socket.to(room.code).emit('player:countdown', { seconds: 3 });
    });

    // L'hôte signale que l'extrait joue réellement -> on ouvre la manche.
    socket.on('host:clipStarted', () => {
      const room = getHostRoom(socket, roomManager);
      if (!room) return;
      if (!room.markClipStarted()) return;
      const publicRound = toPublicRound(room);
      if (publicRound) socket.to(room.code).emit('player:roundStarted', { publicRound });
      // Backstop serveur : la manche se clôt à sa durée + marge même si l'hôte disparaît.
      scheduleRoundTimer(room, currentRoundDurationMs(room) + ROUND_END_GRACE_MS);
    });

    socket.on('host:endRound', () => {
      const room = getHostRoom(socket, roomManager);
      if (!room) return;
      clearRoundTimer(room.code);
      if (!emitRoundResult(io, room)) {
        socket.emit('host:error', { message: 'Aucune manche à clôturer.' });
      }
    });

    socket.on('host:endGame', () => {
      const room = getHostRoom(socket, roomManager);
      if (!room) return;
      clearRoundTimer(room.code);
      room.endGame();
      io.to(room.code).emit('game:ended', { leaderboard: room.leaderboard() });
    });

    // Annule la partie en cours et renvoie tout le monde au lobby (scores remis à zéro).
    socket.on('host:cancelGame', () => {
      const room = getHostRoom(socket, roomManager);
      if (!room) return;
      clearRoundTimer(room.code);
      if (!room.cancelGame()) return;
      io.to(room.code).emit('game:cancelled', {
        quizTitle: room.quiz.title,
        players: room.listPlayers(),
        teams: room.listTeams(),
      });
    });

    // ---- Contrôles hôte : pause, reprise, passer, exclure ---------------

    socket.on('host:pauseRound', () => {
      const room = getHostRoom(socket, roomManager);
      if (!room) return;
      if (room.pause()) {
        clearRoundTimer(room.code); // on gèle aussi le backstop serveur
        socket.to(room.code).emit('round:paused');
      }
    });

    socket.on('host:resumeRound', (payload: unknown) => {
      const room = getHostRoom(socket, roomManager);
      if (!room) return;
      const parsed = resumeSchema.safeParse(payload);
      const remainingSeconds = parsed.success ? Math.round(parsed.data.remainingSeconds) : 0;
      if (room.resume()) {
        scheduleRoundTimer(room, remainingSeconds * 1000 + ROUND_END_GRACE_MS);
        socket.to(room.code).emit('round:resumed', { remainingSeconds });
      }
    });

    socket.on('host:skipRound', () => {
      const room = getHostRoom(socket, roomManager);
      if (!room) return;
      clearRoundTimer(room.code);
      if (room.skipRound()) {
        io.to(room.code).emit('round:skipped', {
          leaderboard: room.leaderboard(),
          isLastRound: room.isLastRound(),
        });
      }
    });

    // Mode auto : relaie aux joueurs le décompte avant l'enchaînement de la
    // manche suivante (ils voient le temps restant sur l'écran de résultat).
    socket.on('host:autoNext', (payload: unknown) => {
      if (data.role !== 'host' || !data.code) return;
      const room = roomManager.get(data.code);
      if (!room) return;
      const parsed = autoNextSchema.safeParse(payload);
      if (!parsed.success) return;
      socket.to(room.code).emit('round:autoNext', {
        seconds: parsed.data.seconds,
        isLast: Boolean(parsed.data.isLast),
      });
    });

    socket.on('host:kickPlayer', (payload: unknown) => {
      const room = getHostRoom(socket, roomManager);
      if (!room) return;
      const parsed = kickSchema.safeParse(payload);
      if (!parsed.success) return;
      const socketId = room.removePlayer(parsed.data.playerId);
      if (socketId) io.to(socketId).emit('player:kicked');
      broadcastPlayers(io, room);
    });

    // ---- Joueur --------------------------------------------------------

    // Un joueur encore sur l'écran de choix d'équipe observe la salle pour voir
    // apparaître en direct les équipes créées sur d'autres téléphones. On le met
    // dans une room « lobby » dédiée : il reçoit les MAJ d'équipes sans être
    // exposé aux évènements de jeu (roundLoading, roundStarted…).
    socket.on('player:watchRoom', (payload: unknown) => {
      const parsed = watchRoomSchema.safeParse(payload);
      if (!parsed.success) return;
      const room = roomManager.get(parsed.data.code);
      if (!room) return;
      void socket.join(lobbyRoom(room.code));
      socket.emit('room:teams', { teams: room.listTeams() });
    });

    socket.on('player:join', (payload: unknown) => {
      const parsed = joinRoomSchema.safeParse(payload);
      if (!parsed.success) {
        socket.emit('player:error', { message: 'Code ou pseudo invalide.' });
        return;
      }
      const room = roomManager.get(parsed.data.code);
      if (!room) {
        socket.emit('player:error', { message: "Cette salle n'existe pas.", fatal: true });
        return;
      }
      const outcome = room.addPlayer(parsed.data.pseudo, socket.id, parsed.data.team);
      if ('error' in outcome) {
        socket.emit('player:error', { message: outcome.error });
        return;
      }
      data.role = 'player';
      data.code = room.code;
      data.playerId = outcome.player.id;
      void socket.join(room.code);
      void socket.leave(lobbyRoom(room.code)); // il devient joueur : plus besoin d'observer
      socket.emit('player:joined', {
        playerId: outcome.player.id,
        code: room.code,
        quizTitle: room.quiz.title,
        totalRounds: room.totalRounds,
        state: room.getState(),
        mode: room.mode,
        playerAudio: room.playerAudio,
        teamId: outcome.player.teamId ?? null,
        teamName: outcome.player.teamName ?? null,
      });
      broadcastPlayers(io, room);
    });

    socket.on('player:reconnect', (payload: unknown) => {
      const parsed = reconnectSchema.safeParse(payload);
      if (!parsed.success) {
        socket.emit('player:error', { message: 'Requête invalide.' });
        return;
      }
      const room = roomManager.get(parsed.data.code);
      if (!room) {
        socket.emit('player:error', { message: "Cette salle n'existe plus.", fatal: true });
        return;
      }
      const view = room.reconnectPlayer(parsed.data.playerId, socket.id);
      if (!view) {
        socket.emit('player:error', { message: 'Session de joueur expirée.', fatal: true });
        return;
      }
      data.role = 'player';
      data.code = room.code;
      data.playerId = view.id;
      void socket.join(room.code);
      socket.emit('player:snapshot', {
        playerId: view.id,
        code: room.code,
        quizTitle: room.quiz.title,
        totalRounds: room.totalRounds,
        state: room.getState(),
        mode: room.mode,
        playerAudio: room.playerAudio,
        teamId: view.teamId ?? null,
        teamName: view.teamName ?? null,
        score: view.score,
        alreadyAnswered: room.hasAnswered(view.id),
        publicRound:
          room.getState() === 'playing' && room.isClipStarted() ? toPublicRound(room) : null,
        loading: room.getState() === 'playing' && !room.isClipStarted(),
        leaderboard: room.leaderboard(),
      });
      broadcastPlayers(io, room);
    });

    socket.on('player:answer', (payload: unknown) => {
      const parsed = answerSchema.safeParse(payload);
      if (!parsed.success || !data.code || !data.playerId) {
        socket.emit('player:error', { message: 'Réponse invalide.' });
        return;
      }
      const room = roomManager.get(data.code);
      if (!room) return;
      const outcome = room.submitAnswer(data.playerId, parsed.data.optionIndex);
      if (!outcome.accepted) {
        socket.emit('player:answerRejected', { reason: outcome.reason });
        return;
      }
      socket.emit('player:answerAccepted', { optionIndex: parsed.data.optionIndex });
      // Mode équipes : diffuse le tally de vote à toute l'équipe (et l'état de
      // verrouillage : l'équipe se verrouille à la majorité ou quand tous ont voté).
      if (room.mode === 'teams' && outcome.teamId) {
        const voteState = room.getTeamVoteState(outcome.teamId);
        for (const sid of room.getTeamMemberSocketIds(outcome.teamId)) {
          io.to(sid).emit('player:teamVotes', voteState);
        }
      }
      notifyHostAnswerCount(io, room);
    });

    // Mode équipes : un membre verrouille la réponse (la plus votée).
    socket.on('player:teamLock', () => {
      if (!data.code || !data.playerId) return;
      const room = roomManager.get(data.code);
      if (!room || room.mode !== 'teams') return;
      const res = room.lockTeam(data.playerId);
      if (!res.locked) {
        socket.emit('player:answerRejected', { reason: res.reason });
        return;
      }
      const voteState = room.getTeamVoteState(res.teamId);
      for (const sid of room.getTeamMemberSocketIds(res.teamId)) {
        io.to(sid).emit('player:teamVotes', voteState);
      }
      notifyHostAnswerCount(io, room);
    });

    // ---- Déconnexion ---------------------------------------------------

    socket.on('disconnect', () => {
      if (!data.code) return;
      const room = roomManager.get(data.code);
      if (!room) return;
      if (data.role === 'player') {
        room.markDisconnected(socket.id);
        broadcastPlayers(io, room);
      } else if (data.role === 'host' && room.hostSocketId === socket.id) {
        room.hostSocketId = null;
      }
    });
  });
}

type RateLimiter = (req: Request) => boolean;

/** Limiteur simple en mémoire (par IP, fenêtre glissante). Renvoie false si dépassé. */
function createRateLimiter(maxHits: number, windowMs: number): RateLimiter {
  const hits = new Map<string, number[]>();
  return (req) => {
    const fwd = req.headers['x-forwarded-for'];
    const ip = (Array.isArray(fwd) ? fwd[0] : fwd ?? req.socket.remoteAddress ?? 'unknown')
      .split(',')[0]
      .trim();
    const now = Date.now();
    const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
    recent.push(now);
    hits.set(ip, recent);
    if (hits.size > 10_000) hits.clear(); // garde-fou mémoire
    return recent.length <= maxHits;
  };
}

function socketUserId(socket: Socket, authConfig: AuthConfig): string | null {
  const cookies = parseCookies(socket.handshake.headers.cookie);
  return verifySession(cookies[SESSION_COOKIE], authConfig.sessionSecret)?.uid ?? null;
}

function getHostRoom(socket: Socket, roomManager: RoomManager): Room | null {
  const data = socket.data as SocketData;
  if (data.role !== 'host' || !data.code) {
    socket.emit('host:error', { message: 'Action réservée à l\'hôte.' });
    return null;
  }
  const room = roomManager.get(data.code);
  if (!room) {
    socket.emit('host:error', { message: 'Salle introuvable.', fatal: true });
    return null;
  }
  return room;
}

// Room Socket.IO dédiée aux joueurs encore sur l'écran de choix d'équipe.
function lobbyRoom(code: string): string {
  return `lobby:${code}`;
}

function broadcastPlayers(io: IOServer, room: Room): void {
  const teams = room.listTeams();
  io.to(room.code).emit('room:players', { players: room.listPlayers(), teams });
  // Les joueurs encore sur l'écran de choix d'équipe ne voient que les équipes.
  io.to(lobbyRoom(room.code)).emit('room:teams', { teams });
}

function notifyHostAnswerCount(io: IOServer, room: Room): void {
  if (!room.hostSocketId) return;
  io.to(room.hostSocketId).emit('host:answerUpdate', {
    answered: room.answeredUnitCount(),
    playerCount: room.respondentCount(),
  });
}
