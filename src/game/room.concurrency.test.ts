import { describe, it, expect } from 'vitest';
import { Room, RoomManager } from './room';
import type { Quiz } from '../types';

// Tests de concurrence/contention au niveau du moteur (sans sockets) : rapides et
// déterministes, ils verrouillent les invariants qui doivent tenir quand « tout le
// monde joue en même temps » — double-réponse, réponse hors-délai, vote de masse
// simultané, égalités de vitesse, courses de vote en équipe, et isolation des salles.
function makeQuiz(): Quiz {
  return {
    id: 'q1',
    title: 'Concurrence',
    ownerId: null,
    rounds: [
      {
        id: 'r1',
        youtubeId: 'aaaaaaaaaaa',
        startSeconds: 0,
        durationSeconds: 20,
        question: 'Q1 ?',
        options: ['A', 'B', 'C', 'D'],
        correctIndex: 1,
        answerLabel: 'B',
      },
    ],
  };
}

function playerId(r: ReturnType<Room['addPlayer']>): string {
  if (!('player' in r)) throw new Error('joueur non ajouté');
  return r.player.id;
}

describe('Concurrence — réponse unique par joueur (idempotence)', () => {
  it('une deuxième réponse du même joueur est refusée : la première fait foi', () => {
    const room = new Room(makeQuiz(), 'ABCDE');
    const id = playerId(room.addPlayer('Alice', 's1'));
    room.startNextRound();
    room.markClipStarted(0);

    const first = room.submitAnswer(id, 1, 500); // bonne réponse, +500ms
    const second = room.submitAnswer(id, 0, 800); // tente de changer -> refusée
    const third = room.submitAnswer(id, 2, 900);

    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(false);
    expect(third.accepted).toBe(false);

    const r = room.endRound()!;
    expect(r.answeredCount).toBe(1); // comptée une seule fois
    expect(r.distribution).toEqual([0, 1, 0, 0]); // seule la 1re option (B) est enregistrée
    expect(r.perPlayer.get(id)!.correct).toBe(true);
  });

  it('des envois quasi-simultanés du même joueur ne scorent qu\'une fois', () => {
    const room = new Room(makeQuiz(), 'ABCDE');
    const id = playerId(room.addPlayer('Alice', 's1'));
    room.startNextRound();
    room.markClipStarted(0);

    // 50 tentatives « au même instant » : une seule doit passer.
    const outcomes = Array.from({ length: 50 }, () => room.submitAnswer(id, 1, 1000));
    const accepted = outcomes.filter((o) => o.accepted).length;
    expect(accepted).toBe(1);
    expect(room.endRound()!.answeredCount).toBe(1);
  });
});

describe('Concurrence — fenêtre de réponse', () => {
  it('refuse une réponse avant le démarrage de l\'extrait', () => {
    const room = new Room(makeQuiz(), 'ABCDE');
    const id = playerId(room.addPlayer('Alice', 's1'));
    room.startNextRound(); // extrait pas encore démarré
    const out = room.submitAnswer(id, 1, 100);
    expect(out.accepted).toBe(false);
  });

  it('refuse une réponse une fois les réponses closes (temps écoulé)', () => {
    const room = new Room(makeQuiz(), 'ABCDE');
    const id = playerId(room.addPlayer('Alice', 's1'));
    room.startNextRound();
    room.markClipStarted(0);
    expect(room.closeAnswers()).toBe(true);
    expect(room.areAnswersClosed()).toBe(true);

    const late = room.submitAnswer(id, 1, 5000); // arrive après la clôture
    expect(late.accepted).toBe(false);
    expect(room.endRound()!.answeredCount).toBe(0);
  });
});

describe('Concurrence — vote de masse simultané', () => {
  it('500 joueurs répondent au même instant : tout est encaissé exactement une fois', () => {
    const room = new Room(makeQuiz(), 'ABCDE');
    const ids = Array.from({ length: 500 }, (_, i) => playerId(room.addPlayer(`J${i}`, `s${i}`)));
    expect(room.playerCount).toBe(500);

    room.startNextRound();
    room.markClipStarted(0);

    // Tout le monde vote la bonne réponse, au même horodatage (le pire cas d'égalité).
    for (const id of ids) room.submitAnswer(id, 1, 1000);

    const r = room.endRound()!;
    expect(r.answeredCount).toBe(500);
    expect(r.correctCount).toBe(500);
    expect(r.totalPlayers).toBe(500);
    expect(r.allCorrect).toBe(true);
    expect(r.distribution).toEqual([0, 500, 0, 0]);
    expect(r.distribution.reduce((a, b) => a + b, 0)).toBe(500);

    const board = room.leaderboard();
    expect(board).toHaveLength(500);
    // Même réponse, même instant -> exactement le même score pour tous.
    const scores = new Set(board.map((e) => e.score));
    expect(scores.size).toBe(1);
    expect([...scores][0]).toBeGreaterThan(0);
  });

  it('répartit correctement des votes simultanés éclatés sur toutes les options', () => {
    const room = new Room(makeQuiz(), 'ABCDE');
    const ids = Array.from({ length: 400 }, (_, i) => playerId(room.addPlayer(`J${i}`, `s${i}`)));
    room.startNextRound();
    room.markClipStarted(0);
    // 100 votes par option, tous au même instant.
    ids.forEach((id, i) => room.submitAnswer(id, i % 4, 1000));

    const r = room.endRound()!;
    expect(r.distribution).toEqual([100, 100, 100, 100]);
    expect(r.answeredCount).toBe(400);
    expect(r.correctCount).toBe(100); // seule l'option 1 est correcte
  });
});

describe('Concurrence — égalité de vitesse', () => {
  it('deux bonnes réponses au même temps reçoivent le même score', () => {
    const room = new Room(makeQuiz(), 'ABCDE');
    const a = playerId(room.addPlayer('A', 's1'));
    const b = playerId(room.addPlayer('B', 's2'));
    room.startNextRound();
    room.markClipStarted(0);
    room.submitAnswer(a, 1, 2000);
    room.submitAnswer(b, 1, 2000); // exactement le même instant

    const r = room.endRound()!;
    expect(r.perPlayer.get(a)!.pointsAwarded).toBe(r.perPlayer.get(b)!.pointsAwarded);
    expect(r.perPlayer.get(a)!.pointsAwarded).toBeGreaterThan(0);
  });
});

describe('Concurrence — courses de vote en mode équipes', () => {
  it('le vote reste modifiable jusqu\'au verrouillage ; le lock fige la majorité', () => {
    const room = new Room(makeQuiz(), 'ABCDE', 'teams');
    const p1 = playerId(room.addPlayer('P1', 's1', 'Rouge'));
    const p2 = playerId(room.addPlayer('P2', 's2', 'Rouge'));
    const p3 = playerId(room.addPlayer('P3', 's3', 'Rouge'));
    room.startNextRound();
    room.markClipStarted(0);

    room.submitAnswer(p1, 0, 100); // P1 -> mauvais
    room.submitAnswer(p2, 1, 200); // P2 -> bon
    room.submitAnswer(p3, 1, 300); // P3 -> bon (majorité = option 1)
    room.submitAnswer(p1, 1, 400); // P1 change d'avis -> bon (vote modifiable)

    const lock = room.lockTeam(p1, 500);
    expect(lock.locked).toBe(true);

    // Après verrouillage : plus aucun vote ni re-lock accepté.
    expect(room.submitAnswer(p2, 0, 600).accepted).toBe(false);
    expect(room.lockTeam(p3, 700).locked).toBe(false);

    // Le scoring est appliqué à la révélation (endRound), pas au verrouillage.
    const r = room.endRound()!;
    expect(r.correctCount).toBe(1); // l'équipe a verrouillé la bonne réponse (option 1)
    const board = room.leaderboard();
    expect(board).toHaveLength(1);
    expect(board[0].pseudo).toBe('Rouge');
    expect(board[0].score).toBeGreaterThan(0);
  });

  it('égalité de votes dans une équipe : le vote le plus précoce l\'emporte', () => {
    const room = new Room(makeQuiz(), 'ABCDE', 'teams');
    const p1 = playerId(room.addPlayer('P1', 's1', 'Bleu'));
    const p2 = playerId(room.addPlayer('P2', 's2', 'Bleu'));
    room.startNextRound();
    room.markClipStarted(0);

    room.submitAnswer(p1, 0, 100); // mauvais, mais voté en premier
    room.submitAnswer(p2, 1, 200); // bon, plus tard -> égalité 1-1

    room.lockTeam(p1, 300);
    // Départage par précocité -> option 0 (mauvaise) retenue -> équipe non créditée.
    const r = room.endRound()!;
    expect(r.correctCount).toBe(0);
    expect(room.leaderboard()[0].score).toBe(0);
  });
});

describe('Concurrence — isolation stricte entre salles', () => {
  it('les réponses d\'une salle n\'affectent ni le score ni le classement d\'une autre', () => {
    const mgr = new RoomManager();
    const roomA = mgr.create(makeQuiz());
    const roomB = mgr.create(makeQuiz());
    expect(roomA.code).not.toBe(roomB.code);

    const a1 = playerId(roomA.addPlayer('A1', 'sa1'));
    const a2 = playerId(roomA.addPlayer('A2', 'sa2'));
    const b1 = playerId(roomB.addPlayer('B1', 'sb1'));

    roomA.startNextRound();
    roomA.markClipStarted(0);
    roomB.startNextRound();
    roomB.markClipStarted(0);

    // Tout le monde « joue en même temps », mais chaque salle est étanche.
    roomA.submitAnswer(a1, 1, 1000); // bon
    roomA.submitAnswer(a2, 0, 1000); // faux
    roomB.submitAnswer(b1, 1, 1000); // bon

    const rA = roomA.endRound()!;
    const rB = roomB.endRound()!;

    expect(rA.totalPlayers).toBe(2);
    expect(rA.answeredCount).toBe(2);
    expect(rB.totalPlayers).toBe(1);
    expect(rB.answeredCount).toBe(1);
    expect(roomA.leaderboard()).toHaveLength(2);
    expect(roomB.leaderboard()).toHaveLength(1);
    // Le joueur de B n'apparaît nulle part dans A (et réciproquement).
    expect(roomA.leaderboard().some((e) => e.pseudo === 'B1')).toBe(false);
    expect(rB.perPlayer.has(a1)).toBe(false);
  });
});
