import { useCallback, useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from '@phosphor-icons/react';
import { api, formatDate } from './api';
import { focusDialog } from './dialog-focus';
import { memoryInput, type MemoryPage, type MemoryRecord } from '../shared/memory';
import { noteTarget, type NoteTarget } from '../shared/notes';
import type { Operation, OperationInput } from '../shared/contracts';

export type NoteContext = { target: NoteTarget; title: string };
export function NotesPanel({
  context,
  close,
  canEdit,
  perform,
  operations,
  zone,
}: {
  context: NoteContext;
  close: () => void;
  canEdit: boolean;
  perform: (action: OperationInput) => Promise<Operation | undefined>;
  operations: Operation[];
  zone: string;
}) {
  const [page, setPage] = useState<MemoryPage>({ items: [] });
  const [title, setTitle] = useState(''),
    [body, setBody] = useState('');
  const [editing, setEditing] = useState<MemoryRecord>();
  const [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [pending, setPending] = useState<{ id: string; clear: boolean }>();
  const targetKey = JSON.stringify(noteTarget.parse(context.target));
  const epoch = useRef(0);
  const cancel = useRef<AbortController | undefined>(undefined);
  const load = useCallback(
    async (before?: string) => {
      cancel.current?.abort();
      const controller = new AbortController();
      cancel.current = controller;
      const request = ++epoch.current;
      setLoading(true);
      try {
        const value = await api<MemoryPage>(
          '/memories?' +
            new URLSearchParams({ kind: 'note', noteTarget: targetKey, ...(before ? { before } : {}) }),
          undefined,
          'GET',
          undefined,
          controller.signal,
        );
        if (request === epoch.current)
          setPage((old) => ({
            ...value,
            items: before
              ? [...old.items, ...value.items.filter((item) => !old.items.some((row) => row.id === item.id))]
              : value.items,
          }));
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        if (request === epoch.current) setLoading(false);
      }
    },
    [targetKey],
  );
  useEffect(() => {
    void load();
    return () => {
      cancel.current?.abort();
      epoch.current++;
    };
  }, [load]);
  const finish = useCallback(
    (clear: boolean) => {
      setNotice(clear ? 'Note saved.' : 'Note archived.');
      if (clear) {
        setBody('');
        setTitle('');
        setEditing(undefined);
      }
      void load();
    },
    [load],
  );
  useEffect(() => {
    if (!pending) return;
    const op = operations.find((row) => row.id === pending.id);
    if (op?.status === 'succeeded') {
      setPending(undefined);
      finish(pending.clear);
    } else if (op && ['failed', 'unknown', 'canceled'].includes(op.status)) {
      setPending(undefined);
      setError(op.error ?? 'The note change could not be verified. Your draft is preserved.');
    }
  }, [operations, pending, finish]);
  async function apply(action: OperationInput, clear: boolean) {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const op = await perform(action);
      if (!op) throw Error('No note change was confirmed.');
      if (op.status === 'succeeded') finish(clear);
      else if (['failed', 'unknown', 'canceled'].includes(op.status))
        throw Error(op.error ?? 'The note change could not be verified.');
      else {
        setPending({ id: op.id, clear });
        setNotice('Note change pending. It has not been confirmed yet.');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const busy = saving || !!pending;
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !saving) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          aria-label="Notes"
          className="modal-content notes-dialog"
          onOpenAutoFocus={focusDialog}
        >
          <div className="dialog-heading">
            <div>
              <Dialog.Title>Notes</Dialog.Title>
              <Dialog.Description>{context.title}</Dialog.Description>
            </div>
            <Dialog.Close className="icon-button modal-close" aria-label="Close notes" disabled={saving}>
              <X size={20} />
            </Dialog.Close>
          </div>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="muted">
              {notice}
            </p>
          )}
          {canEdit && (
            <form
              className="memory-form notes-form"
              onSubmit={(e) => {
                e.preventDefault();
                try {
                  const record = memoryInput.parse({
                    ...(editing ? memoryInput.strip().parse(editing) : {}),
                    kind: 'note',
                    title: title.trim() || body.trim().split('\n')[0].slice(0, 120),
                    body,
                    noteTarget: context.target,
                  });
                  void apply(
                    editing
                      ? { kind: 'memory.update', memoryId: editing.id, version: editing.version, record }
                      : { kind: 'memory.create', record },
                    true,
                  );
                } catch {
                  setError('Enter a note within the displayed length limits.');
                }
              }}
            >
              <label>
                Title (optional)
                <input
                  value={title}
                  maxLength={300}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={busy}
                />
              </label>
              <label>
                {editing ? 'Edit note' : 'Add a note'}
                <textarea
                  aria-label={editing ? 'Edit note' : 'Add a note'}
                  required
                  value={body}
                  maxLength={10000}
                  rows={4}
                  onChange={(e) => setBody(e.target.value)}
                  disabled={busy}
                />
              </label>
              <div className="notes-actions">
                <button className="button primary" disabled={busy || !body.trim()}>
                  {busy ? 'Saving…' : editing ? 'Save changes' : 'Save note'}
                </button>
                {editing && (
                  <button
                    type="button"
                    className="button subtle"
                    disabled={busy}
                    onClick={() => {
                      setEditing(undefined);
                      setTitle('');
                      setBody('');
                    }}
                  >
                    Cancel edit
                  </button>
                )}
              </div>
            </form>
          )}
          <div className="notes-list" aria-busy={loading}>
            {!loading && !page.items.length && <p className="muted">No notes here yet.</p>}
            {page.items.map((note) => (
              <article className="attached-note" key={note.id}>
                {!note.body.startsWith(note.title) && <strong dir="auto">{note.title}</strong>}
                <p dir="auto" className="notes-text">
                  {note.body}
                </p>
                <footer>
                  <small>
                    {formatDate(note.updatedAt, zone)} · v{note.version}
                  </small>
                  {canEdit && (
                    <div className="notes-actions">
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => {
                          setEditing(note);
                          setTitle(note.title);
                          setBody(note.body);
                          setError('');
                          setNotice('');
                        }}
                      >
                        Edit note
                      </button>
                      <button
                        className="text-button"
                        disabled={busy || editing?.id === note.id}
                        onClick={() =>
                          void apply(
                            { kind: 'memory.archive', memoryId: note.id, version: note.version },
                            false,
                          )
                        }
                      >
                        Archive note
                      </button>
                    </div>
                  )}
                </footer>
              </article>
            ))}
            {loading && (
              <p role="status" className="muted">
                Loading notes…
              </p>
            )}
            {page.next && (
              <button className="button subtle" disabled={loading} onClick={() => void load(page.next)}>
                Load older notes
              </button>
            )}
            <button
              className="text-button"
              disabled={loading}
              onClick={() => {
                setError('');
                void load();
              }}
            >
              Refresh notes
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
