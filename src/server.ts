import { createServer, type Server as HttpServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express, { type Express } from 'express';
import { Server as IOServer, type Socket } from 'socket.io';
import QRCode from 'qrcode';
import { ZodError } from 'zod';

import { QuizStore } from './game/store';
import { RoomManager, type Room } from './game/room';
import {
  createRoomSchema,
  joinRoomSchema,
  reconnectSchema,
  hostReconnectSchema,
  answerSchema,
  createQuizSchema,
} from './validation';
import type { PublicRound } from './types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const ROOM_IDLE_MS = 3 * 60 * 60 * 1000; // 3 h d'inactivité

interface SocketData {
  role?: 'host' | 'player';
  code?: string;
  playerId?: string;
}

export interface BuiltServer {
  app: Express;
  httpServer: HttpServer;
  io: IOServer;
  quizStore: QuizStore;
  roomManager: RoomManager;
}

/** Construit l'application (HTTP + WebSocket) sans démarrer l'écoute. */
export function buildServer(): BuiltServer {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  const quizStore = new QuizStore();
  const roomManager = new RoomManager();

  // ---- Routes HTTP ------------------------------------------------------

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', rooms: roomManager.size, uptime: process.uptime() });
  });

  app.get('/api/quizzes', (_req, res) => {
    res.json({ quizzes: quizStore.list() });
  });

  app.post('/api/quizzes', (req, res) => {
    try {
      const input = createQuizSchema.parse(req.body);
      const rounds = input.rounds.map((r) => ({
        youtubeId: r.youtube,
        startSeconds: r.startSeconds,
        durationSeconds: r.durationSeconds,
        question: r.question,
        options: r.options,
        correctIndex: r.correctIndex,
        answerLabel: r.answerLabel,
      }));
      const quiz = quizStore.create(input.title, rounds);
      res.status(201).json({ id: quiz.id, title: quiz.title, roundCount: quiz.rounds.length });
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({ error: 'invalid_quiz', issues: err.issues });
        return;
      }
      res.status(500).json({ error: 'server_error' });
    }
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

  wireSockets(io, quizStore, roomManager);

  // Nettoyage périodique des salles inactives/terminées.
  const pruneTimer = setInterval(() => roomManager.pruneStale(ROOM_IDLE_MS), 15 * 60 * 1000);
  pruneTimer.unref?.();

  return { app, httpServer, io, quizStore, roomManager };
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

function wireSockets(io: IOServer, quizStore: QuizStore, roomManager: RoomManager): void {
  io.on('connection', (socket: Socket) => {
    const data = socket.data as SocketData;

    // ---- Hôte ----------------------------------------------------------

    socket.on('host:createRoom', (payload: unknown) => {
      const parsed = createRoomSchema.safeParse(payload);
      if (!parsed.success) {
        socket.emit('host:error', { message: 'Requête invalide.' });
        return;
      }
      const quiz = quizStore.get(parsed.data.quizId);
      if (!quiz) {
        socket.emit('host:error', { message: 'Quiz introuvable.' });
        return;
      }
      const room = roomManager.create(quiz);
      room.hostSocketId = socket.id;
      data.role = 'host';
      data.code = room.code;
      void socket.join(room.code);
      socket.emit('host:roomCreated', {
        code: room.code,
        hostToken: room.hostToken,
        quizTitle: quiz.title,
        totalRounds: room.totalRounds,
        players: room.listPlayers(),
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
        state: room.getState(),
        currentRoundIndex: room.getCurrentRoundIndex(),
        players: room.listPlayers(),
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
        playerCount: room.playerCount,
      });
      socket.to(room.code).emit('player:roundStarted', { publicRound: started.publicRound });
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
      const results: Record<string, { correct: boolean; pointsAwarded: number; totalScore: number }> =
        {};
      for (const [playerId, r] of result.perPlayer) {
        results[playerId] = {
          correct: r.correct,
          pointsAwarded: r.pointsAwarded,
          totalScore: r.totalScore,
        };
      }
      io.to(room.code).emit('round:result', {
        correctIndex: result.correctIndex,
        answerLabel: result.answerLabel,
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
      const outcome = room.addPlayer(parsed.data.pseudo, socket.id);
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
        score: view.score,
        alreadyAnswered: room.hasAnswered(view.id),
        publicRound: room.getState() === 'playing' ? toPublicRound(room) : null,
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
  io.to(room.code).emit('room:players', { players: room.listPlayers() });
}

function notifyHostAnswerCount(io: IOServer, room: Room): void {
  if (!room.hostSocketId) return;
  const answered = room.listPlayers().filter((p) => room.hasAnswered(p.id)).length;
  io.to(room.hostSocketId).emit('host:answerUpdate', {
    answered,
    playerCount: room.playerCount,
  });
}
