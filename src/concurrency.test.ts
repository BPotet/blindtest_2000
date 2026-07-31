import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { buildServer, type BuiltServer } from './server';
import { hashPassword, type AuthConfig } from './auth';

// Tests de concurrence de bout en bout (vrais sockets) : ils valident que la
// couche Socket.IO tient les mêmes invariants que le moteur quand plusieurs
// joueurs (et plusieurs parties) agissent EN MÊME TEMPS sur le réseau —
// vote de masse simultané, double-envoi d'un même joueur, réponse tardive,
// et étanchéité entre parties parallèles.

let server: BuiltServer;
let port: number;
let cookie: string;
const clients: ClientSocket[] = [];

const authConfig: AuthConfig = {
  adminUsername: 'admin',
  adminPassword: 'admin',
  sessionSecret: 'concurrency-secret',
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

// Ouvre une salle et fait rejoindre `n` joueurs (en parallèle), extrait démarré.
async function openRoomWithPlayers(
  n: number,
  quizId = 'demo-tubes',
): Promise<{ host: ClientSocket; code: string; players: { s: ClientSocket; id: string; i: number }[] }> {
  const host = connect({ Cookie: cookie });
  await once(host, 'connect');
  host.emit('host:createRoom', { quizId });
  const created = await once<any>(host, 'host:roomCreated');
  const code = created.code;
  const players = await Promise.all(
    Array.from({ length: n }, (_, i) =>
      new Promise<{ s: ClientSocket; id: string; i: number }>((resolve, reject) => {
        const s = connect();
        s.once('player:joined', (p: any) => resolve({ s, id: p.playerId, i }));
        s.once('player:error', (e: any) => reject(new Error(e.message)));
        s.emit('player:join', { code, pseudo: `J${i}` });
      }),
    ),
  );
  host.emit('host:startRound');
  await once(host, 'host:roundStarted');
  const received = players.map(({ s }) => once(s, 'player:roundStarted'));
  host.emit('host:clipStarted');
  await Promise.all(received);
  return { host, code, players };
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

describe('Concurrence réseau — vote de masse simultané', () => {
  const N = 60;
  it(
    `${N} joueurs votent la MÊME option au même instant : chaque voix comptée une seule fois`,
    async () => {
      const { host, players } = await openRoomWithPlayers(N);

      const acks = players.map(({ s }) => once(s, 'player:answerAccepted'));
      // Rafale : tout le monde envoie la bonne réponse (option 0) d'un coup.
      players.forEach(({ s }) => s.emit('player:answer', { optionIndex: 0 }));
      await Promise.all(acks);

      const resultP = once<any>(host, 'round:result');
      host.emit('host:endRound');
      const result = await resultP;

      expect(result.answeredCount).toBe(N);
      expect(result.totalPlayers).toBe(N);
      expect(result.leaderboard).toHaveLength(N);
      expect(result.distribution[0]).toBe(N); // toutes les voix sur l'option 0
      expect(result.distribution.reduce((a: number, b: number) => a + b, 0)).toBe(N);
      // Personne n'est compté deux fois : la somme = le nombre de joueurs.
      host.emit('host:endGame');
    },
    30000,
  );
});

describe('Concurrence réseau — double-envoi d\'un même joueur', () => {
  it('deux envois consécutifs : une seule réponse acceptée, l\'autre rejetée', async () => {
    const { host, players } = await openRoomWithPlayers(1);
    const { s } = players[0];

    let accepted = 0;
    let rejected = 0;
    s.on('player:answerAccepted', () => { accepted += 1; });
    s.on('player:answerRejected', () => { rejected += 1; });

    // Double-clic / rejeu : deux réponses quasi-simultanées du même joueur.
    s.emit('player:answer', { optionIndex: 0 });
    s.emit('player:answer', { optionIndex: 2 }); // tente d'écraser la première
    await delay(300); // laisse le serveur traiter les deux

    expect(accepted).toBe(1);
    expect(rejected).toBe(1);

    const resultP = once<any>(host, 'round:result');
    host.emit('host:endRound');
    const result = await resultP;
    expect(result.answeredCount).toBe(1); // comptée une seule fois
    expect(result.distribution[0]).toBe(1); // la 1re réponse (option 0) fait foi
    expect(result.distribution[2]).toBe(0); // la seconde n'a jamais été enregistrée
    host.emit('host:endGame');
  }, 30000);
});

describe('Concurrence réseau — réponse tardive', () => {
  it('une réponse envoyée après la clôture de la manche est rejetée', async () => {
    const { host, players } = await openRoomWithPlayers(2);

    // Un seul joueur répond à temps ; on clôt la manche.
    players[0].s.emit('player:answer', { optionIndex: 0 });
    await once(players[0].s, 'player:answerAccepted');

    const resultP = once<any>(host, 'round:result');
    host.emit('host:endRound');
    const result = await resultP;
    expect(result.answeredCount).toBe(1);

    // Le retardataire tente de répondre APRÈS la clôture -> rejet.
    const rejected = once<any>(players[1].s, 'player:answerRejected');
    players[1].s.emit('player:answer', { optionIndex: 0 });
    const rej = await rejected;
    expect(rej.reason).toBeTruthy();
    host.emit('host:endGame');
  }, 30000);
});

describe('Concurrence réseau — parties simultanées isolées', () => {
  it('3 parties jouent en parallèle sans fuite de scores ni de joueurs', async () => {
    const rooms = await Promise.all([
      openRoomWithPlayers(5),
      openRoomWithPlayers(8),
      openRoomWithPlayers(3),
    ]);

    // Toutes les parties reçoivent leurs réponses EN MÊME TEMPS.
    await Promise.all(
      rooms.map(({ players }) => {
        const acks = players.map(({ s }) => once(s, 'player:answerAccepted'));
        players.forEach(({ s }) => s.emit('player:answer', { optionIndex: 0 }));
        return Promise.all(acks);
      }),
    );

    const results = await Promise.all(
      rooms.map(({ host }) => {
        const p = once<any>(host, 'round:result');
        host.emit('host:endRound');
        return p;
      }),
    );

    // Chaque partie ne voit QUE ses propres joueurs.
    expect(results[0].totalPlayers).toBe(5);
    expect(results[1].totalPlayers).toBe(8);
    expect(results[2].totalPlayers).toBe(3);
    results.forEach((r, i) => {
      const expected = [5, 8, 3][i];
      expect(r.answeredCount).toBe(expected);
      expect(r.leaderboard).toHaveLength(expected);
      expect(r.distribution.reduce((a: number, b: number) => a + b, 0)).toBe(expected);
    });

    rooms.forEach(({ host }) => host.emit('host:endGame'));
  }, 30000);
});
