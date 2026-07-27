#!/usr/bin/env node
// Test de charge Blindtest 2000 — simule N joueurs sur une manche complète.
//
// Usage :
//   node scripts/loadtest.mjs [url] [N]
// Exemples :
//   node scripts/loadtest.mjs http://localhost:3000 40
//   node scripts/loadtest.mjs https://blindtest-2000.onrender.com 50
//
// Variables d'env : ADMIN_USERNAME (défaut "admin"), ADMIN_PASSWORD (défaut "admin").
// Nécessite les dépendances de dev installées (socket.io-client). Node 20+.

import { io as ioClient } from 'socket.io-client';

const BASE = (process.argv[2] || process.env.BASE || 'http://localhost:3000').replace(/\/$/, '');
const N = Number(process.argv[3] || process.env.N || 40);
const USER = process.env.ADMIN_USERNAME || 'admin';
const PASS = process.env.ADMIN_PASSWORD || 'admin';

const once = (socket, event, ms = 30000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout "${event}"`)), ms);
    socket.once(event, (p) => { clearTimeout(t); resolve(p); });
  });

async function main() {
  console.log(`▶  Cible : ${BASE}  |  Joueurs : ${N}`);

  // 1) Login admin → cookie de session.
  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  if (!login.ok) throw new Error(`Login échoué (${login.status}) — vérifie ADMIN_USERNAME/ADMIN_PASSWORD.`);
  const cookie = (/bt_session=[^;]+/.exec(login.headers.get('set-cookie') || '') || [''])[0];
  if (!cookie) throw new Error('Cookie de session absent dans la réponse de login.');

  // 2) Hôte : ouvre une salle.
  const host = ioClient(BASE, { transports: ['websocket'], extraHeaders: { Cookie: cookie } });
  await once(host, 'connect');
  host.emit('host:createRoom', { quizId: 'demo-tubes' });
  const room = await once(host, 'host:roomCreated');
  console.log(`✓  Salle ${room.code} ouverte.`);

  // 3) N joueurs rejoignent (en parallèle).
  const t0 = Date.now();
  const players = await Promise.all(
    Array.from({ length: N }, (_, i) =>
      new Promise((resolve, reject) => {
        const s = ioClient(BASE, { transports: ['websocket'] });
        s.once('player:joined', (p) => resolve({ s, id: p.playerId, i }));
        s.once('player:error', (e) => reject(new Error(e.message)));
        s.emit('player:join', { code: room.code, pseudo: `Bot${i}` });
      }),
    ),
  );
  const joinMs = Date.now() - t0;
  console.log(`✓  ${players.length} joueurs connectés en ${joinMs} ms.`);

  // 4) Manche : démarrage, réponses, latences.
  host.emit('host:startRound');
  await once(host, 'host:roundStarted');
  // L'extrait démarre : la manche s'ouvre pour les joueurs.
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

  // 5) Rapport.
  latencies.sort((a, b) => a - b);
  const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
  const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? latencies.at(-1);
  console.log('\n──── Résultats ────');
  console.log(`Joueurs classés     : ${result.leaderboard.length} / ${N}`);
  console.log(`Réponses encaissées : ${result.answeredCount} / ${N}`);
  console.log(`Arrivées            : ${joinMs} ms`);
  console.log(`Toutes les réponses : ${answerMs} ms`);
  console.log(`Latence réponse     : min ${latencies[0]}ms · moy ${avg}ms · p95 ${p95}ms · max ${latencies.at(-1)}ms`);
  console.log(`Manche complète     : ${totalMs} ms`);
  const ok = result.leaderboard.length === N && result.answeredCount === N;
  console.log(ok ? '\n✅ OK — le serveur a encaissé la charge.' : '\n❌ Incohérence : joueurs manquants.');

  host.emit('host:endGame');
  host.close();
  players.forEach(({ s }) => s.close());
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('❌ Échec du test de charge :', err.message);
  process.exit(1);
});
