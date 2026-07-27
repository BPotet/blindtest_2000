import { buildServer } from './server';
import { createQuizRepository, MemoryQuizStore, type QuizRepository } from './game/store';
import { loadAuthConfig, hashPassword } from './auth';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';

async function main(): Promise<void> {
  const authConfig = loadAuthConfig();

  let quizRepo: QuizRepository = await createQuizRepository();
  try {
    await quizRepo.init();
    if (process.env.DATABASE_URL) {
      console.log('Stockage des quiz : PostgreSQL (persistant).');
    } else {
      console.log('Stockage des quiz : mémoire (non persistant — définis DATABASE_URL pour conserver les playlists).');
    }
  } catch (err) {
    // La base est configurée mais injoignable : on garde le site en ligne en
    // basculant sur le stockage mémoire, avec un message clair dans les logs.
    console.error('Connexion à la base impossible, bascule en mémoire :', (err as Error).message);
    quizRepo = new MemoryQuizStore();
    await quizRepo.init();
  }

  // Compte admin : créé/mis à jour depuis l'environnement à chaque démarrage.
  await quizRepo.upsertUser(authConfig.adminUsername, hashPassword(authConfig.adminPassword));
  console.log(`Compte hôte : « ${authConfig.adminUsername} ».`);

  const { httpServer } = buildServer({ quizRepo, authConfig });
  httpServer.listen(PORT, HOST, () => {
    console.log(`Blindtest 2000 en écoute sur http://${HOST}:${PORT}`);
  });
}

main().catch((err) => {
  console.error('Échec du démarrage :', err);
  process.exit(1);
});
