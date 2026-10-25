import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: spawnMock }));
import { terminateProcessTree } from '../server/process-tree';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  spawnMock.mockReset();
});
describe('model process cancellation', () => {
  it('kills a POSIX process group rather than only the parent', () => {
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    const child = { pid: 4567, kill: vi.fn() };
    terminateProcessTree(child, 'linux');
    expect(kill).toHaveBeenCalledWith(-4567, 'SIGKILL');
    expect(child.kill).not.toHaveBeenCalled();
  });
  it('uses the absolute Windows tool with fixed arguments and no inherited secrets', () => {
    vi.stubEnv('SystemRoot', 'C:\\Windows');
    const cleanup = new EventEmitter();
    spawnMock.mockReturnValue(cleanup);
    const child = { pid: 4567, kill: vi.fn() };
    terminateProcessTree(child, 'win32');
    expect(spawnMock).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\taskkill.exe',
      ['/PID', '4567', '/T', '/F'],
      expect.objectContaining({
        shell: false,
        windowsHide: true,
        env: { SystemRoot: 'C:\\Windows', SYSTEMROOT: 'C:\\Windows' },
      }),
    );
    cleanup.emit('error', new Error('unavailable'));
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });
});
