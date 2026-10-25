import { useEffect, useState } from 'react';
import { api } from './api';
import type { ConversationState, ConversationChange } from '../shared/chat-controls';
import { MarkdownMessage } from './MarkdownMessage';
type Row = { id: string; role: string; text: string; createdAt: string; channel?: string };
export function ChatTools({
  busy,
  onContext,
  onChanged,
}: {
  busy: boolean;
  onContext: (state: ConversationState) => void;
  onChanged: () => Promise<void>;
}) {
  const [state, setState] = useState<ConversationState>();
  const [open, setOpen] = useState(false),
    [pending, setPending] = useState<ConversationChange['mode']>(),
    [working, setWorking] = useState(false),
    [notice, setNotice] = useState(''),
    [query, setQuery] = useState(''),
    [rows, setRows] = useState<Row[]>([]),
    [before, setBefore] = useState<string>();
  useEffect(() => {
    let alive = true;
    void api<ConversationState>('/chat/context')
      .then((s) => {
        if (alive && Number.isInteger(s.version)) {
          setState(s);
          onContext(s);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [onContext]);
  async function change(mode: ConversationChange['mode'], messageId?: string) {
    if (!state) return;
    setWorking(true);
    try {
      const next = await api<ConversationState>('/chat/context', {
        expectedVersion: state.version,
        mode,
        messageId,
      });
      setState(next);
      onContext(next);
      setPending(undefined);
      setRows([]);
      await onChanged();
      setNotice(
        mode === 'new'
          ? 'New conversation started.'
          : mode === 'reset'
            ? 'Context reset. Saved history remains available.'
            : 'Local conversation records removed.',
      );
    } catch (e) {
      setNotice((e as Error).message);
      const next = await api<ConversationState>('/chat/context').catch(() => undefined);
      if (next) {
        setState(next);
        onContext(next);
      }
    } finally {
      setWorking(false);
    }
  }
  async function search(older = false) {
    setWorking(true);
    try {
      const found = await api<Row[]>(
        '/chat/history?archive=true' +
          (query.trim()
            ? '&q=' + encodeURIComponent(query.trim())
            : older && before
              ? '&before=' + before
              : ''),
      );
      setRows((old) => (older ? [...found, ...old] : found));
      setBefore(!query.trim() && found.length === 50 ? found[0].id : undefined);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setWorking(false);
    }
  }
  async function download(format: 'json' | 'md') {
    setWorking(true);
    try {
      const data = await api<{ messages: Row[]; possiblyTruncated: boolean }>('/chat/export');
      const body =
        format === 'json'
          ? JSON.stringify(data, null, 2)
          : '# C.O.R. conversation export\n\nLatest 500 local messages. Personal memory is separate.\n\n' +
            data.messages.map((r) => '## ' + r.role + ' · ' + r.createdAt + '\n\n' + r.text).join('\n\n');
      const url = URL.createObjectURL(
        new Blob([body], { type: format === 'json' ? 'application/json' : 'text/markdown' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'cor-conversation.' + format;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(
        data.possiblyTruncated
          ? 'Exported latest 500 messages. Older records may exist.'
          : 'Export downloaded.',
      );
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setWorking(false);
    }
  }
  return (
    <div className="chat-tools">
      <button className="secondary" aria-expanded={open} onClick={() => setOpen(!open)}>
        Conversation
      </button>
      {open && (
        <div className="chat-tools-panel">
          <div className="chat-tools-actions">
            <button disabled={busy || working || !state} onClick={() => setPending('new')}>
              New chat
            </button>
            <button disabled={busy || working || !state} onClick={() => setPending('reset')}>
              Reset context
            </button>
            <button disabled={working} onClick={() => void search()}>
              Saved history
            </button>
            <button disabled={working} onClick={() => void download('md')}>
              Export Markdown
            </button>
            <button disabled={working} onClick={() => void download('json')}>
              Export JSON
            </button>
            <button disabled={busy || working || !state} onClick={() => setPending('delete')}>
              Delete local history
            </button>
          </div>
          <p className="muted">
            Controls apply to your web and Telegram conversation. Calendar, routines and saved personal memory
            are kept. Manage saved facts in Memory.
          </p>
          {pending && (
            <div role="alert">
              <p>
                {pending === 'new'
                  ? 'Start with fresh context and an empty conversation? Previous messages stay in Saved history.'
                  : pending === 'reset'
                    ? 'Stop using earlier messages as context? They remain visible in history.'
                    : 'Delete the local chat archive? This cannot be undone here. Backups, remote AGY/Telegram history and operation records are separate.'}
              </p>
              <button disabled={working} onClick={() => void change(pending)}>
                Confirm
              </button>
              <button onClick={() => setPending(undefined)}>Cancel</button>
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <label>
              Search saved history
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                maxLength={200}
                placeholder="Find earlier messages"
              />
            </label>
            <button disabled={working}>Search</button>
          </form>
          {!working && rows.length === 0 && (
            <small>No history displayed. Search or open Saved history.</small>
          )}
          {query && rows.length > 0 && <small>Up to 8 relevant matches</small>}
          {before && (
            <button disabled={working} onClick={() => void search(true)}>
              Earlier messages
            </button>
          )}
          <div className="chat-tools-history">
            {rows.map((r) => (
              <article key={r.id}>
                <small>
                  {r.role} · {new Date(r.createdAt).toLocaleString()}
                </small>
                <MarkdownMessage text={r.text} />
                <button
                  disabled={busy || working || !state || r.channel === 'legacy'}
                  title={
                    r.channel === 'legacy' ? 'Migrated entries require full archive deletion.' : undefined
                  }
                  onClick={() => {
                    if (
                      window.confirm(
                        'Forget this exchange locally and start a fresh AGY context? Saved memory and remote history are separate.',
                      )
                    )
                      void change('forget', r.id);
                  }}
                >
                  Forget this exchange
                </button>
              </article>
            ))}
          </div>
        </div>
      )}
      {notice && <small role="status">{notice}</small>}
    </div>
  );
}
export function CopyReply({ text }: { text: string }) {
  const [status, setStatus] = useState('');
  return (
    <span>
      <button
        className="message-copy"
        onClick={async () => {
          try {
            if (!navigator.clipboard) throw new Error('Clipboard unavailable');
            await navigator.clipboard.writeText(text);
            setStatus('Copied');
          } catch {
            setStatus('Copy unavailable');
          }
        }}
      >
        Copy
      </button>
      <small role="status">{status}</small>
    </span>
  );
}
