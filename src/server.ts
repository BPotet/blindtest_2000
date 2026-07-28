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
  createQuizSchema,
  type CreateQuizInput,
} from './validation';
import {
  loadAuthConfig,
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
  opts: { quizRepo?: QuizRepository; authConfig?: AuthConfig } = {},
): BuiltServer {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  const quizRepo = opts.quizRepo ?? new MemoryQuizStore();
  const authConfig = opts.authConfig ?? loadAuthConfig();
  const roomManager = new RoomManager();

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

  // ---- Routes HTTP ------------------------------------------------------

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', rooms: roomManager.size, uptime: process.uptime() });
  });

  // ---- Authentification -------------------------------------------------

  app.post('/api/login', async (req, res) => {
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
    res.json({ username: user.username });
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
    res.json({ username: user.username });
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
  return {
    roundIndex: index,
    totalRounds: room.totalRounds,
    question: round.question,
    options: [...round.options],
    durationSeconds: round.durationSeconds,
  };
}

function wireSockets(
  io: IOServer,
  quizRepo: QuizRepository,
  roomManager: RoomManager,
  authConfig: AuthConfig,
): void {
  io.on('connection', (socket: Socket) => {
    const data = socket.data as SocketData;

    // ---- Hôte ----------------------------------------------------------

    socket.on('host:createRoom', async (payload: unknown) => {
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
      const room = roomManager.create(quiz, parsed.data.mode ?? 'solo');
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
    });

    socket.on('host:endRound', () => {
      const room = getHostRoom(socket, roomManager);
      if (!room) return;
      const result = room.endRound();
      if (!result) {
        socket.emit('host:error', { message: 'Aucune manche à clôturer.' });
        return;
      }
      const leaderboard = room.leaderboard();
      const results: Record<
        string,
        { correct: boolean; pointsAwarded: number; totalScore: number; answeredBy: string | null }
      > = {};
      for (const [playerId, r] of result.perPlayer) {
        results[playerId] = {
          correct: r.correct,
          pointsAwarded: r.pointsAwarded,
          totalScore: r.totalScore,
          answeredBy: r.answeredBy ?? null,
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
        leaderboard,
        isLastRound: room.isLastRound(),
      });
    });

    socket.on('host:endGame', () => {
      const room = getHostRoom(socket, roomManager);
      if (!room) return;
      room.endGame();
      io.to(room.code).emit('game:ended', { leaderboard: room.leaderboard() });
    });

    // ---- Joueur --------------------------------------------------------

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
      socket.emit('player:joined', {
        playerId: outcome.player.id,
        code: room.code,
        quizTitle: room.quiz.title,
        totalRounds: room.totalRounds,
        state: room.getState(),
        mode: room.mode,
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
      // Mode équipes : la 1re réponse verrouille les coéquipiers.
      if (room.mode === 'teams') {
        const me = room.getPlayer(data.playerId);
        for (const sid of room.getTeammateSocketIds(data.playerId)) {
          io.to(sid).emit('player:teamLocked', { by: me?.pseudo ?? null });
        }
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

function broadcastPlayers(io: IOServer, room: Room): void {
  io.to(room.code).emit('room:players', {
    players: room.listPlayers(),
    teams: room.listTeams(),
  });
}

function notifyHostAnswerCount(io: IOServer, room: Room): void {
  if (!room.hostSocketId) return;
  io.to(room.hostSocketId).emit('host:answerUpdate', {
    answered: room.answeredUnitCount(),
    playerCount: room.respondentCount(),
  });
}
