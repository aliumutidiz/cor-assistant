import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { join, resolve } from 'node:path';
import pg from 'pg';

// This operator-only utility deliberately does not expose HTTP backup endpoints.
// Secrets are read from environment, never interpolated into shell commands.
const mode = process.argv[2] ?? 'backup';
const database = process.env.DATABASE_URL;
const key = Buffer.from(process.env.BACKUP_KEY ?? '', 'base64');
if (!database || key.length !== 32)
  throw new Error('DATABASE_URL and an independent base64 32-byte BACKUP_KEY are required');
function pgEnv(connection: string) {
  const u = new URL(connection);
  return {
    ...process.env,
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGDATABASE: decodeURIComponent(u.pathname.slice(1)),
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
  };
}
function processExit(child: ReturnType<typeof spawn>) {
  return new Promise<void>((yes, no) => {
    child.once('error', () => no(new Error('Install PostgreSQL client tools')));
    child.once('close', (code) =>
      code === 0
        ? yes()
        : no(new Error('PostgreSQL backup/restore failed; database was not reported as verified')),
    );
  });
}
const directory = resolve(process.env.BACKUP_DIR ?? 'backups');
await mkdir(directory, { recursive: true, mode: 0o700 });
if (mode === 'backup') {
  const name = 'cor-' + new Date().toISOString().replaceAll(':', '-') + '.corbak',
    target = join(directory, name),
    temporary = target + '.partial';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const child = spawn('pg_dump', ['--format=custom', '--no-owner', '--no-privileges'], {
    env: pgEnv(database),
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const done = processExit(child);
  try {
    const file = await open(temporary, 'wx', 0o600);
    await file.write(Buffer.concat([Buffer.from('CORBK1'), iv]));
    await file.close();
    await Promise.all([
      pipeline(child.stdout!, cipher, createWriteStream(temporary, { flags: 'a', mode: 0o600 })),
      done,
    ]);
    await appendFile(temporary, cipher.getAuthTag());
    await rename(temporary, target);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isFile() && /^cor-\d{4}-.*\.corbak$/.test(entry.name)) {
        const p = join(directory, entry.name);
        if (Date.now() - (await stat(p)).mtimeMs > 30 * 86400000) await rm(p);
      }
    }
    process.stdout.write('Encrypted backup written: ' + target + '\n');
  } catch (error) {
    child.kill();
    await rm(temporary, { force: true });
    throw error;
  }
} else if (mode === 'verify-restore') {
  const source = process.argv[3],
    restore = process.env.RESTORE_DATABASE_URL;
  if (!source || !restore)
    throw new Error(
      'Provide a .corbak file and RESTORE_DATABASE_URL for an empty, separate verification database',
    );
  const live = new URL(database),
    test = new URL(restore);
  if (live.pathname === test.pathname)
    throw new Error('Restore verification database must have a different name from the live database');
  const destination = join(directory, 'verify-' + randomBytes(12).toString('hex') + '.dump');
  const info = await stat(source);
  if (info.size < 34) throw new Error('Backup truncated');
  const input = await open(source, 'r');
  const header = Buffer.alloc(18),
    tag = Buffer.alloc(16);
  await input.read(header, 0, 18, 0);
  await input.read(tag, 0, 16, info.size - 16);
  await input.close();
  if (header.subarray(0, 6).toString() !== 'CORBK1') throw new Error('Unknown backup format');
  const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(6));
  decipher.setAuthTag(tag);
  try {
    await pipeline(
      createReadStream(source, { start: 18, end: info.size - 17 }),
      decipher,
      createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
    );
    const client = new pg.Client({ connectionString: restore });
    await client.connect();
    try {
      const x = await client.query(
        "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'",
      );
      if (Number(x.rows[0].count) !== 0) throw new Error('Verification database must be empty');
    } finally {
      await client.end();
    }
    const child = spawn(
      'pg_restore',
      [
        '--exit-on-error',
        '--single-transaction',
        '--no-owner',
        '--no-privileges',
        '--dbname',
        decodeURIComponent(test.pathname.slice(1)),
        destination,
      ],
      { env: pgEnv(restore), shell: false, windowsHide: true, stdio: 'ignore' },
    );
    await processExit(child);
    const check = new pg.Client({ connectionString: restore });
    await check.connect();
    try {
      for (const table of ['routines', 'operations', 'jobs', 'kv', 'calendar_cache', 'oauth_states'])
        await check.query('SELECT count(*) FROM ' + table);
      process.stdout.write(
        'Restore verified in separate database. Keep ENCRYPTION_KEY separately to decrypt restored Google credentials.\n',
      );
    } finally {
      await check.end();
    }
  } finally {
    await rm(destination, { force: true });
  }
} else throw new Error('Use backup or verify-restore');
