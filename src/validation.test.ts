import { describe, it, expect } from 'vitest';
import { createQuizSchema } from './validation';

const baseRound = {
  startSeconds: 0,
  durationSeconds: 20,
  question: 'Quelle est la capitale ?',
  options: ['Paris', 'Lyon'],
  correctIndex: 0,
};

describe('createQuizSchema — lien YouTube facultatif', () => {
  it('accepte une manche AVEC lien YouTube (extrait ID)', () => {
    const parsed = createQuizSchema.parse({
      title: 'T',
      rounds: [{ ...baseRound, youtube: 'https://youtu.be/dQw4w9WgXcQ' }],
    });
    expect(parsed.rounds[0].youtube).toBe('dQw4w9WgXcQ');
  });

  it('accepte une manche SANS lien (quiz pur) -> youtube vide', () => {
    expect(createQuizSchema.parse({ title: 'T', rounds: [{ ...baseRound }] }).rounds[0].youtube).toBe('');
    expect(
      createQuizSchema.parse({ title: 'T', rounds: [{ ...baseRound, youtube: '   ' }] }).rounds[0].youtube,
    ).toBe('');
  });

  it('refuse un lien fourni mais invalide', () => {
    // « coucou » : ni un ID de 11 caractères, ni une URL YouTube analysable.
    expect(() =>
      createQuizSchema.parse({ title: 'T', rounds: [{ ...baseRound, youtube: 'coucou' }] }),
    ).toThrow();
  });
});
