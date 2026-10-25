import { existsSync, readFileSync } from 'node:fs';
import { loadConfig } from '../server/config.js';

let failures = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'OK' : 'FAIL'}  ${label}: ${detail}`);
  if (!ok) failures++;
}
const major = Number(process.versions.node.split('.')[0]);
check('Node.js', major >= 22, `${process.versions.node} (24 LTS recommended)`);
check(
  'Configuration file',
  existsSync('.env'),
  existsSync('.env')
    ? 'present; values are never displayed'
    : 'run npm run setup, or use the no-configuration demo',
);
try {
  const config = loadConfig();
  check(
    'Configuration validation',
    true,
    config.DEMO_MODE ? 'local disposable demo' : 'persistent owner installation',
  );
  if (!config.DEMO_MODE) {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: config.DATABASE_URL, connectionTimeoutMillis: 5000 });
    try {
      await client.connect();
      await client.query('SELECT 1');
      check('PostgreSQL', true, 'reachable');
    } catch {
      check('PostgreSQL', false, 'unreachable; check service, credentials and connection URL');
    } finally {
      await client.end().catch(() => {});
    }
  }
  check(
    'Skill catalog',
    existsSync('skills/BOOTSTRAP.md') && existsSync('skills/routine-management/SKILL.md'),
    'required instruction files',
  );
  if (config.AGY_ENABLED)
    check(
      'AGY isolation',
      process.platform === 'linux' && !!config.AGY_SOCKET,
      'Linux socket adapter and isolated service required',
    );
  else
    console.log('INFO  Assistant is disabled; calendar, memory and deterministic routines remain available.');
  if (existsSync('.env'))
    check(
      'Git exclusions',
      /(?:^|\n)\.env(?:\r?\n|$)/.test(readFileSync('.gitignore', 'utf8')),
      '.env must remain outside version control',
    );
} catch {
  check('Configuration validation', false, 'invalid settings; compare .env.example (secret values omitted)');
}
console.log(failures ? `${failures} check(s) need attention.` : 'All applicable checks passed.');
process.exitCode = failures ? 1 : 0;
