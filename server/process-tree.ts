import { spawn, type ChildProcess } from 'node:child_process';
import { win32 } from 'node:path';

// POSIX callers must launch the child with detached:true to create its process group.
// This is cancellation cleanup, not an operating-system isolation boundary.
export function terminateProcessTree(
  child: Pick<ChildProcess, 'pid' | 'kill'>,
  platform: NodeJS.Platform = process.platform,
) {
  const pid = child.pid;
  if (!pid || !Number.isSafeInteger(pid) || pid <= 0) {
    child.kill('SIGKILL');
    return;
  }
  if (platform === 'win32') {
    const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
    if (!systemRoot || !win32.isAbsolute(systemRoot)) {
      child.kill('SIGKILL');
      return;
    }
    try {
      const cleanup = spawn(
        win32.join(systemRoot, 'System32', 'taskkill.exe'),
        ['/PID', String(pid), '/T', '/F'],
        {
          shell: false,
          windowsHide: true,
          stdio: 'ignore',
          env: { SystemRoot: systemRoot, SYSTEMROOT: systemRoot },
        },
      );
      cleanup.once('error', () => child.kill('SIGKILL'));
      cleanup.once('close', (code) => {
        if (code !== 0) child.kill('SIGKILL');
      });
    } catch {
      child.kill('SIGKILL');
    }
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}
