import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { terminateProcessTree } from '../server/process-tree.js';

// Synthetic process tree only: no model invocation, credentials or network.
const grandchildCode = 'setInterval(() => {}, 1000)';
const parentCode = `const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e',${JSON.stringify(grandchildCode)}],{stdio:'ignore',windowsHide:true}); c.once('spawn',()=>process.stdout.write(String(c.pid)+'\\n')); setInterval(()=>{},1000);`;
const child = spawn(process.execPath, ['-e', parentCode], {
  detached: process.platform !== 'win32',
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'ignore'],
  env: { SystemRoot: process.env.SystemRoot, SYSTEMROOT: process.env.SYSTEMROOT },
});
let grandchild: number | undefined;
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
try {
  let output = '';
  const deadline = Date.now() + 5000;
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  while (!output.includes('\n') && Date.now() < deadline) await delay(25);
  grandchild = Number(output.trim());
  if (!Number.isSafeInteger(grandchild) || grandchild <= 0 || !child.pid)
    throw Error('Synthetic process setup failed');
  const closed = once(child, 'close');
  terminateProcessTree(child);
  await Promise.race([
    closed,
    delay(5000).then(() => {
      throw Error('Parent process did not close');
    }),
  ]);
  const cleanupDeadline = Date.now() + 3000;
  while (alive(grandchild) && Date.now() < cleanupDeadline) await delay(50);
  if (alive(grandchild)) throw Error('Descendant process survived cancellation');
  console.log(JSON.stringify({ platform: process.platform, parentStopped: true, descendantStopped: true }));
} finally {
  if (child.exitCode === null && child.signalCode === null) terminateProcessTree(child);
  if (grandchild && alive(grandchild)) {
    try {
      process.kill(grandchild, 'SIGKILL');
    } catch {}
  }
}
