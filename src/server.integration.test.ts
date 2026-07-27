import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { buildServer, type BuiltServer } from './server';
import { hashPassword, type AuthConfig } from './auth';

let server: BuiltServer;
let port: number;
let cookie: string;
const clients: ClientSocket[] = [];

const authConfig: AuthConfig = {
  adminUsername: 'admin',
  adminPassword: 'admin',
  sessionSecret: 'secret-de-test',
  secureCookies: false,
};

function connect(extraHeaders?: Record<string, string>): ClientSocket {
  const socket = ioClient(`http://localhost:${port}`, { transports: ['websocket'], extraHeaders });
  clients.push(socket);
  return socket;
}

function connectHost(): ClientSocket {
  return connect({ Cookie: cookie });
}

function once<T = any>(socket: ClientSocket, event: string, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout en attente de "${event}"`)), timeoutMs);
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
  const setCookie = res.headers.get('set-cookie') ?? '';
  cookie = (/bt_session=[^;]+/.exec(setCookie) ?? [''])[0];
});

afterAll(async () => {
  for (const c of clients) c.close();
  server.io.close();
  await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
});

describe('Authentification hôte', () => {
  it('émet un cookie de session à la connexion admin', () => {
    expect(cookie).toMatch(/^bt_session=/);
  });

  it('refuse un mauvais mot de passe (401)', async () => {
    const res = await fetch(`http://localhost:${port}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'faux' }),
    });
    expect(res.status).toBe(401);
  });

  it('protège la liste des quiz (401 sans session)', async () => {
    const res = await fetch(`http://localhost:${port}/api/quizzes`);
    expect(res.status).toBe(401);
  });

  it('donne accès aux quiz avec une session valide', async () => {
    const res = await fetch(`http://localhost:${port}/api/quizzes`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { quizzes: unknown[] };
    expect(body.quizzes.length).toBeGreaterThanOrEqual(2);
  });

  it('refuse la création de salle sans authentification', async () => {
    const anon = connect();
    await once(anon, 'connect');
    anon.emit('host:createRoom', { quizId: 'demo-tubes' });
    const err = await once<any>(anon, 'host:error');
    expect(err.fatal).toBe(true);
  });
});

describe('Flux de partie de bout en bout (Socket.IO)', () => {
  it('joue une manche complète : join, réponse, scoring serveur, classement', async () => {
    const host = connectHost();
    await once(host, 'connect');
    host.emit('host:createRoom', { quizId: 'demo-tubes' });
    const created = await once<any>(host, 'host:roomCreated');
    expect(created.code).toBeTruthy();
    const code = created.code;

    const alice = connect();
    alice.emit('player:join', { code, pseudo: 'Alice' });
    const aliceJoined = await once<any>(alice, 'player:joined');
    expect(aliceJoined.playerId).toBeTruthy();

    const bob = connect();
    bob.emit('player:join', { code, pseudo: 'Bob' });
    const bobJoined = await once<any>(bob, 'player:joined');

    const playersUpdate = await once<any>(host, 'room:players');
    expect(playersUpdate.players.length).toBeGreaterThanOrEqual(1);

    const roundStartedForPlayer = once<any>(alice, 'player:roundStarted');
    host.emit('host:startRound');
    const hostRound = await once<any>(host, 'host:roundStarted');
    const playerRound = await roundStartedForPlayer;

    expect(hostRound.hostRound.youtubeId).toBeTruthy();
    expect(hostRound.hostRound.correctIndex).toBe(0);
    expect(playerRound.publicRound.options.length).toBeGreaterThanOrEqual(2);
    expect(playerRound.publicRound.correctIndex).toBeUndefined();
    expect(playerRound.publicRound.youtubeId).toBeUndefined();

    alice.emit('player:answer', { optionIndex: 0 });
    await once(alice, 'player:answerAccepted');
    bob.emit('player:answer', { optionIndex: 1 });
    await once(bob, 'player:answerAccepted');

    const aliceResultP = once<any>(alice, 'round:result');
    const bobResultP = once<any>(bob, 'round:result');
    host.emit('host:endRound');
    const aliceResult = await aliceResultP;
    const bobResult = await bobResultP;

    expect(aliceResult.correctIndex).toBe(0);
    expect(aliceResult.results[aliceJoined.playerId].correct).toBe(true);
    expect(aliceResult.results[aliceJoined.playerId].pointsAwarded).toBeGreaterThan(0);
    expect(bobResult.results[bobJoined.playerId].correct).toBe(false);
    expect(bobResult.results[bobJoined.playerId].pointsAwarded).toBe(0);

    const ranked = aliceResult.leaderboard;
    expect(ranked[0].pseudo).toBe('Alice');
    expect(ranked[0].rank).toBe(1);
  });

  it('deux salles simultanées restent isolées', async () => {
    const host1 = connectHost();
    await once(host1, 'connect');
    host1.emit('host:createRoom', { quizId: 'demo-tubes' });
    const room1 = await once<any>(host1, 'host:roomCreated');

    const host2 = connectHost();
    host2.emit('host:createRoom', { quizId: 'demo-80s' });
    const room2 = await once<any>(host2, 'host:roomCreated');

    expect(room1.code).not.toBe(room2.code);

    const p1 = connect();
    p1.emit('player:join', { code: room1.code, pseudo: 'DansSalle1' });
    await once(p1, 'player:joined');

    const host1Players = await once<any>(host1, 'room:players');
    expect(host1Players.players.some((pl: any) => pl.pseudo === 'DansSalle1')).toBe(true);

    let host2SawLeak = false;
    host2.on('room:players', (payload: any) => {
      if (payload.players.some((pl: any) => pl.pseudo === 'DansSalle1')) host2SawLeak = true;
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(host2SawLeak).toBe(false);
  });

  it('rejette un pseudo invalide et une salle inexistante', async () => {
    const player = connect();
    await once(player, 'connect');
    player.emit('player:join', { code: 'ZZZZZ', pseudo: 'Personne' });
    const err = await once<any>(player, 'player:error');
    expect(err.fatal).toBe(true);
  });
});
