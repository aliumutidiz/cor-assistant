import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from '@phosphor-icons/react';
import { api } from './api';
import type { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { agyLoginLink } from './agy-login-link';

export type AgyStatus = {
  available: boolean;
  active?: boolean;
  session?: string;
  offset?: number;
  connection?: { state: string; updatedAt?: string; model?: string };
};
export function AgyConsole({ close }: { close: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<string | undefined>(undefined);
  const [error, setError] = useState('');
  const [active, setActive] = useState(false);
  const [loginUrl, setLoginUrl] = useState<string>();
  useEffect(() => {
    let alive = true,
      session: string | undefined,
      terminal: Terminal | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined,
      inputTimer: ReturnType<typeof setTimeout> | undefined;
    let input = '',
      offset = 0;
    let resize: ResizeObserver | undefined;
    let writes = Promise.resolve();
    const fail = (e: unknown) => {
      if (alive) setError((e as Error).message);
    };
    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);
      if (!alive || !container.current) return;
      terminal = new Terminal({
        fontSize: 12,
        fontFamily: 'monospace',
        scrollback: 2000,
        cursorBlink: true,
        theme: { background: '#151918', foreground: '#e4e9e6' },
      });
      // Terminal output cannot write the browser clipboard or create OSC hyperlinks.
      terminal.parser.registerOscHandler(52, () => true);
      terminal.parser.registerOscHandler(8, (value) => {
        const link = agyLoginLink(value.slice(value.indexOf(';') + 1));
        if (link && alive) setLoginUrl(link);
        return true;
      });
      const fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.open(container.current);
      fit.fit();
      const started = await api<AgyStatus>('/agy/console/start', {});
      session = started.session;
      sessionRef.current = session;
      if (!alive || !session) {
        if (session) await api('/agy/console/stop', { session }).catch(() => {});
        return;
      }
      offset = started.offset ?? 0;
      setActive(true);
      const size = () => {
        if (!alive || !session || !terminal) return;
        fit.fit();
        void api('/agy/console/resize', {
          session,
          cols: Math.max(20, Math.min(200, terminal.cols)),
          rows: Math.max(8, Math.min(60, terminal.rows)),
        }).catch(fail);
      };
      resize = new ResizeObserver(size);
      resize.observe(container.current!);
      size();
      terminal.focus();
      terminal.onData((text) => {
        input += text;
        if (inputTimer) return;
        inputTimer = setTimeout(() => {
          inputTimer = undefined;
          const data = input;
          input = '';
          // Serialize keystrokes so pasted input and Enter cannot overtake each other.
          writes = writes
            .then(async () => {
              const points = Array.from(data);
              for (let i = 0; i < points.length; i += 800)
                await api('/agy/console/input', { session, input: points.slice(i, i + 800).join('') });
            })
            .catch(fail);
        }, 150);
      });
      const poll = async () => {
        try {
          const next = await api<{ active: boolean; data: string; offset: number; reset: boolean }>(
            `/agy/console/read?session=${session}&offset=${offset}`,
          );
          if (!alive) return;
          if (next.reset) terminal?.reset();
          if (next.data) terminal?.write(Uint8Array.from(atob(next.data), (c) => c.charCodeAt(0)));
          offset = next.offset;
          if (!next.active) {
            setActive(false);
            return;
          }
          timer = setTimeout(() => void poll(), 700);
        } catch (e) {
          fail(e);
          setActive(false);
        }
      };
      await poll();
    })().catch(fail);
    return () => {
      alive = false;
      clearTimeout(timer);
      clearTimeout(inputTimer);
      resize?.disconnect();
      terminal?.dispose();
      if (session) void api('/agy/console/stop', { session }).catch(() => {});
    };
  }, []);
  const finish = async () => {
    if (sessionRef.current) await api('/agy/console/stop', { session: sessionRef.current }).catch(() => {});
    close();
  };
  return (
    <Dialog.Root open onOpenChange={(open) => !open && void finish()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          className="modal-content agy-console-modal"
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <div className="modal-heading">
            <div>
              <Dialog.Title>AGY console</Dialog.Title>
              <Dialog.Description>
                Only AGY is available; this is not a Linux shell. Automatic chat waits while the console is
                open.
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="Close AGY console">
              <X size={20} />
            </Dialog.Close>
          </div>
          <p className="muted">
            Follow AGY's sign-in instructions here. Escape is sent to the console; use Close when finished.
            Sessions last at most 10 minutes.
          </p>
          <div ref={container} className="agy-terminal" aria-label="AGY terminal" />
          {loginUrl && (
            <a className="button subtle" href={loginUrl} target="_blank" rel="noopener noreferrer">
              Open Google sign-in
            </a>
          )}
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          <div className="editor-footer">
            <span role="status">
              {active ? 'Console open' : error ? 'Connection stopped' : 'Connecting or session expired'}
            </span>
            <button className="button subtle" onClick={() => void finish()}>
              Close and return to chat
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const labels: Record<string, string> = {
  ready: 'Connected',
  auth_required: 'Sign-in required',
  quota: 'Waiting for quota',
  error: 'Check connection',
  unknown: 'Not checked yet',
  unreachable: 'Console service unavailable',
  disabled: 'Off',
};
export function AgyPanel({ status, refresh }: { status?: AgyStatus; refresh: () => Promise<void> }) {
  const [open, setOpen] = useState(false),
    [note, setNote] = useState(''),
    [checking, setChecking] = useState(false);
  const state = status?.connection?.state ?? 'unknown';
  return (
    <>
      <article className="setting-row">
        <div>
          <h3>AGY connection</h3>
          <p>
            {labels[state] ?? 'Check connection'}
            {status?.active ? ' · Console open' : ''}
          </p>
          <small>
            Session loss is reported here and through Telegram when connected. Checking status does not call
            the model.
          </small>
        </div>
        <div className="agy-actions">
          <button
            className="button subtle"
            disabled={checking || !status?.available || status?.active}
            onClick={async () => {
              setChecking(true);
              setNote('');
              try {
                await api('/agy/check', {});
                await refresh();
              } catch (e) {
                setNote((e as Error).message);
              } finally {
                setChecking(false);
              }
            }}
          >
            {checking ? 'Checking…' : 'Check connection'}
          </button>
          <button className="button primary" disabled={!status?.available} onClick={() => setOpen(true)}>
            Open AGY console
          </button>
        </div>
      </article>
      {note && (
        <p className="error-text" role="alert">
          {note}
        </p>
      )}
      {open && (
        <AgyConsole
          close={() => {
            setOpen(false);
            void api('/agy/check', {})
              .then(refresh)
              .catch(() => refresh());
          }}
        />
      )}
    </>
  );
}
