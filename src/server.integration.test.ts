import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { buildServer, type BuiltServer } from './server';

let server: BuiltServer;
let port: number;
const clients: ClientSocket[] = [];

function connect(): ClientSocket {
  const socket = ioClient(`http://localhost:${port}`, { transports: ['websocket'] });
  clients.push(socket);
  return socket;
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
  server = buildServer();
  await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
  port = (server.httpServer.address() as AddressInfo).port;
});

afterAll(async () => {
  for (const c of clients) c.close();
  server.io.close();
  await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
});

describe('Flux de partie de bout en bout (Socket.IO)', () => {
  it('joue une manche complète : join, réponse, scoring serveur, classement', async () => {
    const host = connect();
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

    // L'hôte voit les deux joueurs.
    const playersUpdate = await once<any>(host, 'room:players');
    expect(playersUpdate.players.length).toBeGreaterThanOrEqual(1);

    // Démarrage de la manche.
    const roundStartedForPlayer = once<any>(alice, 'player:roundStarted');
    host.emit('host:startRound');
    const hostRound = await once<any>(host, 'host:roundStarted');
    const playerRound = await roundStartedForPlayer;

    // L'hôte reçoit la vidéo + la bonne réponse ; le joueur NON.
    expect(hostRound.hostRound.youtubeId).toBeTruthy();
    expect(hostRound.hostRound.correctIndex).toBe(0);
    expect(playerRound.publicRound.options.length).toBeGreaterThanOrEqual(2);
    expect(playerRound.publicRound.correctIndex).toBeUndefined();
    expect(playerRound.publicRound.youtubeId).toBeUndefined();

    // Alice répond juste, Bob répond faux.
    alice.emit('player:answer', { optionIndex: 0 });
    await once(alice, 'player:answerAccepted');
    bob.emit('player:answer', { optionIndex: 1 });
    await once(bob, 'player:answerAccepted');

    // Clôture de la manche.
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

    // Classement : Alice devant Bob.
    const ranked = aliceResult.leaderboard;
    expect(ranked[0].pseudo).toBe('Alice');
    expect(ranked[0].rank).toBe(1);
  });

  it('deux salles simultanées restent isolées', async () => {
    const host1 = connect();
    await once(host1, 'connect');
    host1.emit('host:createRoom', { quizId: 'demo-tubes' });
    const room1 = await once<any>(host1, 'host:roomCreated');

    const host2 = connect();
    host2.emit('host:createRoom', { quizId: 'demo-80s' });
    const room2 = await once<any>(host2, 'host:roomCreated');

    expect(room1.code).not.toBe(room2.code);

    const p1 = connect();
    p1.emit('player:join', { code: room1.code, pseudo: 'DansSalle1' });
    await once(p1, 'player:joined');

    // L'hôte 1 voit son joueur ; l'hôte 2 ne doit jamais le voir.
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
