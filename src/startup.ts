import { createQuizRepository, MemoryQuizStore, type QuizRepository } from './game/store';
import { hashPassword, type AuthConfig } from './auth';

/** Délai maximal accordé à chaque étape d'init de la base au démarrage. */
export const DB_INIT_TIMEOUT_MS = 8000;

/**
 * Rejette si `promise` n'aboutit pas dans `ms`. Sert à borner l'initialisation
 * de la base : une base injoignable OU lente (verrou, réveil à froid) ne doit
 * jamais figer le démarrage du serveur — et donc le health check de la
 * plateforme d'hébergement (Render probe `/api/health`).
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} : délai dépassé (${ms} ms)`)), ms);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Prépare le stockage des quiz pour le démarrage, de façon *résiliente* :
 *
 * - tente la base configurée (Postgres si `DATABASE_URL`), init + compte admin,
 *   chaque étape bornée dans le temps ;
 * - en cas d'échec OU de lenteur, bascule sur un stockage mémoire (non
 *   persistant mais fonctionnel) pour que le serveur puisse écouter tout de
 *   suite et répondre au health check.
 *
 * `makeRepo` est injectable pour les tests.
 */
export async function prepareRepository(
  authConfig: AuthConfig,
  makeRepo: () => Promise<QuizRepository> = createQuizRepository,
  timeoutMs: number = DB_INIT_TIMEOUT_MS,
): Promise<QuizRepository> {
  const adminHash = hashPassword(authConfig.adminPassword);
  let repo = await makeRepo();
  try {
    await withTimeout(repo.init(), timeoutMs, 'Initialisation de la base');
    await withTimeout(repo.upsertUser(authConfig.adminUsername, adminHash), timeoutMs, 'Compte admin');
    console.log(
      process.env.DATABASE_URL
        ? 'Stockage des quiz : PostgreSQL (persistant).'
        : 'Stockage des quiz : mémoire (non persistant — définis DATABASE_URL pour conserver les playlists).',
    );
  } catch (err) {
    // La base est configurée mais injoignable/lente : on garde le site en ligne
    // en basculant sur le stockage mémoire, avec un message clair dans les logs.
    console.error('Base indisponible, bascule en mémoire :', (err as Error).message);
    repo = new MemoryQuizStore();
    await repo.init();
    await repo.upsertUser(authConfig.adminUsername, adminHash);
  }
  return repo;
}
