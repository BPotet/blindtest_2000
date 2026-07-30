import { describe, it, expect } from 'vitest';
import { Room, RoomManager } from './room';
import type { Quiz } from '../types';
import { BASE_POINTS } from './scoring';

function makeQuiz(): Quiz {
  return {
    id: 'q1',
    title: 'Test',
    ownerId: null,
    rounds: [
      {
        id: 'r1',
        youtubeId: 'aaaaaaaaaaa',
        startSeconds: 0,
        durationSeconds: 20,
        question: 'Q1 ?',
        options: ['A', 'B', 'C'],
        correctIndex: 1,
        answerLabel: 'Réponse 1',
      },
      {
        id: 'r2',
        youtubeId: 'bbbbbbbbbbb',
        startSeconds: 0,
        durationSeconds: 20,
        question: 'Q2 ?',
        options: ['X', 'Y'],
        correctIndex: 0,
        answerLabel: 'Réponse 2',
      },
    ],
  };
}

describe('Room — lobby', () => {
  it('accepte des joueurs dans le lobby', () => {
    const room = new Room(makeQuiz(), 'ABCDE');
    const r = room.addPlayer('Alice', 's1');
    expect('player' in r).toBe(true);
    expect(room.playerCount).toBe(1);
  });

  it('refuse un pseudo déjà pris (insensible à la casse)', () => {
    const room = new Room(makeQuiz(), 'ABCDE');
    room.addPlayer('Alice', 's1');
    const r = room.addPlayer('alice', 's2');
    expect('error' in r).toBe(true);
    expect(room.playerCount).toBe(1);
  });

  it('refuse de rejoindre une partie déjà lancée', () => {
    const room = new Room(makeQuiz(), 'ABCDE');
    room.startNextRound();
    const r = room.addPlayer('Bob', 's1');
    expect('error' in r).toBe(true);
  });

  it('accepte un nombre arbitrairement grand de joueurs', () => {
    const room = new Room(makeQuiz(), 'ABCDE');
    for (let i = 0; i < 1000; i++) {
      expect('player' in room.addPlayer(`Joueur${i}`, `s${i}`)).toBe(true);
    }
    expect(room.playerCount).toBe(1000);
  });
});

describe('Room — déroulé et scoring', () => {
  it('scoring serveur : bonne réponse rapide > bonne réponse lente > mauvaise', () => {
    const room = new Room(makeQuiz(), 'ABCDE');
    const fast = room.addPlayer('Fast', 's1');
    const slow = room.addPlayer('Slow', 's2');
    const wrong = room.addPlayer('Wrong', 's3');
    if (!('player' in fast) || !('player' in slow) || !('player' in wrong)) throw new Error();

    const started = room.startNextRound();
    expect(started).not.toBeNull();
    room.markClipStarted(1000);

    room.submitAnswer(fast.player.id, 1, 2000); // +1000ms, correct
    room.submitAnswer(slow.player.id, 1, 15000); // +14000ms, correct
    room.submitAnswer(wrong.player.id, 0, 3000); // faux

    const result = room.endRound();
    expect(result).not.toBeNull();
    const perPlayer = result!.perPlayer;
    expect(perPlayer.get(fast.player.id)!.correct).toBe(true);
    expect(perPlayer.get(wrong.player.id)!.correct).toBe(false);
    expect(perPlayer.get(wrong.player.id)!.pointsAwarded).toBe(0);
    expect(perPlayer.get(fast.player.id)!.pointsAwarded).toBeGreaterThan(
      perPlayer.get(slow.player.id)!.pointsAwarded,
    );
    expect(perPlayer.get(slow.player.id)!.pointsAwarded).toBeGreaterThanOrEqual(BASE_POINTS);
  });

  it('main la plus rapide / lente = premier / dernier à répondre, MÊME faux', () => {
    const room = new Room(makeQuiz(), 'ABCDE');
    const fast = room.addPlayer('Fast', 's1');
    const slow = room.addPlayer('Slow', 's2');
    const wrong = room.addPlayer('Wrong', 's3');
    if (!('player' in fast) || !('player' in slow) || !('player' in wrong)) throw new Error();

    room.startNextRound();
    room.markClipStarted(1000);
    room.submitAnswer(wrong.player.id, 0, 1200); // FAUX mais dégainé en premier (+200ms)
    room.submitAnswer(fast.player.id, 1, 2000); // bonne, +1000ms
    room.submitAnswer(slow.player.id, 1, 9000); // bonne, +8000ms (la plus lente)

    const r = room.endRound()!;
    expect(r.fastest).toEqual({ name: 'Wrong', elapsedMs: 200 }); // faux, mais le plus rapide
    expect(r.slowest).toEqual({ name: 'Slow', elapsedMs: 8000 });
    expect(r.slowestNoAnswer).toBe(false);
    expect(r.youtubeId).toBe('aaaaaaaaaaa'); // payoff : l'ID vidéo est dévoilé
  });

  it('une réponse fausse compte quand même comme une main', () => {
    const room = new Room(makeQuiz(), 'ABCDE');
    const a = room.addPlayer('A', 's1');
    if (!('player' in a)) throw new Error();
    room.startNextRound();
    room.markClipStarted(1000);
    room.submitAnswer(a.player.id, 0, 1500); // faux (bonne = index 1), +500ms
    expect(room.endRound()!.fastest).toEqual({ name: 'A', elapsedMs: 500 });
  });

  it('ne pas répondre = la main la plus lente (même sans réponse)', () => {
    const room = new Room(makeQuiz(), 'ABCDE');
    const a = room.addPlayer('A', 's1');
    const b = room.addPlayer('B', 's2');
    if (!('player' in a) || !('player' in b)) throw new Error();
    room.startNextRound();
    room.markClipStarted(0);
    room.submitAnswer(a.player.id, 1, 3000); // A répond ; B ne répond pas du tout
    const r = room.endRound()!;
    expect(r.fastest).toEqual({ name: 'A', elapsedMs: 3000 });
    expect(r.slowest!.name).toBe('B'); // B a laissé filer le temps -> la plus lente
    expect(r.slowestNoAnswer).toBe(true);
    expect(r.atBuzzer).toBe(false);
  });

  it('badges de manche : main la plus lente, au buzzer, seul contre tous', () => {
    const room = new Room(makeQuiz(), 'ABCDE'); // durée 20 s -> fenêtre 20000 ms
    const alice = room.addPlayer('Alice', 's1');
    const carol = room.addPlayer('Carol', 's2');
    const bob = room.addPlayer('Bob', 's3');
    if (!('player' in alice) || !('player' in carol) || !('player' in bob)) throw new Error();
    room.startNextRound();
    room.markClipStarted(1000);
    room.submitAnswer(alice.player.id, 1, 1500); // bonne, +500ms -> la plus rapide
    room.submitAnswer(carol.player.id, 1, 20500); // bonne, +19500ms -> la plus lente, au buzzer
    room.submitAnswer(bob.player.id, 0, 3000); // faux

    const r = room.endRound()!;
    expect(r.fastest).toEqual({ name: 'Alice', elapsedMs: 500 });
    expect(r.slowest).toEqual({ name: 'Carol', elapsedMs: 19500 });
    expect(r.atBuzzer).toBe(true);
    expect(r.soloCorrect).toBeNull(); // deux ont trouvé
  });

  it('révélation manuelle : closeAnswers ferme la fenêtre sans révéler', () => {
    const room = new Room(makeQuiz(), 'ABCDE', 'solo', true, false, true);
    expect(room.manualReveal).toBe(true);
    const a = room.addPlayer('Alice', 's1');
    const b = room.addPlayer('Bob', 's2');
    if (!('player' in a) || !('player' in b)) throw new Error();
    room.startNextRound();
    room.markClipStarted(1000);
    expect(room.submitAnswer(a.player.id, 1, 1500).accepted).toBe(true); // avant la fermeture

    expect(room.closeAnswers()).toBe(true);
    expect(room.areAnswersClosed()).toBe(true);
    // Réponse refusée une fois le temps écoulé.
    expect(room.submitAnswer(b.player.id, 1, 2000).accepted).toBe(false);
    // La manche est toujours « en cours » : l'hôte peut encore révéler.
    expect(room.getState()).toBe('playing');
    const r = room.endRound();
    expect(r).not.toBeNull();
    expect(r!.answerLabel).toBe('Réponse 1');
  });

  it('closeAnswers est sans effet hors manche et se réinitialise à la manche suivante', () => {
    const room = new Room(makeQuiz(), 'ABCDE', 'solo', true, false, true);
    room.addPlayer('Alice', 's1');
    expect(room.closeAnswers()).toBe(false); // pas de manche en cours
    room.startNextRound();
    room.markClipStarted(0);
    expect(room.closeAnswers()).toBe(true);
    room.endRound();
    room.startNextRound(); // manche 2
    expect(room.areAnswersClosed()).toBe(false); // réinitialisé
  });

  it('rejouer la manche : efface les réponses et rouvre le MÊME round', () => {
    const room = new Room(makeQuiz(), 'ABCDE');
    const a = room.addPlayer('Alice', 's1');
    if (!('player' in a)) throw new Error();
    room.startNextRound();
    const idx = room.getCurrentRoundIndex();
    room.markClipStarted(0);
    room.submitAnswer(a.player.id, 0, 500); // mauvaise (bonne = 1)

    const replay = room.replayRound();
    expect(replay).not.toBeNull();
    expect(room.getCurrentRoundIndex()).toBe(idx); // même manche, pas la suivante
    expect(room.areAnswersClosed()).toBe(false);

    // La réponse précédente est effacée : on peut re-répondre (et bien, cette fois).
    room.markClipStarted(0);
    expect(room.submitAnswer(a.player.id, 1, 300).accepted).toBe(true);
    expect(room.endRound()!.perPlayer.get(a.player.id)!.correct).toBe(true);
  });

  it('rejouer rouvre les réponses après un temps écoulé (révélation manuelle)', () => {
    const room = new Room(makeQuiz(), 'ABCDE', 'solo', true, false, true);
    const a = room.addPlayer('Alice', 's1');
    if (!('player' in a)) throw new Error();
    room.startNextRound();
    room.markClipStarted(0);
    room.closeAnswers(); // temps écoulé
    expect(room.replayRound()).not.toBeNull();
    expect(room.areAnswersClosed()).toBe(false);
  });

  it('rejouer refusé hors d\'une manche', () => {
    const room = new Room(makeQuiz(), 'ABCDE');
    expect(room.replayRound()).toBeNull(); // au lobby
  });

  it('répartition en direct des votes (pour l\'écran de l\'hôte)', () => {
    const room = new Room(makeQuiz(), 'ABCDE'); // 3 options
    const a = room.addPlayer('A', 's1');
    const b = room.addPlayer('B', 's2');
    const c = room.addPlayer('C', 's3');
    if (!('player' in a) || !('player' in b) || !('player' in c)) throw new Error();
    room.startNextRound();
    room.markClipStarted(0);
    expect(room.liveDistribution()).toEqual([0, 0, 0]);
    room.submitAnswer(a.player.id, 1, 100);
    room.submitAnswer(b.player.id, 1, 200);
    room.submitAnswer(c.player.id, 0, 300);
    expect(room.liveDistribution()).toEqual([1, 2, 0]);
  });

  it('« seul contre tous » quand une seule unité trouve', () => {
    const room = new Room(makeQuiz(), 'ABCDE');
    const alice = room.addPlayer('Alice', 's1');
    const bob = room.addPlayer('Bob', 's2');
    if (!('player' in alice) || !('player' in bob)) throw new Error();
    room.startNextRound();
    room.markClipStarted(1000);
    room.submitAnswer(alice.player.id, 1, 2000); // seule bonne réponse
    room.submitAnswer(bob.player.id, 0, 2500); // faux
    expect(room.endRound()!.soloCorrect).toBe('Alice');
  });

  it('palmarès de fin : Éclair, Tranquille, Meilleure série, Sniper, Remontada', () => {
    const room = new Room(makeQuiz(), 'ABCDE'); // 2 manches (correctIndex 1 puis 0)
    const alice = room.addPlayer('Alice', 's1');
    const bob = room.addPlayer('Bob', 's2');
    if (!('player' in alice) || !('player' in bob)) throw new Error();

    // Manche 1 : Bob trouve (rapide), Alice se trompe -> Bob mène.
    room.startNextRound();
    room.markClipStarted(0);
    room.submitAnswer(bob.player.id, 1, 800);
    room.submitAnswer(alice.player.id, 0, 1000);
    room.endRound();

    // Manche 2 : Alice trouve, Bob se trompe -> Alice double Bob (remontada).
    room.startNextRound();
    room.markClipStarted(0);
    room.submitAnswer(alice.player.id, 0, 500); // bonne (index 0)
    room.submitAnswer(bob.player.id, 1, 900); // faux
    room.endRound();

    const awards = room.computeAwards();
    const by = (k: string) => awards.find((a) => a.key === k);
    // Chacun a été « le plus rapide » une fois : l'Éclair revient au premier trouvé (Bob).
    expect(by('eclair')).toBeTruthy();
    // Meilleure série : Alice n'a pas enchaîné (1 seule bonne), Bob non plus (1) -> min 2 non atteint.
    expect(by('serie')).toBeUndefined();
    // Sniper : une bonne réponse chacun -> un gagnant est désigné (départage stable).
    expect(by('sniper')).toBeTruthy();
    // Remontada : Alice passe de la 2e à la 1re place.
    expect(by('remontada')).toMatchObject({ winner: 'Alice' });
  });

  it('calcule la répartition des réponses en fin de manche', () => {
    const room = new Room(makeQuiz(), 'ABCDE');
    const a = room.addPlayer('A', 's1');
    const b = room.addPlayer('B', 's2');
    const c = room.addPlayer('C', 's3');
    if (!('player' in a) || !('player' in b) || !('player' in c)) throw new Error();
    room.startNextRound();
    room.markClipStarted(0);
    room.submitAnswer(a.player.id, 1, 100); // bonne (index 1)
    room.submitAnswer(b.player.id, 1, 200); // bonne
    room.submitAnswer(c.player.id, 0, 300); // mauvaise (index 0)
    // le 4e joueur ne répond pas
    room.addPlayer; // noop
    const result = room.endRound();
    expect(result).not.toBeNull();
    expect(result!.distribution).toEqual([1, 2, 0]); // 1 sur A, 2 sur B, 0 sur C
    expect(result!.answeredCount).toBe(3);
    expect(result!.correctCount).toBe(2);
    expect(result!.totalPlayers).toBe(3);
    expect(result!.options).toEqual(['A', 'B', 'C']);
  });

  it('verrouille au premier tap (ignore les réponses suivantes)', () => {
    const room = new Room(makeQuiz(), 'ABCDE');
    const p = room.addPlayer('Alice', 's1');
    if (!('player' in p)) throw new Error();
    room.startNextRound();
    room.markClipStarted(0);
    expect(room.submitAnswer(p.player.id, 0, 100).accepted).toBe(true); // faux, mais enregistré
    const second = room.submitAnswer(p.player.id, 1, 200); // tenterait la bonne réponse
    expect(second.accepted).toBe(false);
    const result = room.endRound();
    expect(result!.perPlayer.get(p.player.id)!.correct).toBe(false);
  });

  it('ignore les réponses hors manche', () => {
    const room = new Room(makeQuiz(), 'ABCDE');
    const p = room.addPlayer('Alice', 's1');
    if (!('player' in p)) throw new Error();
    expect(room.submitAnswer(p.player.id, 1, 100).accepted).toBe(false);
  });

  it("refuse les réponses tant que l'extrait n'a pas démarré", () => {
    const room = new Room(makeQuiz(), 'ABCDE');
    const p = room.addPlayer('Alice', 's1');
    if (!('player' in p)) throw new Error();
    room.startNextRound();
    expect(room.isClipStarted()).toBe(false);
    expect(room.submitAnswer(p.player.id, 1, 100).accepted).toBe(false); // trop tôt
    room.markClipStarted(0);
    expect(room.isClipStarted()).toBe(true);
    expect(room.submitAnswer(p.player.id, 1, 100).accepted).toBe(true);
  });

  it('enchaîne les manches et termine après la dernière', () => {
    const room = new Room(makeQuiz(), 'ABCDE');
    expect(room.startNextRound()).not.toBeNull(); // r1
    room.endRound();
    expect(room.startNextRound()).not.toBeNull(); // r2
    expect(room.isLastRound()).toBe(true);
    room.endRound();
    expect(room.startNextRound()).toBeNull(); // plus de manche
  });

  it('cumule les scores sur plusieurs manches', () => {
    const room = new Room(makeQuiz(), 'ABCDE');
    const p = room.addPlayer('Alice', 's1');
    if (!('player' in p)) throw new Error();
    room.startNextRound();
    room.markClipStarted(0);
    room.submitAnswer(p.player.id, 1, 0); // r1 correct
    room.endRound();
    room.startNextRound();
    room.markClipStarted(0);
    room.submitAnswer(p.player.id, 0, 0); // r2 correct
    room.endRound();
    const entry = room.leaderboard().find((e) => e.playerId === p.player.id);
    expect(entry!.score).toBeGreaterThan(BASE_POINTS * 2);
  });
});

describe('Room — reconnexion', () => {
  it('conserve le score à la reconnexion', () => {
    const room = new Room(makeQuiz(), 'ABCDE');
    const p = room.addPlayer('Alice', 's1');
    if (!('player' in p)) throw new Error();
    room.startNextRound();
    room.markClipStarted(0);
    room.submitAnswer(p.player.id, 1, 0);
    room.endRound();
    room.markDisconnected('s1');
    const reconnected = room.reconnectPlayer(p.player.id, 's2');
    expect(reconnected).not.toBeNull();
    expect(reconnected!.score).toBeGreaterThanOrEqual(BASE_POINTS);
    expect(reconnected!.connected).toBe(true);
  });

  it('renvoie null pour un joueur inconnu', () => {
    const room = new Room(makeQuiz(), 'ABCDE');
    expect(room.reconnectPlayer('inconnu', 's1')).toBeNull();
  });
});

describe('Room — mode équipes', () => {
  it('exige une équipe en mode équipes', () => {
    const room = new Room(makeQuiz(), 'ABCDE', 'teams');
    expect('error' in room.addPlayer('Alice', 's1')).toBe(true);
    expect('error' in room.addPlayer('Alice', 's1', '   ')).toBe(true);
  });

  it('crée puis rejoint une équipe (insensible à la casse)', () => {
    const room = new Room(makeQuiz(), 'ABCDE', 'teams');
    const a = room.addPlayer('Alice', 's1', 'Les Bleus');
    const b = room.addPlayer('Bob', 's2', 'les bleus');
    if (!('player' in a) || !('player' in b)) throw new Error();
    expect(a.player.teamName).toBe('Les Bleus');
    expect(b.player.teamId).toBe(a.player.teamId);
    expect(room.listTeams()).toHaveLength(1);
    expect(room.listTeams()[0].memberCount).toBe(2);
  });

  it('vote d\'équipe : pas d\'auto-lock, verrouillage manuel par un membre (plus voté)', () => {
    const room = new Room(makeQuiz(), 'ABCDE', 'teams');
    const a = room.addPlayer('Alice', 's1', 'Rouge');
    const b = room.addPlayer('Bob', 's2', 'Rouge');
    if (!('player' in a) || !('player' in b)) throw new Error();
    const rougeId = a.player.teamId!;
    room.startNextRound();
    room.markClipStarted(0);

    // Les deux votent la bonne (1) : PAS de verrouillage automatique.
    room.submitAnswer(a.player.id, 1, 100);
    room.submitAnswer(b.player.id, 1, 200);
    expect(room.getTeamVoteState(rougeId).locked).toBe(false);
    // Alice change d'avis tant que non verrouillé.
    room.submitAnswer(a.player.id, 0, 250);
    expect(room.getTeamVoteState(rougeId).counts).toEqual([1, 1, 0]);
    room.submitAnswer(a.player.id, 1, 300); // revient sur 1 -> Rouge = 2 voix sur 1

    // N'importe quel membre verrouille -> réponse la plus votée (1).
    const res = room.lockTeam(b.player.id, 400);
    expect(res.locked).toBe(true);
    const st = room.getTeamVoteState(rougeId);
    expect(st.locked).toBe(true);
    expect(st.lockedIndex).toBe(1);
    // Après verrouillage : plus de vote ni de re-lock.
    expect(room.submitAnswer(a.player.id, 0, 500).accepted).toBe(false);
    expect(room.lockTeam(a.player.id, 500).locked).toBe(false);
  });

  it('vote d\'équipe : sans verrouillage, la fin du timer prend le plus voté (départage : 1er voté)', () => {
    const room = new Room(makeQuiz(), 'ABCDE', 'teams');
    const a = room.addPlayer('Alice', 's1', 'Rouge');
    const b = room.addPlayer('Bob', 's2', 'Rouge');
    const c = room.addPlayer('Carol', 's3', 'Bleu');
    if (!('player' in a) || !('player' in b) || !('player' in c)) throw new Error();
    room.startNextRound();
    room.markClipStarted(0);
    // Rouge : égalité 1-1, mais la bonne (1) a été votée en premier.
    room.submitAnswer(a.player.id, 1, 100);
    room.submitAnswer(b.player.id, 0, 200);
    room.submitAnswer(c.player.id, 0, 100); // Bleu faux
    // Personne ne verrouille -> la fin de manche tranche.
    expect(room.getTeamVoteState(a.player.teamId!).locked).toBe(false);
    const result = room.endRound();
    expect(result!.answeredCount).toBe(2);
    const lb = room.leaderboard();
    expect(lb[0].pseudo).toBe('Rouge'); // départage -> option 1 (votée en premier) = bonne
    expect(lb[0].score).toBeGreaterThan(lb[1].score);
  });

  it('vote d\'équipe : verrouiller tôt rapporte plus que laisser filer le timer', () => {
    const room = new Room(makeQuiz(), 'ABCDE', 'teams');
    const a = room.addPlayer('A', 's1', 'Tot');
    const b = room.addPlayer('B', 's2', 'Tard');
    if (!('player' in a) || !('player' in b)) throw new Error();
    room.startNextRound();
    room.markClipStarted(0);
    room.submitAnswer(a.player.id, 1, 100);
    room.lockTeam(a.player.id, 200); // "Tot" verrouille tôt
    room.submitAnswer(b.player.id, 1, 300); // "Tard" vote juste mais ne verrouille pas
    room.endRound();
    const lb = room.leaderboard();
    const tot = lb.find((e) => e.pseudo === 'Tot')!;
    const tard = lb.find((e) => e.pseudo === 'Tard')!;
    expect(tot.score).toBeGreaterThan(tard.score); // bonus de vitesse au verrouillage
  });

  it('reste en solo par défaut (pas d\'équipe requise)', () => {
    const room = new Room(makeQuiz(), 'ABCDE');
    expect(room.getMode()).toBe('solo');
    expect('player' in room.addPlayer('Alice', 's1')).toBe(true);
  });
});

describe('Room — combo (bonus de série)', () => {
  it('applique un bonus de série croissant quand le combo est activé', () => {
    const room = new Room(makeQuiz(), 'ABCDE', 'solo', true);
    const p = room.addPlayer('Alice', 's1');
    if (!('player' in p)) throw new Error();
    room.startNextRound();
    room.markClipStarted(0);
    room.submitAnswer(p.player.id, 1, 0); // r1 correct (index 1) -> série 1
    const r1 = room.endRound()!.perPlayer.get(p.player.id)!;
    expect(r1.streak).toBe(1);
    expect(r1.comboBonus).toBe(0);
    room.startNextRound();
    room.markClipStarted(0);
    room.submitAnswer(p.player.id, 0, 0); // r2 correct (index 0) -> série 2 -> +100
    const r2 = room.endRound()!.perPlayer.get(p.player.id)!;
    expect(r2.streak).toBe(2);
    expect(r2.comboBonus).toBe(100);
  });

  it('remet la série à zéro sur une mauvaise réponse', () => {
    const room = new Room(makeQuiz(), 'ABCDE', 'solo', true);
    const p = room.addPlayer('Alice', 's1');
    if (!('player' in p)) throw new Error();
    room.startNextRound();
    room.markClipStarted(0);
    room.submitAnswer(p.player.id, 1, 0); // bon
    room.endRound();
    room.startNextRound();
    room.markClipStarted(0);
    room.submitAnswer(p.player.id, 2, 0); // faux (r2 correct = 0)
    const r = room.endRound()!.perPlayer.get(p.player.id)!;
    expect(r.streak).toBe(0);
    expect(r.comboBonus).toBe(0);
  });

  it('ne donne aucun bonus quand le combo est désactivé', () => {
    const room = new Room(makeQuiz(), 'ABCDE', 'solo', false);
    const p = room.addPlayer('Alice', 's1');
    if (!('player' in p)) throw new Error();
    room.startNextRound();
    room.markClipStarted(0);
    room.submitAnswer(p.player.id, 1, 0);
    room.endRound();
    room.startNextRound();
    room.markClipStarted(0);
    room.submitAnswer(p.player.id, 0, 0);
    const r2 = room.endRound()!.perPlayer.get(p.player.id)!;
    expect(r2.streak).toBe(2);
    expect(r2.comboBonus).toBe(0);
  });
});

describe('Room — contrôles hôte', () => {
  it('met en pause et exclut le temps de pause du chrono de réponse', () => {
    const room = new Room(makeQuiz(), 'ABCDE', 'solo', false);
    const p = room.addPlayer('Alice', 's1');
    if (!('player' in p)) throw new Error();
    room.startNextRound();
    room.markClipStarted(0);
    expect(room.pause(1000)).toBe(true);
    expect(room.isPaused()).toBe(true);
    // Réponse refusée pendant la pause.
    expect(room.submitAnswer(p.player.id, 1, 1500).accepted).toBe(false);
    expect(room.resume(4000)).toBe(true); // 3000 ms de pause
    expect(room.isPaused()).toBe(false);
    // Le chrono est décalé : la réponse est de nouveau acceptée.
    expect(room.submitAnswer(p.player.id, 1, 5000).accepted).toBe(true);
  });

  it('passe une manche sans la noter', () => {
    const room = new Room(makeQuiz(), 'ABCDE');
    const p = room.addPlayer('Alice', 's1');
    if (!('player' in p)) throw new Error();
    room.startNextRound();
    room.markClipStarted(0);
    room.submitAnswer(p.player.id, 1, 0); // bonne réponse
    expect(room.skipRound()).toBe(true);
    expect(room.leaderboard()[0].score).toBe(0); // aucune note
    expect(room.startNextRound()).not.toBeNull(); // on peut enchaîner
  });

  it('exclut un joueur de la salle', () => {
    const room = new Room(makeQuiz(), 'ABCDE');
    const a = room.addPlayer('Alice', 's1');
    const b = room.addPlayer('Bob', 's2');
    if (!('player' in a) || !('player' in b)) throw new Error();
    expect(room.removePlayer(a.player.id)).toBe('s1');
    expect(room.playerCount).toBe(1);
    expect(room.listPlayers().map((pl) => pl.pseudo)).toEqual(['Bob']);
    expect(room.removePlayer('inconnu')).toBeNull();
  });

  it('annule la partie : retour au lobby, scores remis à zéro, relançable', () => {
    const room = new Room(makeQuiz(), 'ABCDE');
    const p = room.addPlayer('Alice', 's1');
    if (!('player' in p)) throw new Error();
    room.startNextRound();
    room.markClipStarted(0);
    room.submitAnswer(p.player.id, 1, 0); // bonne réponse
    room.endRound();
    expect(room.leaderboard()[0].score).toBeGreaterThan(0);

    expect(room.cancelGame()).toBe(true);
    expect(room.getState()).toBe('lobby');
    expect(room.getCurrentRoundIndex()).toBe(-1);
    expect(room.leaderboard()[0].score).toBe(0); // scores remis à zéro
    // Un joueur peut de nouveau rejoindre (on est bien revenu au lobby).
    expect('player' in room.addPlayer('Bob', 's2')).toBe(true);
    // Et on peut relancer une manche.
    expect(room.startNextRound()).not.toBeNull();
    // Rien à annuler quand on est déjà au lobby.
    const fresh = new Room(makeQuiz(), 'FGHIJ');
    expect(fresh.cancelGame()).toBe(false);
  });
});

describe('RoomManager — isolation', () => {
  it('crée des salles avec des codes uniques', () => {
    const mgr = new RoomManager();
    const a = mgr.create(makeQuiz());
    const b = mgr.create(makeQuiz());
    expect(a.code).not.toBe(b.code);
  });

  it('isole complètement les joueurs entre deux salles', () => {
    const mgr = new RoomManager();
    const a = mgr.create(makeQuiz());
    const b = mgr.create(makeQuiz());
    a.addPlayer('Alice', 's1');
    b.addPlayer('Bob', 's2');
    expect(a.listPlayers().map((p) => p.pseudo)).toEqual(['Alice']);
    expect(b.listPlayers().map((p) => p.pseudo)).toEqual(['Bob']);
  });

  it('retrouve une salle par code insensible à la casse', () => {
    const mgr = new RoomManager();
    const room = mgr.create(makeQuiz());
    expect(mgr.get(room.code.toLowerCase())).toBe(room);
  });

  it('supprime les salles terminées lors du nettoyage', () => {
    const mgr = new RoomManager();
    const room = mgr.create(makeQuiz());
    room.endGame();
    expect(mgr.pruneStale(1000)).toBe(1);
    expect(mgr.size).toBe(0);
  });
});
