#!/usr/bin/env node
// Test de charge Blindtest 2000 — simule G parties simultanées de N joueurs,
// tous votant en même temps (le pire cas : une rafale de réponses concurrentes).
//
// Usage :
//   node scripts/loadtest.mjs [url] [N] [G]
// Exemples :
//   node scripts/loadtest.mjs http://localhost:3000 40           # 1 partie, 40 joueurs
//   node scripts/loadtest.mjs http://localhost:3000 40 5         # 5 parties en parallèle
//   node scripts/loadtest.mjs https://blindtest-2000.onrender.com 50 3
//
// Variables d'env : ADMIN_USERNAME (défaut "admin"), ADMIN_PASSWORD (défaut "admin").
//   N (joueurs/partie), G (parties simultanées) — surchargent les arguments.
// Nécessite les dépendances de dev installées (socket.io-client). Node 20+.

import { io as ioClient } from 'socket.io-client';

const BASE = (process.argv[2] || process.env.BASE || 'http://localhost:3000').replace(/\/$/, '');
const N = Number(process.argv[3] || process.env.N || 40); // joueurs par partie
const G = Number(process.argv[4] || process.env.G || 1); // parties simultanées
const USER = process.env.ADMIN_USERNAME || 'admin';
const PASS = process.env.ADMIN_PASSWORD || 'admin';

const once = (socket, event, ms = 30000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout "${event}"`)), ms);
    socket.once(event, (p) => { clearTimeout(t); resolve(p); });
  });

// Joue une partie complète (salle + N joueurs + 1 manche), tout le monde votant
// en même temps. Renvoie ses métriques (latences, cohérence).
async function runGame(cookie, gameIndex) {
  const host = ioClient(BASE, { transports: ['websocket'], extraHeaders: { Cookie: cookie } });
  await once(host, 'connect');
  host.emit('host:createRoom', { quizId: 'demo-tubes' });
  const room = await once(host, 'host:roomCreated');

  const t0 = Date.now();
  const players = await Promise.all(
    Array.from({ length: N }, (_, i) =>
      new Promise((resolve, reject) => {
        const s = ioClient(BASE, { transports: ['websocket'] });
        s.once('player:joined', (p) => resolve({ s, id: p.playerId, i }));
        s.once('player:error', (e) => reject(new Error(e.message)));
        s.emit('player:join', { code: room.code, pseudo: `G${gameIndex}P${i}` });
      }),
    ),
  );
  const joinMs = Date.now() - t0;

  host.emit('host:startRound');
  await once(host, 'host:roundStarted');
  const questionReceived = players.map(({ s }) => once(s, 'player:roundStarted'));
  host.emit('host:clipStarted');
  await Promise.all(questionReceived);

  const latencies = [];
  const answerStart = Date.now();
  await Promise.all(
    players.map(({ s, i }) => {
      const sent = Date.now();
      const ack = once(s, 'player:answerAccepted').then(() => latencies.push(Date.now() - sent));
      s.emit('player:answer', { optionIndex: i % 4 });
      return ack;
    }),
  );
  const answerMs = Date.now() - answerStart;

  const resultP = once(host, 'round:result');
  host.emit('host:endRound');
  const result = await resultP;
  const totalMs = Date.now() - t0;

  host.emit('host:endGame');
  host.close();
  players.forEach(({ s }) => s.close());

  const ok = result.leaderboard.length === N && result.answeredCount === N;
  return { code: room.code, joinMs, answerMs, totalMs, latencies, result, ok };
}

function pct(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

async function main() {
  console.log(`▶  Cible : ${BASE}  |  Parties : ${G}  |  Joueurs/partie : ${N}  |  Total : ${G * N}`);

  // Login admin → cookie de session (réutilisé par toutes les parties).
  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  if (!login.ok) throw new Error(`Login échoué (${login.status}) — vérifie ADMIN_USERNAME/ADMIN_PASSWORD.`);
  const cookie = (/bt_session=[^;]+/.exec(login.headers.get('set-cookie') || '') || [''])[0];
  if (!cookie) throw new Error('Cookie de session absent dans la réponse de login.');

  // G parties jouées EN MÊME TEMPS.
  const wall0 = Date.now();
  const games = await Promise.all(Array.from({ length: G }, (_, g) => runGame(cookie, g)));
  const wallMs = Date.now() - wall0;

  // Agrégat.
  const allLat = games.flatMap((g) => g.latencies).sort((a, b) => a - b);
  const avg = allLat.length ? Math.round(allLat.reduce((a, b) => a + b, 0) / allLat.length) : 0;
  const okGames = games.filter((g) => g.ok).length;
  const answered = games.reduce((a, g) => a + g.result.answeredCount, 0);

  console.log('\n──── Résultats ────');
  games.forEach((g, i) =>
    console.log(
      `Partie ${i} (${g.code}) : arrivées ${g.joinMs}ms · réponses ${g.answerMs}ms · manche ${g.totalMs}ms · ${g.ok ? 'OK' : '❌'}`,
    ),
  );
  console.log('───────────────────');
  console.log(`Parties OK          : ${okGames} / ${G}`);
  console.log(`Réponses encaissées : ${answered} / ${G * N}`);
  console.log(`Latence réponse     : min ${allLat[0] ?? 0}ms · moy ${avg}ms · p95 ${pct(allLat, 0.95)}ms · max ${allLat.at(-1) ?? 0}ms`);
  console.log(`Temps mur total     : ${wallMs} ms`);
  const ok = okGames === G && answered === G * N;
  console.log(ok ? '\n✅ OK — le serveur a encaissé la charge.' : '\n❌ Incohérence : joueurs/parties manquants.');

  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('❌ Échec du test de charge :', err.message);
  process.exit(1);
});
