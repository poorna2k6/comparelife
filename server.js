import { createApp } from './src/app.js';

const app = createApp();
app.server.listen(app.config.port, () => app.log.info('listening', { port: app.config.port, production: app.config.production }));

let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    if (stopping) return;
    stopping = true;
    app.log.info('shutting down', { sig });
    setTimeout(() => process.exit(1), 10_000).unref();      // hard stop if connections hang
    await app.close();
    process.exit(0);
  });
}
process.on('unhandledRejection', (e) => { app.log.error('unhandledRejection', { err: String(e?.stack || e) }); });
