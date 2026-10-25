#!/opt/cor-runtime/node
// Installed as a root-owned file outside the release directory.
import { randomBytes, createCipheriv } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const keyPath = '/etc/cor/deploy-backup.key';
if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: 'wx' });
const key = readFileSync(keyPath);
const result = spawnSync('/usr/bin/docker', [
  'exec', 'cor-linux-db-1', 'pg_dump', '-U', 'cor_admin', '-d', 'cor', '-Fc',
], { maxBuffer: 512 * 1024 * 1024 });
if (result.status !== 0 || !result.stdout?.length) throw new Error('Pre-deploy database backup failed');
const iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', key, iv);
const encrypted = Buffer.concat([cipher.update(result.stdout), cipher.final()]);
mkdirSync('/var/backups/cor-deploy', { recursive: true, mode: 0o700 });
writeFileSync(`/var/backups/cor-deploy/${Date.now()}.corbackup`,
  Buffer.concat([Buffer.from('COR1'), iv, cipher.getAuthTag(), encrypted]), { mode: 0o600, flag: 'wx' });
console.log('Encrypted database backup saved');
