import { describe, it, expect } from 'vitest';
import { MemoryQuizStore, createQuizRepository, withRoundIds } from './store';

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

describe('MemoryQuizStore', () => {
  it('livre les quiz de démo dès le départ', async () => {
    const store = new MemoryQuizStore();
    const list = await store.list();
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.every((q) => q.isDemo)).toBe(true);
  });

  it('crée un quiz récupérable ensuite', async () => {
    const store = new MemoryQuizStore();
    const created = await store.create('Mon quiz', sampleRounds);
    const fetched = await store.get(created.id);
    expect(fetched?.title).toBe('Mon quiz');
    expect(fetched?.rounds[0].id).toBe('r1');
    const summary = (await store.list()).find((q) => q.id === created.id);
    expect(summary?.isDemo).toBe(false);
  });

  it('renvoie undefined pour un quiz inconnu', async () => {
    const store = new MemoryQuizStore();
    expect(await store.get('inexistant')).toBeUndefined();
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
