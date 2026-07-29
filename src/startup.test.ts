import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withTimeout, prepareRepository } from './startup';
import { MemoryQuizStore, type QuizRepository } from './game/store';
import type { AuthConfig } from './auth';

const authConfig: AuthConfig = {
  adminUsername: 'admin',
  adminPassword: 'motdepasse',
  sessionSecret: 'secret',
  secureCookies: false,
};

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('withTimeout', () => {
  it('résout si la promesse aboutit à temps', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, 'x')).resolves.toBe(42);
  });

  it('rejette si le délai est dépassé', async () => {
    const jamais = new Promise<void>(() => {}); // ne se résout jamais
    await expect(withTimeout(jamais, 20, 'lent')).rejects.toThrow(/délai dépassé/);
  });

  it('propage le rejet de la promesse sous-jacente', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000, 'x')).rejects.toThrow('boom');
  });
});

describe('prepareRepository — résilience au démarrage', () => {
  it('utilise la base quand elle répond, et y crée le compte admin', async () => {
    const good = new MemoryQuizStore();
    const repo = await prepareRepository(authConfig, async () => good, 1000);
    expect(repo).toBe(good);
    expect(await repo.getUserByUsername('admin')).toMatchObject({ username: 'admin' });
  });

  it('bascule en mémoire si l\'init de la base NE SE TERMINE JAMAIS (le bug de deploy)', async () => {
    // Repo dont l'init reste bloquée : simule une base lente/verrouillée qui,
    // sans borne de temps, figerait le démarrage et le health check.
    const hanging: QuizRepository = {
      init: () => new Promise<void>(() => {}),
      upsertUser: async () => ({ id: 'x', username: 'admin', passwordHash: 'h' }),
      createUser: async () => null,
      getUserByUsername: async () => undefined,
      getUserById: async () => undefined,
      list: async () => [],
      get: async () => undefined,
      create: async () => ({ id: 'q', title: '', rounds: [], ownerId: null }),
      update: async () => null,
      delete: async () => false,
    };
    const repo = await prepareRepository(authConfig, async () => hanging, 30);
    // On récupère un stockage FONCTIONNEL (mémoire) avec le compte admin prêt.
    expect(repo).not.toBe(hanging);
    expect(repo).toBeInstanceOf(MemoryQuizStore);
    expect(await repo.getUserByUsername('admin')).toMatchObject({ username: 'admin' });
  });

  it('bascule en mémoire si l\'init de la base échoue', async () => {
    const failing: QuizRepository = {
      init: async () => {
        throw new Error('connexion refusée');
      },
      upsertUser: async () => ({ id: 'x', username: 'admin', passwordHash: 'h' }),
      createUser: async () => null,
      getUserByUsername: async () => undefined,
      getUserById: async () => undefined,
      list: async () => [],
      get: async () => undefined,
      create: async () => ({ id: 'q', title: '', rounds: [], ownerId: null }),
      update: async () => null,
      delete: async () => false,
    };
    const repo = await prepareRepository(authConfig, async () => failing, 1000);
    expect(repo).toBeInstanceOf(MemoryQuizStore);
    expect(await repo.getUserByUsername('admin')).toMatchObject({ username: 'admin' });
  });
});
