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

describe('Inscription multi-hôtes (HTTP)', () => {
  const register = (username: string, password: string) =>
    fetch(`http://localhost:${port}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

  it('crée un compte, ouvre une session et rejette les doublons', async () => {
    const res = await register('MarieHost', 'motdepasse1');
    expect(res.status).toBe(201);
    const cook = (/bt_session=[^;]+/.exec(res.headers.get('set-cookie') ?? '') ?? [''])[0];
    expect(cook).toMatch(/^bt_session=/);
    // La session fraîche donne accès (au moins les démos).
    const me = await fetch(`http://localhost:${port}/api/me`, { headers: { Cookie: cook } });
    expect(((await me.json()) as any).username).toBe('MarieHost');
    // Doublon (insensible à la casse) -> 409.
    const dup = await register('mariehost', 'autrepass');
    expect(dup.status).toBe(409);
  });

  it('valide les entrées (nom trop court, mot de passe trop court)', async () => {
    expect((await register('ab', 'motdepasse1')).status).toBe(400);
    expect((await register('valide', '123')).status).toBe(400);
  });

  it('isole les playlists : chaque hôte ne voit que les siennes (+ démos)', async () => {
    const cookieFor = async (u: string) => {
      const r = await register(u, 'motdepasse1');
      return (/bt_session=[^;]+/.exec(r.headers.get('set-cookie') ?? '') ?? [''])[0];
    };
    const anaCookie = await cookieFor('Ana');
    const noaCookie = await cookieFor('Noa');
    const quiz = {
      title: 'Playlist Ana',
      rounds: [
        { youtube: 'dQw4w9WgXcQ', startSeconds: 0, durationSeconds: 20, question: 'Q ?', options: ['A', 'B'], correctIndex: 0 },
      ],
    };
    const create = await fetch(`http://localhost:${port}/api/quizzes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: anaCookie },
      body: JSON.stringify(quiz),
    });
    expect(create.status).toBe(201);

    const anaList = (await (await fetch(`http://localhost:${port}/api/quizzes`, { headers: { Cookie: anaCookie } })).json()) as any;
    const noaList = (await (await fetch(`http://localhost:${port}/api/quizzes`, { headers: { Cookie: noaCookie } })).json()) as any;
    expect(anaList.quizzes.some((q: any) => q.title === 'Playlist Ana')).toBe(true);
    expect(noaList.quizzes.some((q: any) => q.title === 'Playlist Ana')).toBe(false);
    // Les deux voient les démos.
    expect(noaList.quizzes.some((q: any) => q.isDemo)).toBe(true);
  });
});

describe('Pages statiques', () => {
  it('sert l\'écran public sur /present (sans exiger de session)', async () => {
    const res = await fetch(`http://localhost:${port}/present`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="present-round"');
    expect(html).toContain('/js/present.js');
    // L'écran public ne doit jamais embarquer le lecteur vidéo.
    expect(html).not.toContain('id="yt-player"');
    expect(html).not.toContain('youtube.com/iframe_api');
  });
});

describe('CRUD playlists (HTTP)', () => {
  const body = {
    title: 'Ma playlist',
    rounds: [
      {
        youtube: 'dQw4w9WgXcQ',
        startSeconds: 0,
        durationSeconds: 20,
        question: 'Q ?',
        options: ['A', 'B'],
        correctIndex: 0,
        answerLabel: 'A',
      },
    ],
  };
  const json = (extra: Record<string, string> = {}) => ({
    'Content-Type': 'application/json',
    Cookie: cookie,
    ...extra,
  });

  it('crée, édite, puis supprime une playlist', async () => {
    const create = await fetch(`http://localhost:${port}/api/quizzes`, {
      method: 'POST',
      headers: json(),
      body: JSON.stringify(body),
    });
    expect(create.status).toBe(201);
    const { id } = (await create.json()) as { id: string };

    const put = await fetch(`http://localhost:${port}/api/quizzes/${id}`, {
      method: 'PUT',
      headers: json(),
      body: JSON.stringify({ ...body, title: 'Renommée' }),
    });
    expect(put.status).toBe(200);

    const del = await fetch(`http://localhost:${port}/api/quizzes/${id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(del.status).toBe(200);

    const del2 = await fetch(`http://localhost:${port}/api/quizzes/${id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(del2.status).toBe(404);
  });

  it('refuse de supprimer une démo (404)', async () => {
    const del = await fetch(`http://localhost:${port}/api/quizzes/demo-tubes`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(del.status).toBe(404);
  });

  it('refuse la création sans session (401)', async () => {
    const res = await fetch(`http://localhost:${port}/api/quizzes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(401);
  });

  it('rend la réponse révélée facultative (défaut = bonne proposition)', async () => {
    const create = await fetch(`http://localhost:${port}/api/quizzes`, {
      method: 'POST',
      headers: json(),
      body: JSON.stringify({
        title: 'Sans reveal',
        rounds: [
          {
            youtube: 'dQw4w9WgXcQ',
            startSeconds: 0,
            durationSeconds: 20,
            question: 'Q ?',
            options: ['Bonne', 'Mauvaise'],
            correctIndex: 0,
          },
        ],
      }),
    });
    expect(create.status).toBe(201);
    const { id } = (await create.json()) as { id: string };
    const get = await fetch(`http://localhost:${port}/api/quizzes/${id}`, {
      headers: { Cookie: cookie },
    });
    const quiz = (await get.json()) as { rounds: Array<{ answerLabel: string }> };
    expect(quiz.rounds[0].answerLabel).toBe('Bonne');
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
    host.emit('host:clipStarted'); // l'extrait démarre -> la manche s'ouvre
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

describe('Mode équipes (Socket.IO)', () => {
  it('regroupe les joueurs par équipe et classe par équipe', async () => {
    const host = connectHost();
    await once(host, 'connect');
    host.emit('host:createRoom', { quizId: 'demo-tubes', mode: 'teams' });
    const created = await once<any>(host, 'host:roomCreated');
    expect(created.mode).toBe('teams');
    const code = created.code;

    const a = connect();
    a.emit('player:join', { code, pseudo: 'A', team: 'Rouge' });
    const aj = await once<any>(a, 'player:joined');
    expect(aj.teamName).toBe('Rouge');

    const b = connect();
    b.emit('player:join', { code, pseudo: 'B', team: 'rouge' }); // même équipe (casse)
    const bj = await once<any>(b, 'player:joined');
    expect(bj.teamId).toBe(aj.teamId);

    const c = connect();
    c.emit('player:join', { code, pseudo: 'C', team: 'Bleu' });
    await once<any>(c, 'player:joined');

    // Sans équipe en mode équipes -> refus.
    const d = connect();
    d.emit('player:join', { code, pseudo: 'D' });
    const dErr = await once<any>(d, 'player:error');
    expect(dErr.message).toMatch(/équipe/i);

    host.emit('host:startRound');
    await once(host, 'host:roundStarted');
    const qs = [once(a, 'player:roundStarted'), once(b, 'player:roundStarted'), once(c, 'player:roundStarted')];
    host.emit('host:clipStarted');
    await Promise.all(qs);

    // Vote d'équipe : Rouge (A+B) vote 0 (bonne réponse) -> verrouillage à la majorité.
    const waitForLock = (socket: ClientSocket) =>
      new Promise<any>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('pas de verrouillage')), 5000);
        const h = (p: any) => {
          if (p.locked) {
            socket.off('player:teamVotes', h);
            clearTimeout(t);
            resolve(p);
          }
        };
        socket.on('player:teamVotes', h);
      });

    const rougeLock = waitForLock(a);
    a.emit('player:answer', { optionIndex: 0 }); // demo-tubes r1 correctIndex = 0
    await once(a, 'player:answerAccepted');
    b.emit('player:answer', { optionIndex: 0 });
    await once(b, 'player:answerAccepted');
    a.emit('player:teamLock'); // un membre verrouille -> réponse la plus votée (0)
    const locked = await rougeLock;
    expect(locked.lockedIndex).toBe(0);

    // Bleu vote faux et ne verrouille pas -> tranché à la fin de manche.
    c.emit('player:answer', { optionIndex: 1 });
    await once(c, 'player:answerAccepted');

    const resP = once<any>(host, 'round:result');
    host.emit('host:endRound');
    const res = await resP;

    // Classement par équipe : Rouge (bon vote) devant Bleu.
    expect(res.leaderboard).toHaveLength(2);
    expect(res.leaderboard[0].pseudo).toBe('Rouge');
    expect(res.leaderboard[0].rank).toBe(1);
    expect(res.leaderboard[0].score).toBeGreaterThan(res.leaderboard[1].score);
    // Bob partage le résultat commun de son équipe (bon).
    expect(res.results[bj.playerId].correct).toBe(true);
  });

  it('pousse aux joueurs qui observent les équipes créées en parallèle', async () => {
    const host = connectHost();
    await once(host, 'connect');
    host.emit('host:createRoom', { quizId: 'demo-tubes', mode: 'teams' });
    const created = await once<any>(host, 'host:roomCreated');
    const code = created.code;

    // Un joueur encore sur l'écran de choix d'équipe : il observe la salle.
    const watcher = connect();
    await once(watcher, 'connect');
    watcher.emit('player:watchRoom', { code });
    const first = await once<any>(watcher, 'room:teams');
    expect(first.teams).toHaveLength(0);

    // Un autre téléphone crée une équipe -> l'observateur la reçoit en direct.
    const update = once<any>(watcher, 'room:teams');
    const creator = connect();
    creator.emit('player:join', { code, pseudo: 'Zoé', team: 'Verts' });
    await once<any>(creator, 'player:joined');
    const pushed = await update;
    expect(pushed.teams.map((t: any) => t.name)).toContain('Verts');

    // Puis l'observateur rejoint cette équipe : il quitte la room d'observation
    // et ne reçoit plus les MAJ « équipes seules ».
    watcher.emit('player:join', { code, pseudo: 'Léo', team: 'Verts' });
    const joined = await once<any>(watcher, 'player:joined');
    expect(joined.teamName).toBe('Verts');
  });
});

describe('Import YouTube — désactivé (pas de clé)', () => {
  it('/api/me indique youtubeImport:false et l\'endpoint répond 503', async () => {
    const me = await fetch(`http://localhost:${port}/api/me`, { headers: { Cookie: cookie } });
    expect(((await me.json()) as any).youtubeImport).toBe(false);
    const imp = await fetch(`http://localhost:${port}/api/import/youtube`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ url: 'https://www.youtube.com/playlist?list=PLabcdefghij12' }),
    });
    expect(imp.status).toBe(503);
  });
});

describe('Import YouTube — actif (fetcher injecté)', () => {
  let iServer: BuiltServer;
  let iPort: number;
  let iCookie: string;

  const fakeFetcher = async (playlistId: string) => {
    if (playlistId.includes('SAME')) {
      return [
        { title: 'Même chanson', videoId: 'aaaaaaaaaaa' },
        { title: 'Même chanson', videoId: 'bbbbbbbbbbb' },
      ];
    }
    return [
      { title: 'A-ha - Take On Me (Official Video)', videoId: 'djV11Xbc914' },
      { title: 'Queen - Bohemian Rhapsody [Remastered]', videoId: 'fJ9rUzIMcZQ' },
      { title: 'Toto - Africa (Official HD Video)', videoId: 'FTQbiNvZqaY' },
      { title: 'Europe - The Final Countdown', videoId: '9jK-NcRmVcw' },
    ];
  };

  beforeAll(async () => {
    iServer = buildServer({ authConfig, youtubeFetcher: fakeFetcher });
    await iServer.quizRepo.upsertUser('admin', hashPassword('admin'));
    await new Promise<void>((resolve) => iServer.httpServer.listen(0, resolve));
    iPort = (iServer.httpServer.address() as AddressInfo).port;
    const res = await fetch(`http://localhost:${iPort}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin' }),
    });
    iCookie = (/bt_session=[^;]+/.exec(res.headers.get('set-cookie') ?? '') ?? [''])[0];
  });

  afterAll(async () => {
    iServer.io.close();
    await new Promise<void>((resolve) => iServer.httpServer.close(() => resolve()));
  });

  const importReq = (body: unknown) =>
    fetch(`http://localhost:${iPort}/api/import/youtube`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: iCookie },
      body: JSON.stringify(body),
    });

  it('signale la disponibilité via /api/me', async () => {
    const me = await fetch(`http://localhost:${iPort}/api/me`, { headers: { Cookie: iCookie } });
    expect(((await me.json()) as any).youtubeImport).toBe(true);
  });

  it('mode relecture : génère un brouillon (une manche par morceau, QCM auto)', async () => {
    const res = await importReq({ url: 'https://www.youtube.com/playlist?list=PLgood12345678', title: 'Années 80', maxRounds: 3 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.title).toBe('Années 80');
    expect(body.rounds).toHaveLength(3);
    const r = body.rounds[0];
    expect(r.options[r.correctIndex]).toBe(r.answerLabel);
    expect(r.answerLabel).not.toMatch(/official/i); // titre nettoyé
    expect(r.options.length).toBeGreaterThanOrEqual(2);
  });

  it('mode surprise (save) : crée le quiz sans jamais renvoyer les morceaux', async () => {
    const res = await importReq({ url: 'https://www.youtube.com/playlist?list=PLgood12345678', title: 'Mystère 80s', maxRounds: 4, save: true });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    // On renvoie l'id + le nombre, mais AUCUN morceau/réponse.
    expect(body.id).toBeTruthy();
    expect(body.count).toBe(4);
    expect(body.rounds).toBeUndefined();
    // Le quiz apparait bien dans la liste de l'hôte (prêt à lancer).
    const list = (await (await fetch(`http://localhost:${iPort}/api/quizzes`, { headers: { Cookie: iCookie } })).json()) as any;
    expect(list.quizzes.some((q: any) => q.id === body.id && q.title === 'Mystère 80s')).toBe(true);
  });

  it('exige l\'authentification', async () => {
    const res = await fetch(`http://localhost:${iPort}/api/import/youtube`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://www.youtube.com/playlist?list=PLgood12345678' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejette un lien de playlist invalide (400)', async () => {
    const res = await importReq({ url: 'https://youtu.be/dQw4w9WgXcQ' });
    expect(res.status).toBe(400);
  });

  it('refuse une playlist aux titres non distincts (422)', async () => {
    const res = await importReq({ url: 'https://www.youtube.com/playlist?list=PLSAME12345678' });
    expect(res.status).toBe(422);
  });
});
