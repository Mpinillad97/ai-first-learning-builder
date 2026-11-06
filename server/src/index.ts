import { app } from './app.js';
import { env } from './config/env.js';
import { initStorage } from './storage/init-storage.js';

try {
  await initStorage();
} catch (error) {
  console.error('[startup] Storage initialization failed. Server not started.', error);
  process.exit(1);
}

app.listen(env.port, () => {
  console.log(`Server listening on http://localhost:${env.port}`);
});
