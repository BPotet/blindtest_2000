import { describe, it, expect } from 'vitest';
import { Room, RoomManager } from './room';
import type { Quiz } from '../types';
import { BASE_POINTS } from './scoring';

function makeQuiz(): Quiz {
  return {
    id: 'q1',
    title: 'Test',
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

    const started = room.startNextRound(1000);
    expect(started).not.toBeNull();

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

  it('verrouille au premier tap (ignore les réponses suivantes)', () => {
    const room = new Room(makeQuiz(), 'ABCDE');
    const p = room.addPlayer('Alice', 's1');
    if (!('player' in p)) throw new Error();
    room.startNextRound(0);
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
    room.startNextRound(0);
    room.submitAnswer(p.player.id, 1, 0); // r1 correct
    room.endRound();
    room.startNextRound(0);
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
    room.startNextRound(0);
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
