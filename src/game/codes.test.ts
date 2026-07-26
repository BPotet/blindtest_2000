import { describe, it, expect } from 'vitest';
import { generateRoomCode, generateId, __testing } from './codes';

describe('generateRoomCode', () => {
  it('produit un code de la longueur attendue', () => {
    expect(generateRoomCode()).toHaveLength(__testing.CODE_LENGTH);
  });

  it("n'utilise que des caractères de l'alphabet non ambigu", () => {
    const allowed = new RegExp(`^[${__testing.ROOM_ALPHABET}]+$`);
    for (let i = 0; i < 200; i++) {
      expect(generateRoomCode()).toMatch(allowed);
    }
  });

  it('exclut les caractères ambigus (0, O, 1, I, L)', () => {
    expect(__testing.ROOM_ALPHABET).not.toMatch(/[01OIL]/);
  });

  it('produit des codes majoritairement uniques', () => {
    const codes = new Set(Array.from({ length: 500 }, () => generateRoomCode()));
    expect(codes.size).toBeGreaterThan(490);
  });
});

describe('generateId', () => {
  it('préfixe l\'identifiant quand demandé', () => {
    expect(generateId('p')).toMatch(/^p_[a-z0-9]{12}$/);
  });

  it('produit des identifiants distincts', () => {
    expect(generateId()).not.toBe(generateId());
  });
});
