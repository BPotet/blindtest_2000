import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  createSession,
  verifySession,
  parseCookies,
  SESSION_COOKIE,
} from './auth';

describe('hashPassword / verifyPassword', () => {
  it('valide le bon mot de passe', () => {
    const stored = hashPassword('s3cret!');
    expect(verifyPassword('s3cret!', stored)).toBe(true);
  });

  it('rejette un mauvais mot de passe', () => {
    const stored = hashPassword('s3cret!');
    expect(verifyPassword('mauvais', stored)).toBe(false);
  });

  it('produit un sel aléatoire (hash différent à chaque fois)', () => {
    expect(hashPassword('x')).not.toBe(hashPassword('x'));
  });

  it('ne casse pas sur un format stocké invalide', () => {
    expect(verifyPassword('x', 'nawak')).toBe(false);
  });
});

describe('createSession / verifySession', () => {
  const secret = 'un-secret-de-test';

  it('valide un jeton signé et non expiré', () => {
    const token = createSession('u_1', secret);
    expect(verifySession(token, secret)).toEqual({ uid: 'u_1' });
  });

  it('rejette une signature falsifiée', () => {
    const token = createSession('u_1', secret);
    const tampered = token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa');
    expect(verifySession(tampered, secret)).toBeNull();
  });

  it('rejette un jeton signé avec un autre secret', () => {
    const token = createSession('u_1', secret);
    expect(verifySession(token, 'autre-secret')).toBeNull();
  });

  it('rejette un jeton expiré', () => {
    const past = Date.now() - 40 * 24 * 60 * 60 * 1000;
    const token = createSession('u_1', secret, past);
    expect(verifySession(token, secret)).toBeNull();
  });

  it('rejette un jeton absent ou malformé', () => {
    expect(verifySession(undefined, secret)).toBeNull();
    expect(verifySession('pasdepoint', secret)).toBeNull();
  });
});

describe('parseCookies', () => {
  it('extrait le cookie de session', () => {
    const cookies = parseCookies(`${SESSION_COOKIE}=abc.def; autre=1`);
    expect(cookies[SESSION_COOKIE]).toBe('abc.def');
    expect(cookies.autre).toBe('1');
  });

  it('renvoie un objet vide sans en-tête', () => {
    expect(parseCookies(undefined)).toEqual({});
  });
});
