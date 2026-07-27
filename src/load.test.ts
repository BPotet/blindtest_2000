import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { buildServer, type BuiltServer } from './server';
import { hashPassword, type AuthConfig } from './auth';

// Test de charge : au moins 30 joueurs simultanés sur une manche complète.
const N = 40;

let server: BuiltServer;
let port: number;
let cookie: string;
const clients: ClientSocket[] = [];

const authConfig: AuthConfig = {
  adminUsername: 'admin',
  adminPassword: 'admin',
  sessionSecret: 'load-secret',
  secureCookies: false,
};

function connect(extraHeaders?: Record<string, string>): ClientSocket {
  const socket = ioClient(`http://localhost:${port}`, { transports: ['websocket'], extraHeaders });
  clients.push(socket);
  return socket;
}

function once<T = any>(socket: ClientSocket, event: string, timeoutMs = 20000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout "${event}"`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

beforeAll(async () => {
  server = buildServer({ authConfig });
  await server.quizRepo.upsertUser('admin', hashPassword('admin'));
  await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
  port = (server.httpServer.address() as AddressInfo).port;
  const res = await fetch(`http://localhost:${port}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin' }),
  });
  cookie = (/bt_session=[^;]+/.exec(res.headers.get('set-cookie') ?? '') ?? [''])[0];
});

afterAll(async () => {
  for (const c of clients) c.close();
  server.io.close();
  await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
});

describe('Charge — 40 joueurs simultanés', () => {
  it(
    `accueille ${N} joueurs, encaisse leurs réponses et calcule le classement`,
    async () => {
      const host = connect({ Cookie: cookie });
      await once(host, 'connect');
      host.emit('host:createRoom', { quizId: 'demo-tubes' });
      const created = await once<any>(host, 'host:roomCreated');
      const code = created.code;

      const t0 = Date.now();
      const players = await Promise.all(
        Array.from({ length: N }, (_, i) =>
          new Promise<{ s: ClientSocket; id: string; i: number }>((resolve, reject) => {
            const s = connect();
            s.once('player:joined', (p: any) => resolve({ s, id: p.playerId, i }));
            s.once('player:error', (e: any) => reject(new Error(e.message)));
            s.emit('player:join', { code, pseudo: `Joueur${i}` });
          }),
        ),
      );
      const joinMs = Date.now() - t0;
      expect(players).toHaveLength(N);

      host.emit('host:startRound');
      await once(host, 'host:roundStarted');
      // L'extrait démarre : on attend que tous les joueurs reçoivent la question.
      const questionReceived = players.map(({ s }) => once(s, 'player:roundStarted'));
      host.emit('host:clipStarted');
      await Promise.all(questionReceived);

      const acks = players.map(({ s }) => once(s, 'player:answerAccepted'));
      const answerStart = Date.now();
      players.forEach(({ s, i }) => s.emit('player:answer', { optionIndex: i % 4 }));
      await Promise.all(acks);
      const answerMs = Date.now() - answerStart;

      const resultP = once<any>(host, 'round:result');
      host.emit('host:endRound');
      const result = await resultP;
      const totalMs = Date.now() - t0;

      expect(result.leaderboard).toHaveLength(N);
      expect(result.totalPlayers).toBe(N);
      expect(result.answeredCount).toBe(N);
      expect(result.distribution.reduce((a: number, b: number) => a + b, 0)).toBe(N);

      // eslint-disable-next-line no-console
      console.log(
        `[charge] ${N} joueurs — arrivées ${joinMs}ms, ${N} réponses encaissées ${answerMs}ms, manche complète ${totalMs}ms`,
      );
    },
    30000,
  );
});
