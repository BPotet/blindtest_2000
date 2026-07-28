import pg from 'pg';
import type { Quiz, Round } from '../types';
import { cloneDemoQuizzes } from './quizzes';
import { generateId } from './codes';
import { withRoundIds, type QuizRepository, type QuizSummary, type User } from './store';

const { Pool } = pg;

/** SSL requis pour toute base distante (Neon, etc.), pas pour un Postgres local. */
function needsSsl(url: string): boolean {
  if (/sslmode=disable/.test(url)) return false;
  if (/sslmode=require/.test(url)) return true;
  return !/@(localhost|127\.0\.0\.1)/.test(url);
}

/**
 * Stockage persistant des quiz et des utilisateurs dans Postgres. Les manches
 * sont stockées en JSONB. Les quiz de démo sont ré-injectés à chaque `init()`.
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
      CREATE TABLE IF NOT EXISTS users (
        id            text PRIMARY KEY,
        username      text NOT NULL UNIQUE,
        password_hash text NOT NULL,
        created_at    timestamptz NOT NULL DEFAULT now()
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS quizzes (
        id         text PRIMARY KEY,
        title      text NOT NULL,
        rounds     jsonb NOT NULL,
        is_demo    boolean NOT NULL DEFAULT false,
        owner_id   text,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    // Migration douce si la table quizzes existait sans owner_id.
    await this.pool.query(`ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS owner_id text`);
    // Unicité insensible à la casse des noms d'utilisateur (les recherches le sont).
    try {
      await this.pool.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (lower(username))`,
      );
    } catch (err) {
      console.warn('Index unique lower(username) non créé :', (err as Error).message);
    }
    await this.seedDemos();
  }

  private async seedDemos(): Promise<void> {
    for (const quiz of cloneDemoQuizzes()) {
      await this.pool.query(
        `INSERT INTO quizzes (id, title, rounds, is_demo, owner_id)
         VALUES ($1, $2, $3, true, NULL)
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, rounds = EXCLUDED.rounds, is_demo = true`,
        [quiz.id, quiz.title, JSON.stringify(quiz.rounds)],
      );
    }
  }

  async upsertUser(username: string, passwordHash: string): Promise<User> {
    const { rows } = await this.pool.query(
      `INSERT INTO users (id, username, password_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING id, username, password_hash`,
      [generateId('u'), username, passwordHash],
    );
    const row = rows[0];
    return { id: row.id, username: row.username, passwordHash: row.password_hash };
  }

  async createUser(username: string, passwordHash: string): Promise<User | null> {
    // Garde applicative (insensible à la casse) doublée du garde base (index unique).
    if (await this.getUserByUsername(username)) return null;
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO users (id, username, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id, username, password_hash`,
        [generateId('u'), username, passwordHash],
      );
      const row = rows[0];
      return { id: row.id, username: row.username, passwordHash: row.password_hash };
    } catch (err) {
      // 23505 = violation d'unicité (course entre deux inscriptions) : nom pris.
      if ((err as { code?: string }).code === '23505') return null;
      throw err;
    }
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const { rows } = await this.pool.query(
      `SELECT id, username, password_hash FROM users WHERE lower(username) = lower($1)`,
      [username],
    );
    if (rows.length === 0) return undefined;
    return { id: rows[0].id, username: rows[0].username, passwordHash: rows[0].password_hash };
  }

  async getUserById(id: string): Promise<User | undefined> {
    const { rows } = await this.pool.query(
      `SELECT id, username, password_hash FROM users WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) return undefined;
    return { id: rows[0].id, username: rows[0].username, passwordHash: rows[0].password_hash };
  }

  async list(ownerId: string): Promise<QuizSummary[]> {
    const { rows } = await this.pool.query(
      `SELECT id, title, jsonb_array_length(rounds) AS round_count, is_demo
       FROM quizzes WHERE is_demo = true OR owner_id = $1
       ORDER BY is_demo DESC, created_at ASC`,
      [ownerId],
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
      `SELECT id, title, rounds, owner_id FROM quizzes WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) return undefined;
    const row = rows[0];
    return {
      id: row.id,
      title: row.title,
      rounds: row.rounds as Round[],
      ownerId: row.owner_id ?? null,
    };
  }

  async create(ownerId: string, title: string, rounds: Array<Omit<Round, 'id'>>): Promise<Quiz> {
    const quiz: Quiz = { id: generateId('quiz'), title, ownerId, rounds: withRoundIds(rounds) };
    await this.pool.query(
      `INSERT INTO quizzes (id, title, rounds, is_demo, owner_id) VALUES ($1, $2, $3, false, $4)`,
      [quiz.id, quiz.title, JSON.stringify(quiz.rounds), ownerId],
    );
    return quiz;
  }

  async update(
    id: string,
    ownerId: string,
    title: string,
    rounds: Array<Omit<Round, 'id'>>,
  ): Promise<Quiz | null> {
    const withIds = withRoundIds(rounds);
    const { rows } = await this.pool.query(
      `UPDATE quizzes SET title = $1, rounds = $2
       WHERE id = $3 AND owner_id = $4
       RETURNING id, title, rounds, owner_id`,
      [title, JSON.stringify(withIds), id, ownerId],
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    return { id: row.id, title: row.title, rounds: row.rounds as Round[], ownerId: row.owner_id };
  }

  async delete(id: string, ownerId: string): Promise<boolean> {
    const res = await this.pool.query(`DELETE FROM quizzes WHERE id = $1 AND owner_id = $2`, [
      id,
      ownerId,
    ]);
    return (res.rowCount ?? 0) > 0;
  }
}
