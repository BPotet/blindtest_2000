import type { Quiz, Round } from '../types';
import { cloneDemoQuizzes } from './quizzes';
import { generateId } from './codes';

export interface QuizSummary {
  id: string;
  title: string;
  roundCount: number;
  isDemo: boolean;
}

/**
 * Stockage des quiz. Deux implémentations :
 *  - `MemoryQuizStore` : en mémoire (dev local, tests, ou secours).
 *  - `PostgresQuizStore` : persistant (playlists conservées entre redéploiements).
 * La fabrique `createQuizRepository()` choisit selon la présence de DATABASE_URL.
 */
export interface QuizRepository {
  /** Prépare le stockage (création de table + seed des démos si nécessaire). */
  init(): Promise<void>;
  list(): Promise<QuizSummary[]>;
  get(id: string): Promise<Quiz | undefined>;
  create(title: string, rounds: Array<Omit<Round, 'id'>>): Promise<Quiz>;
}

/** Ajoute des identifiants de manche déterministes (r1, r2, …). */
export function withRoundIds(rounds: Array<Omit<Round, 'id'>>): Round[] {
  return rounds.map((round, index) => ({ ...round, id: `r${index + 1}` }));
}

/** Implémentation en mémoire — les quiz de démo sont présents dès la construction. */
export class MemoryQuizStore implements QuizRepository {
  private readonly quizzes = new Map<string, Quiz>();
  private readonly demoIds = new Set<string>();

  constructor() {
    for (const quiz of cloneDemoQuizzes()) {
      this.quizzes.set(quiz.id, quiz);
      this.demoIds.add(quiz.id);
    }
  }

  async init(): Promise<void> {
    /* rien à faire : les démos sont chargées dans le constructeur */
  }

  async list(): Promise<QuizSummary[]> {
    return [...this.quizzes.values()].map((quiz) => ({
      id: quiz.id,
      title: quiz.title,
      roundCount: quiz.rounds.length,
      isDemo: this.demoIds.has(quiz.id),
    }));
  }

  async get(id: string): Promise<Quiz | undefined> {
    return this.quizzes.get(id);
  }

  async create(title: string, rounds: Array<Omit<Round, 'id'>>): Promise<Quiz> {
    const quiz: Quiz = { id: generateId('quiz'), title, rounds: withRoundIds(rounds) };
    this.quizzes.set(quiz.id, quiz);
    return quiz;
  }
}

/**
 * Choisit l'implémentation de stockage : Postgres si DATABASE_URL est défini,
 * sinon en mémoire. L'import de la version Postgres est différé pour ne charger
 * `pg` que lorsque c'est réellement nécessaire.
 */
export async function createQuizRepository(
  databaseUrl = process.env.DATABASE_URL,
): Promise<QuizRepository> {
  if (databaseUrl) {
    const { PostgresQuizStore } = await import('./store.postgres');
    return new PostgresQuizStore(databaseUrl);
  }
  return new MemoryQuizStore();
}
