import { describe, it, expect } from 'vitest';
import { Room } from './room';
import type { Quiz } from '../types';

// Résilience aux coupures réseau : un téléphone qui perd le wifi / se met en
// veille en pleine manche puis revient ne doit RIEN casser — sa réponse est
// conservée (jamais recomptée), son identité et son score sont préservés, et
// il ne crée pas de doublon. Ces invariants tiennent au niveau du moteur ;
// la couche sockets est couverte par src/reconnect.test.ts.
function makeQuiz(): Quiz {
  return {
    id: 'q1',
    title: 'Résilience',
    ownerId: null,
    rounds: [
      {
        id: 'r1',
        youtubeId: 'aaaaaaaaaaa',
        startSeconds: 0,
        durationSeconds: 20,
        question: 'Q1 ?',
        options: ['A', 'B', 'C', 'D'],
        correctIndex: 0,
        answerLabel: 'A',
      },
      {
        id: 'r2',
        youtubeId: 'bbbbbbbbbbb',
        startSeconds: 0,
        durationSeconds: 20,
        question: 'Q2 ?',
        options: ['A', 'B'],
        correctIndex: 0,
        answerLabel: 'A',
      },
    ],
  };
}

function pid(r: ReturnType<Room['addPlayer']>): string {
  if (!('player' in r)) throw new Error('joueur non ajouté');
  return r.player.id;
}

describe('Résilience reconnexion — la réponse survit et n\'est jamais recomptée', () => {
  it('répondre, se déconnecter, revenir : la réponse tient, un nouvel envoi est refusé', () => {
    const room = new Room(makeQuiz(), 'ABCDE');
    const alice = pid(room.addPlayer('Alice', 's1'));
    room.startNextRound();
    room.markClipStarted(0);

    expect(room.submitAnswer(alice, 0, 1000).accepted).toBe(true); // bonne réponse
    expect(room.hasAnswered(alice)).toBe(true);

    // Coupure puis retour sur un nouveau socket.
    room.markDisconnected('s1');
    const view = room.reconnectPlayer(alice, 's2');
    expect(view).not.toBeNull();
    expect(view!.id).toBe(alice); // même identité
    expect(view!.connected).toBe(true);
    // La réponse a survécu à la reconnexion.
    expect(room.hasAnswered(alice)).toBe(true);

    // Tenter de re-répondre après le retour -> refusé (pas de double-comptage).
    expect(room.submitAnswer(alice, 2, 2000).accepted).toBe(false);

    const r = room.endRound()!;
    expect(r.answeredCount).toBe(1);
    expect(r.distribution).toEqual([1, 0, 0, 0]); // seule la 1re réponse compte
    expect(r.perPlayer.get(alice)!.correct).toBe(true);
  });

  it('se déconnecter AVANT de répondre puis revenir : peut répondre, comptée une fois', () => {
    const room = new Room(makeQuiz(), 'ABCDE');
    const alice = pid(room.addPlayer('Alice', 's1'));
    room.startNextRound();
    room.markClipStarted(0);

    room.markDisconnected('s1'); // part sans avoir répondu
    room.reconnectPlayer(alice, 's2');
    expect(room.hasAnswered(alice)).toBe(false);

    expect(room.submitAnswer(alice, 0, 1500).accepted).toBe(true);
    expect(room.submitAnswer(alice, 1, 1600).accepted).toBe(false); // une seule fois
    expect(room.endRound()!.answeredCount).toBe(1);
  });
});

describe('Résilience reconnexion — identité, effectif et score', () => {
  it('la reconnexion ne duplique pas le joueur (effectif stable, même id)', () => {
    const room = new Room(makeQuiz(), 'ABCDE');
    const alice = pid(room.addPlayer('Alice', 's1'));
    expect(room.playerCount).toBe(1);

    room.markDisconnected('s1');
    expect(room.playerCount).toBe(1); // déconnecté != retiré
    const view = room.reconnectPlayer(alice, 's2');
    expect(room.playerCount).toBe(1); // toujours un seul joueur
    expect(view!.id).toBe(alice);
  });

  it('le score gagné est préservé à travers une reconnexion', () => {
    const room = new Room(makeQuiz(), 'ABCDE');
    const alice = pid(room.addPlayer('Alice', 's1'));
    room.startNextRound();
    room.markClipStarted(0);
    room.submitAnswer(alice, 0, 1000); // bonne réponse -> points
    const r1 = room.endRound()!;
    const earned = r1.perPlayer.get(alice)!.pointsAwarded;
    expect(earned).toBeGreaterThan(0);

    // Coupure entre deux manches : le score doit revenir intact.
    room.markDisconnected('s1');
    const view = room.reconnectPlayer(alice, 's2');
    expect(view!.score).toBe(earned);
    expect(room.leaderboard().find((e) => e.playerId === alice)!.score).toBe(earned);
  });

  it('reconnecter un joueur inconnu, ou déconnecter un socket inconnu, ne casse rien', () => {
    const room = new Room(makeQuiz(), 'ABCDE');
    room.addPlayer('Alice', 's1');
    expect(room.reconnectPlayer('inconnu', 's9')).toBeNull();
    expect(room.markDisconnected('socket-inconnu')).toBeNull();
    expect(room.playerCount).toBe(1);
  });
});
