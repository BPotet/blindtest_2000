import { buildServer } from './server';
import { loadAuthConfig } from './auth';
import { prepareRepository } from './startup';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';

async function main(): Promise<void> {
  const authConfig = loadAuthConfig();

  // Prépare le stockage de façon résiliente : une base injoignable/lente ne
  // bloque jamais l'écoute du port (donc le health check de la plateforme).
  const quizRepo = await prepareRepository(authConfig);
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
