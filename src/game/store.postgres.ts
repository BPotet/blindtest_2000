import pg from 'pg';
import type { Quiz, Round } from '../types';
import { cloneDemoQuizzes } from './quizzes';
import { generateId } from './codes';
import { withRoundIds, type QuizRepository, type QuizSummary } from './store';

const { Pool } = pg;

/** SSL requis pour toute base distante (Neon, etc.), pas pour un Postgres local. */
function needsSsl(url: string): boolean {
  if (/sslmode=disable/.test(url)) return false;
  if (/sslmode=require/.test(url)) return true;
  return !/@(localhost|127\.0\.0\.1)/.test(url);
}

/**
 * Stockage persistant des quiz dans Postgres. Les manches sont stockées en JSONB
 * (structure imbriquée simple) — pas de table séparée ni de jointure. Les quiz de
 * démo sont ré-injectés à chaque `init()` pour rester à jour.
 */
export class PostgresQuizStore implements QuizRepository {
  private readonly pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      ssl: needsSsl(databaseUrl) ? { rejectUnauthorized: false } : undefined,
      max: 5,
      connectionTimeoutMillis: 10000,
    });
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS quizzes (
        id         text PRIMARY KEY,
        title      text NOT NULL,
        rounds     jsonb NOT NULL,
        is_demo    boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await this.seedDemos();
  }

  private async seedDemos(): Promise<void> {
    for (const quiz of cloneDemoQuizzes()) {
      await this.pool.query(
        `INSERT INTO quizzes (id, title, rounds, is_demo)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, rounds = EXCLUDED.rounds, is_demo = true`,
        [quiz.id, quiz.title, JSON.stringify(quiz.rounds)],
      );
    }
  }

  async list(): Promise<QuizSummary[]> {
    const { rows } = await this.pool.query(
      `SELECT id, title, jsonb_array_length(rounds) AS round_count, is_demo
       FROM quizzes ORDER BY is_demo DESC, created_at ASC`,
    );
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      roundCount: Number(row.round_count),
      isDemo: row.is_demo,
    }));
  }

  async get(id: string): Promise<Quiz | undefined> {
    const { rows } = await this.pool.query(
      `SELECT id, title, rounds FROM quizzes WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) return undefined;
    const row = rows[0];
    return { id: row.id, title: row.title, rounds: row.rounds as Round[] };
  }

  async create(title: string, rounds: Array<Omit<Round, 'id'>>): Promise<Quiz> {
    const quiz: Quiz = { id: generateId('quiz'), title, rounds: withRoundIds(rounds) };
    await this.pool.query(
      `INSERT INTO quizzes (id, title, rounds, is_demo) VALUES ($1, $2, $3, false)`,
      [quiz.id, quiz.title, JSON.stringify(quiz.rounds)],
    );
    return quiz;
  }
}
