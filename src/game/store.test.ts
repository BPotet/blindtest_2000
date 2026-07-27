import { describe, it, expect } from 'vitest';
import { MemoryQuizStore, createQuizRepository, withRoundIds, canAccessQuiz } from './store';
import type { Quiz } from '../types';

const OWNER = 'u_admin';

const sampleRounds = [
  {
    youtubeId: 'aaaaaaaaaaa',
    startSeconds: 0,
    durationSeconds: 20,
    question: 'Q ?',
    options: ['A', 'B'],
    correctIndex: 0,
    answerLabel: 'A',
  },
];

describe('MemoryQuizStore — quiz', () => {
  it('livre les quiz de démo (visibles par tous) dès le départ', async () => {
    const store = new MemoryQuizStore();
    const list = await store.list(OWNER);
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.every((q) => q.isDemo)).toBe(true);
  });

  it('crée un quiz rattaché à son propriétaire', async () => {
    const store = new MemoryQuizStore();
    const created = await store.create(OWNER, 'Mon quiz', sampleRounds);
    expect(created.ownerId).toBe(OWNER);
    const fetched = await store.get(created.id);
    expect(fetched?.title).toBe('Mon quiz');
    expect(fetched?.rounds[0].id).toBe('r1');
  });

  it("ne montre pas les quiz d'un autre propriétaire", async () => {
    const store = new MemoryQuizStore();
    const mine = await store.create(OWNER, 'À moi', sampleRounds);
    await store.create('u_autre', 'À un autre', sampleRounds);
    const myList = await store.list(OWNER);
    expect(myList.some((q) => q.id === mine.id)).toBe(true);
    expect(myList.some((q) => q.title === 'À un autre')).toBe(false);
    // Les démos restent visibles.
    expect(myList.some((q) => q.isDemo)).toBe(true);
  });
});

describe('MemoryQuizStore — utilisateurs', () => {
  it('crée puis retrouve un utilisateur (insensible à la casse)', async () => {
    const store = new MemoryQuizStore();
    const user = await store.upsertUser('Admin', 'hash1');
    expect(await store.getUserByUsername('admin')).toMatchObject({ id: user.id });
    expect(await store.getUserById(user.id)).toMatchObject({ username: 'Admin' });
  });

  it('met à jour le mot de passe sans dupliquer le compte', async () => {
    const store = new MemoryQuizStore();
    const first = await store.upsertUser('admin', 'hash1');
    const second = await store.upsertUser('admin', 'hash2');
    expect(second.id).toBe(first.id);
    expect((await store.getUserById(first.id))?.passwordHash).toBe('hash2');
  });
});

describe('canAccessQuiz', () => {
  const demo: Quiz = { id: 'd', title: 'demo', ownerId: null, rounds: [] };
  const owned: Quiz = { id: 'o', title: 'owned', ownerId: OWNER, rounds: [] };
  it('autorise les démos pour tout le monde', () => {
    expect(canAccessQuiz(demo, 'nimporte')).toBe(true);
  });
  it('autorise le propriétaire mais pas les autres', () => {
    expect(canAccessQuiz(owned, OWNER)).toBe(true);
    expect(canAccessQuiz(owned, 'autre')).toBe(false);
  });
});

describe('withRoundIds', () => {
  it('numérote les manches r1, r2, …', () => {
    const rounds = withRoundIds([...sampleRounds, { ...sampleRounds[0] }]);
    expect(rounds.map((r) => r.id)).toEqual(['r1', 'r2']);
  });
});

describe('createQuizRepository', () => {
  it('choisit le stockage mémoire sans DATABASE_URL', async () => {
    const repo = await createQuizRepository(undefined);
    expect(repo).toBeInstanceOf(MemoryQuizStore);
  });
});
