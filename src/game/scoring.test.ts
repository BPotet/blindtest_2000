import { describe, it, expect } from 'vitest';
import { computeScore, rankPlayers, streakBonus, BASE_POINTS, MAX_SPEED_BONUS } from './scoring';

describe('computeScore', () => {
  it('donne 0 point pour une mauvaise réponse', () => {
    expect(computeScore({ correct: false, elapsedMs: 0, answerWindowMs: 20000 })).toBe(0);
  });

  it('donne le maximum pour une bonne réponse instantanée', () => {
    expect(computeScore({ correct: true, elapsedMs: 0, answerWindowMs: 20000 })).toBe(
      BASE_POINTS + MAX_SPEED_BONUS,
    );
  });

  it('donne seulement les points de base à la toute fin de la fenêtre', () => {
    expect(computeScore({ correct: true, elapsedMs: 20000, answerWindowMs: 20000 })).toBe(
      BASE_POINTS,
    );
  });

  it('décroît linéairement le bonus de vitesse', () => {
    expect(computeScore({ correct: true, elapsedMs: 10000, answerWindowMs: 20000 })).toBe(
      BASE_POINTS + MAX_SPEED_BONUS / 2,
    );
  });

  it('borne les réponses au-delà de la fenêtre (pas de bonus négatif)', () => {
    expect(computeScore({ correct: true, elapsedMs: 999999, answerWindowMs: 20000 })).toBe(
      BASE_POINTS,
    );
  });

  it('répondre plus vite rapporte plus que répondre plus lentement', () => {
    const fast = computeScore({ correct: true, elapsedMs: 2000, answerWindowMs: 20000 });
    const slow = computeScore({ correct: true, elapsedMs: 15000, answerWindowMs: 20000 });
    expect(fast).toBeGreaterThan(slow);
  });
});

describe('streakBonus', () => {
  it('aucun bonus pour la 1re bonne réponse', () => {
    expect(streakBonus(0)).toBe(0);
    expect(streakBonus(1)).toBe(0);
  });
  it('augmente de 100 par palier', () => {
    expect(streakBonus(2)).toBe(100);
    expect(streakBonus(3)).toBe(200);
    expect(streakBonus(4)).toBe(300);
  });
  it('plafonne à 500', () => {
    expect(streakBonus(6)).toBe(500);
    expect(streakBonus(12)).toBe(500);
  });
});

describe('rankPlayers', () => {
  it('classe par score décroissant', () => {
    const ranked = rankPlayers([
      { id: 'a', pseudo: 'Alice', score: 100 },
      { id: 'b', pseudo: 'Bob', score: 300 },
      { id: 'c', pseudo: 'Carol', score: 200 },
    ]);
    expect(ranked.map((p) => p.id)).toEqual(['b', 'c', 'a']);
    expect(ranked.map((p) => p.rank)).toEqual([1, 2, 3]);
  });

  it('attribue le même rang aux ex æquo (1, 2, 2, 4)', () => {
    const ranked = rankPlayers([
      { id: 'a', pseudo: 'Alice', score: 300 },
      { id: 'b', pseudo: 'Bob', score: 200 },
      { id: 'c', pseudo: 'Carol', score: 200 },
      { id: 'd', pseudo: 'Dan', score: 100 },
    ]);
    expect(ranked.map((p) => p.rank)).toEqual([1, 2, 2, 4]);
  });

  it('départage les ex æquo de façon déterministe par pseudo', () => {
    const ranked = rankPlayers([
      { id: 'z', pseudo: 'Zoe', score: 100 },
      { id: 'a', pseudo: 'Anna', score: 100 },
    ]);
    expect(ranked.map((p) => p.pseudo)).toEqual(['Anna', 'Zoe']);
  });
});
