import type { Quiz, Round } from '../types';
import { cloneDemoQuizzes } from './quizzes';
import { generateId } from './codes';

export interface QuizSummary {
  id: string;
  title: string;
  roundCount: number;
  isDemo: boolean;
}

export interface User {
  id: string;
  username: string;
  passwordHash: string;
}

/**
 * Stockage des quiz et des utilisateurs. Deux implémentations :
 *  - `MemoryQuizStore` : en mémoire (dev local, tests, ou secours).
 *  - `PostgresQuizStore` : persistant (playlists + comptes conservés).
 * La fabrique `createQuizRepository()` choisit selon la présence de DATABASE_URL.
 */
export interface QuizRepository {
  /** Prépare le stockage (tables + seed des démos si nécessaire). */
  init(): Promise<void>;

  // Utilisateurs
  upsertUser(username: string, passwordHash: string): Promise<User>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserById(id: string): Promise<User | undefined>;

  // Quiz — `ownerId` est celui de l'utilisateur connecté ; les démos (ownerId null)
  // restent visibles par tous.
  list(ownerId: string): Promise<QuizSummary[]>;
  get(id: string): Promise<Quiz | undefined>;
  create(ownerId: string, title: string, rounds: Array<Omit<Round, 'id'>>): Promise<Quiz>;
}

/** Ajoute des identifiants de manche déterministes (r1, r2, …). */
export function withRoundIds(rounds: Array<Omit<Round, 'id'>>): Round[] {
  return rounds.map((round, index) => ({ ...round, id: `r${index + 1}` }));
}

/** Un quiz est accessible si c'est une démo ou s'il appartient à l'utilisateur. */
export function canAccessQuiz(quiz: Quiz, ownerId: string): boolean {
  return quiz.ownerId === null || quiz.ownerId === ownerId;
}

/** Implémentation en mémoire — les quiz de démo sont présents dès la construction. */
export class MemoryQuizStore implements QuizRepository {
  private readonly quizzes = new Map<string, Quiz>();
  private readonly usersByName = new Map<string, User>();
  private readonly usersById = new Map<string, User>();

  constructor() {
    for (const quiz of cloneDemoQuizzes()) this.quizzes.set(quiz.id, quiz);
  }

  async init(): Promise<void> {
    /* rien à faire : les démos sont chargées dans le constructeur */
  }

  async upsertUser(username: string, passwordHash: string): Promise<User> {
    const existing = this.usersByName.get(username.toLowerCase());
    if (existing) {
      existing.passwordHash = passwordHash;
      return existing;
    }
    const user: User = { id: generateId('u'), username, passwordHash };
    this.usersByName.set(username.toLowerCase(), user);
    this.usersById.set(user.id, user);
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return this.usersByName.get(username.toLowerCase());
  }

  async getUserById(id: string): Promise<User | undefined> {
    return this.usersById.get(id);
  }

  async list(ownerId: string): Promise<QuizSummary[]> {
    return [...this.quizzes.values()]
      .filter((quiz) => quiz.ownerId === null || quiz.ownerId === ownerId)
      .map((quiz) => ({
        id: quiz.id,
        title: quiz.title,
        roundCount: quiz.rounds.length,
        isDemo: quiz.ownerId === null,
      }));
  }

  async get(id: string): Promise<Quiz | undefined> {
    return this.quizzes.get(id);
  }

  async create(ownerId: string, title: string, rounds: Array<Omit<Round, 'id'>>): Promise<Quiz> {
    const quiz: Quiz = { id: generateId('quiz'), title, ownerId, rounds: withRoundIds(rounds) };
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
