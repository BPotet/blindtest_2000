import { buildServer } from './server';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';

const { httpServer } = buildServer();

httpServer.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`Blindtest 2000 en écoute sur http://${HOST}:${PORT}`);
});
