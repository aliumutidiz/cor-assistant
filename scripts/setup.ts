import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { z } from 'zod';

// Operator-only bootstrap. Refuses to replace existing configuration and never
// displays generated secrets. Runtime integrations are managed by the owner UI.
const rl = createInterface({ input: process.stdin, output: process.stdout });
try {
  const mode = process.argv.includes('--demo')
    ? '1'
    : (await rl.question('Setup: [1] Local demo, [2] Persistent installation: ')).trim();
  if (!['1', '2'].includes(mode)) throw new Error('Choose 1 or 2.');
  const live = mode === '2';
  const origin = live
    ? z.url().parse((await rl.question('Application URL (https://... or http://localhost:5173): ')).trim())
    : 'http://localhost:5173';
  const address = new URL(origin);
  if (
    address.username ||
    address.password ||
    address.search ||
    address.hash ||
    address.pathname !== '/' ||
    !['http:', 'https:'].includes(address.protocol)
  )
    throw new Error('A valid root HTTP/HTTPS URL is required.');
  const production = address.protocol === 'https:';
  if (live && !production && !['localhost', '127.0.0.1'].includes(address.hostname))
    throw new Error('External access requires HTTPS.');
  const owner = live ? z.email().parse((await rl.question('Owner Google email address: ')).trim()) : '';
  let clientId = '',
    clientSecret = '';
  if (live) {
    const file = (await rl.question('Path to the OAuth client JSON downloaded from Google Cloud: '))
      .trim()
      .replace(/^"|"$/g, '');
    const downloaded = z
      .object({ web: z.object({ client_id: z.string().min(1), client_secret: z.string().min(1) }) })
      .parse(JSON.parse(await readFile(file, 'utf8')));
    clientId = downloaded.web.client_id;
    clientSecret = downloaded.web.client_secret;
  }
  const password = randomBytes(32).toString('hex');
  const values: Record<string, string> = {
    NODE_ENV: production ? 'production' : 'development',
    APP_ORIGIN: address.origin,
    PORT: '3001',
    HTTP_SOCKET: '',
    DEMO_MODE: String(!live),
    DATABASE_URL: `postgresql://cor:${password}@127.0.0.1:5432/cor`,
    POSTGRES_PASSWORD: password,
    SESSION_SECRET: randomBytes(32).toString('hex'),
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    OWNER_EMAIL: owner,
    AUTH_MODE: 'google',
    GOOGLE_CLIENT_ID: clientId,
    GOOGLE_CLIENT_SECRET: clientSecret,
    GOOGLE_REDIRECT_URI: address.origin + '/api/oauth/callback',
    AGY_ENABLED: 'false',
    TELEGRAM_ENABLED: 'false',
    STT_ENABLED: 'false',
  };
  const dotenv =
    Object.entries(values)
      .map(([key, value]) => {
        if (/[\r\n"\\]/.test(value)) throw new Error('Configuration contains unsupported characters.');
        return `${key}="${value}"`;
      })
      .join('\n') + '\n';
  await writeFile('.env', dotenv, { flag: 'wx', mode: 0o600 });
  console.log(
    live
      ? '.env created. Run docker compose up -d db, npm run migrate, then npm run dev. For production, configure HTTPS first and use npm run build followed by npm start. Finish connections in Settings after signing in.'
      : '.env created. Start the demo with npm run dev.',
  );
  console.log(
    'AGY and local speech recognition require separate installation. Never share .env or credentials.',
  );
} catch (error) {
  console.error(
    (error as NodeJS.ErrnoException).code === 'EEXIST'
      ? 'Existing .env preserved. Change settings in the application or edit the existing file.'
      : 'Setup did not complete. Check the inputs and OAuth JSON file; existing configuration was not changed.',
  );
  process.exitCode = 1;
} finally {
  rl.close();
}
