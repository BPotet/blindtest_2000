import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { buildServer, type BuiltServer } from './server';
import { hashPassword, type AuthConfig } from './auth';

// Résilience réseau de bout en bout (vrais sockets) : un joueur dont le
// téléphone perd la connexion en pleine manche et revient via player:reconnect
// retrouve son état sans rien casser — réponse conservée (jamais recomptée),
// score préservé, reprise possible de la manche en cours.

let server: BuiltServer;
let port: number;
let cookie: string;
const clients: ClientSocket[] = [];

const authConfig: AuthConfig = {
  adminUsername: 'admin',
  adminPassword: 'admin',
  sessionSecret: 'reconnect-secret',
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

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Ouvre une salle, fait rejoindre un joueur et démarre la manche (extrait lancé).
async function openRoomWithAlice(): Promise<{
  host: ClientSocket;
  code: string;
  aliceId: string;
  alice: ClientSocket;
}> {
  const host = connect({ Cookie: cookie });
  await once(host, 'connect');
  host.emit('host:createRoom', { quizId: 'demo-tubes' });
  const created = await once<any>(host, 'host:roomCreated');
  const code = created.code;

  const alice = connect();
  alice.emit('player:join', { code, pseudo: 'Alice' });
  const joined = await once<any>(alice, 'player:joined');

  host.emit('host:startRound');
  await once(host, 'host:roundStarted');
  const round = once(alice, 'player:roundStarted');
  host.emit('host:clipStarted');
  await round;
  return { host, code, aliceId: joined.playerId, alice };
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

describe('Résilience réseau — reconnexion en pleine manche', () => {
  it('réponse conservée après une coupure : le snapshot la signale, un nouvel envoi est rejeté', async () => {
    const { host, code, aliceId, alice } = await openRoomWithAlice();

    alice.emit('player:answer', { optionIndex: 0 });
    await once(alice, 'player:answerAccepted');

    // Coupure : le téléphone perd le réseau.
    alice.close();
    await delay(150);

    // Retour sur un nouveau socket via player:reconnect.
    const alice2 = connect();
    const snapP = once<any>(alice2, 'player:snapshot');
    alice2.emit('player:reconnect', { code, playerId: aliceId });
    const snap = await snapP;

    expect(snap.playerId).toBe(aliceId); // même identité
    expect(snap.alreadyAnswered).toBe(true); // sa réponse a survécu
    expect(snap.publicRound).not.toBeNull(); // il peut reprendre la manche en cours

    // Re-répondre après le retour -> refusé (pas de double-comptage).
    const rejP = once<any>(alice2, 'player:answerRejected');
    alice2.emit('player:answer', { optionIndex: 2 });
    expect((await rejP).reason).toBeTruthy();

    const resP = once<any>(host, 'round:result');
    host.emit('host:endRound');
    const result = await resP;
    expect(result.answeredCount).toBe(1); // comptée une seule fois
    expect(result.distribution[0]).toBe(1); // la réponse d'origine
    expect(result.distribution[2]).toBe(0); // la tentative post-reconnexion n'a jamais compté
    host.emit('host:endGame');
  }, 30000);

  it('coupure AVANT de répondre : au retour, le joueur peut répondre (une seule fois)', async () => {
    const { host, code, aliceId, alice } = await openRoomWithAlice();

    // Coupe avant d'avoir répondu.
    alice.close();
    await delay(150);

    const alice2 = connect();
    const snapP = once<any>(alice2, 'player:snapshot');
    alice2.emit('player:reconnect', { code, playerId: aliceId });
    const snap = await snapP;
    expect(snap.alreadyAnswered).toBe(false);
    expect(snap.publicRound).not.toBeNull();

    alice2.emit('player:answer', { optionIndex: 0 });
    await once(alice2, 'player:answerAccepted');
    // Un second envoi est refusé.
    const rejP = once<any>(alice2, 'player:answerRejected');
    alice2.emit('player:answer', { optionIndex: 1 });
    expect((await rejP).reason).toBeTruthy();

    const resP = once<any>(host, 'round:result');
    host.emit('host:endRound');
    expect((await resP).answeredCount).toBe(1);
    host.emit('host:endGame');
  }, 30000);

  it('le score est préservé après une reconnexion entre deux manches', async () => {
    const { host, code, aliceId, alice } = await openRoomWithAlice();

    alice.emit('player:answer', { optionIndex: 0 }); // bonne réponse
    await once(alice, 'player:answerAccepted');
    const resP = once<any>(host, 'round:result');
    host.emit('host:endRound');
    const result = await resP;
    const earned = result.leaderboard[0].score;
    expect(earned).toBeGreaterThan(0);

    // Coupure après le résultat, retour avant la manche suivante.
    alice.close();
    await delay(150);
    const alice2 = connect();
    const snapP = once<any>(alice2, 'player:snapshot');
    alice2.emit('player:reconnect', { code, playerId: aliceId });
    const snap = await snapP;

    expect(snap.score).toBe(earned); // score intact
    const me = snap.leaderboard.find((e: any) => e.playerId === aliceId);
    expect(me.score).toBe(earned);
    host.emit('host:endGame');
  }, 30000);
});
