import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Plus, X, Archive, PencilSimple, ArrowsClockwise } from '@phosphor-icons/react';
import { api, formatDate, dateTimeInput, zonedISO } from './api';
import type { MemoryInput, MemoryPage, MemoryRecord } from '../shared/memory';
import type { Operation, OperationInput } from '../shared/contracts';
import { memoryInput } from '../shared/memory';
import {
  memoryLabels as labels,
  ResourceFields,
  ResourcePreview,
  resourceDefaults,
  type ResourceData,
} from './ResourceFields';

export function MemoryPanel({
  perform,
  revision,
  timeZone,
  operations,
}: {
  perform: (a: OperationInput) => Promise<Operation | undefined>;
  revision: string;
  timeZone: string;
  operations: Operation[];
}) {
  const [query, setQuery] = useState(''),
    [kind, setKind] = useState(''),
    [archived, setArchived] = useState(false);
  const [page, setPage] = useState<MemoryPage>({ items: [] });
  const [editor, setEditor] = useState<MemoryRecord | null | undefined>();
  const [selected, setSelected] = useState<MemoryRecord>();
  const [versions, setVersions] = useState<MemoryRecord[]>([]);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [note, setNote] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [pending, setPending] = useState<string>();
  const [toggling, setToggling] = useState<string>();
  const selectedRequest = useRef(0);
  useEffect(() => {
    const operation = operations.find((op) => op.id === pending);
    if (operation?.status === 'succeeded') {
      setNote('Record saved.');
      setPending(undefined);
    } else if (operation?.status === 'failed' || operation?.status === 'unknown') {
      setError(
        operation.status === 'unknown'
          ? 'The outcome could not be verified. Check activity before submitting again.'
          : (operation.error ?? 'Could not save the record.'),
      );
      setNote('');
      setPending(undefined);
    }
  }, [operations, pending]);
  const epoch = useRef(0);
  const path =
    '/memories?' + new URLSearchParams({ query, ...(kind ? { kind } : {}), archived: String(archived) });
  useEffect(() => {
    const current = ++epoch.current,
      cancel = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError('');
      api<MemoryPage>(path, undefined, 'GET', undefined, cancel.signal)
        .then((value) => {
          if (epoch.current === current) setPage(value);
        })
        .catch((e) => {
          if (!cancel.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (epoch.current === current) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      cancel.abort();
    };
  }, [path, revision, refresh]);
  return (
    <section className="memory-panel">
      <div className="memory-toolbar">
        <input
          aria-label="Search records"
          placeholder="Search ideas, products or facts…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={200}
        />
        <select aria-label="Filter record type" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">All records</option>
          {Object.entries(labels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label className="memory-check">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
          Archived / completed
        </label>
        <button className="icon-button" aria-label="Refresh records" onClick={() => setRefresh((v) => v + 1)}>
          <ArrowsClockwise size={18} />
        </button>
        <button className="button primary" onClick={() => setEditor(null)}>
          <Plus size={16} />
          Add record
        </button>
      </div>
      <p className="muted small">
        Your profile, programs and lists are stored here. Search and schedule calculation run without an LLM.
      </p>
      <a className="text-button" href="/api/brain/export" download>
        Export memory as JSON
      </a>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {note && (
        <p role="status" className="muted">
          {note}
        </p>
      )}
      <div className="memory-grid" aria-busy={loading}>
        {page.items.map((record) => (
          <article className="memory-card" key={record.id}>
            <div className="operation-top">
              <span className="pill">{labels[record.kind]}</span>
              <small>{formatDate(record.createdAt, timeZone)}</small>
            </div>
            <button
              className="memory-title"
              onClick={async () => {
                const request = ++selectedRequest.current;
                setSelected(record);
                setVersions([]);
                try {
                  const versions = await api<MemoryRecord[]>('/memories/' + record.id + '/revisions');
                  if (request === selectedRequest.current) setVersions(versions);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              {record.title}
            </button>
            <p>{record.summary || record.body.slice(0, 240)}</p>
            <ResourcePreview
              record={record}
              busy={!!toggling}
              toggle={async (id) => {
                if (toggling) return;
                const original = record;
                try {
                  const input = memoryInput.strip().parse(record);
                  if (!input.shopping) return;
                  input.shopping.items = input.shopping.items.map((item) =>
                    item.id === id ? { ...item, checked: !item.checked } : item,
                  );
                  setToggling(record.id);
                  setPage((page) => ({
                    ...page,
                    items: page.items.map((row) =>
                      row.id === record.id ? { ...row, shopping: input.shopping } : row,
                    ),
                  }));
                  const result = await perform({
                    kind: 'memory.update',
                    memoryId: record.id,
                    version: record.version,
                    record: input,
                  });
                  if (!result || result.status !== 'succeeded') {
                    setPage((page) => ({
                      ...page,
                      items: page.items.map((row) => (row.id === record.id ? original : row)),
                    }));
                    if (result && ['queued', 'running'].includes(result.status)) setPending(result.id);
                    else throw new Error(result?.error ?? 'Could not update the list.');
                  }
                  setRefresh((v) => v + 1);
                } catch (e) {
                  setPage((page) => ({
                    ...page,
                    items: page.items.map((row) => (row.id === record.id ? original : row)),
                  }));
                  setError((e as Error).message);
                } finally {
                  setToggling(undefined);
                }
              }}
            />
            {record.kind === 'task' && (
              <small>
                {record.taskState === 'done'
                  ? 'Completed'
                  : record.remindAt
                    ? 'Reminder: ' + formatDate(record.remindAt, record.timeZone ?? timeZone)
                    : 'Open task · no reminder time'}
              </small>
            )}
            {record.amount !== null && (
              <strong>
                {record.amount} {record.currency}
              </strong>
            )}
            <div className="memory-tags">
              {record.tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
            <div className="memory-actions">
              {record.kind === 'task' && !record.archived && (
                <button
                  className="text-button"
                  onClick={async () => {
                    try {
                      await perform({
                        kind: 'memory.complete',
                        memoryId: record.id,
                        version: record.version,
                      });
                      setRefresh((v) => v + 1);
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Mark complete
                </button>
              )}
              {record.archived && (
                <button
                  className="text-button"
                  onClick={async () => {
                    try {
                      await perform({ kind: 'memory.restore', memoryId: record.id, version: record.version });
                      setRefresh((v) => v + 1);
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Restore
                </button>
              )}
              {!record.archived && (
                <button className="text-button" onClick={() => setEditor(record)}>
                  <PencilSimple size={15} />
                  Edit
                </button>
              )}
              {!record.archived && (
                <button
                  className="text-button"
                  onClick={async () => {
                    try {
                      await perform({ kind: 'memory.archive', memoryId: record.id, version: record.version });
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  <Archive size={15} />
                  Archive
                </button>
              )}
              <small>
                v{record.version} ·{' '}
                {record.source.channel === 'telegram'
                  ? 'Telegram'
                  : record.source.channel === 'chat'
                    ? 'Chat'
                    : 'Interface'}
              </small>
            </div>
          </article>
        ))}
      </div>
      {!page.items.length && !loading && (
        <p className="empty-state">
          {query
            ? 'No records match this search.'
            : 'No records yet. Share an idea or purchase in chat, or add one here.'}
        </p>
      )}
      {page.next && (
        <button
          className="button subtle"
          disabled={loading}
          onClick={async () => {
            const current = epoch.current;
            setLoading(true);
            try {
              const next = await api<MemoryPage>(path + '&before=' + page.next);
              if (current === epoch.current)
                setPage((old) => ({
                  items: [...old.items, ...next.items.filter((r) => !old.items.some((o) => o.id === r.id))],
                  next: next.next,
                }));
            } catch (e) {
              setError((e as Error).message);
            } finally {
              if (current === epoch.current) setLoading(false);
            }
          }}
        >
          Older records
        </button>
      )}
      {editor !== undefined && (
        <MemoryEditor
          initialKind={(kind as MemoryInput['kind']) || 'idea'}
          record={editor}
          timeZone={timeZone}
          close={() => setEditor(undefined)}
          save={async (input) => {
            const result = await perform(
              editor
                ? { kind: 'memory.update', memoryId: editor.id, version: editor.version, record: input }
                : { kind: 'memory.create', record: input },
            );
            setNote(
              result?.status === 'succeeded'
                ? 'Record saved.'
                : 'Save queued. Track the outcome in Activity.',
            );
            if (result?.status === 'queued' || result?.status === 'running') setPending(result.id);
            setEditor(undefined);
            setRefresh((v) => v + 1);
          }}
        />
      )}
      <Dialog.Root
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) {
            selectedRequest.current++;
            setSelected(undefined);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="modal-overlay" />
          <Dialog.Content className="modal-content memory-detail">
            <Dialog.Title>{selected?.title}</Dialog.Title>
            <Dialog.Description>Original record, source and the latest 50 versions.</Dialog.Description>
            <Dialog.Close className="icon-button modal-close" aria-label="Close record">
              <X size={18} />
            </Dialog.Close>
            {selected && (
              <>
                <p className="memory-body">{selected.body}</p>
                <ResourcePreview record={selected} />
                <p>Recorded: {formatDate(selected.createdAt, timeZone)}</p>
                <p>
                  Occurred:{' '}
                  {selected.occurredAt
                    ? formatDate(selected.occurredAt, timeZone)
                    : selected.occurredOn
                      ? selected.occurredOn + ' · no time specified'
                      : 'Not specified'}
                </p>
                {selected.amount !== null && (
                  <p>
                    Recorded amount: {selected.amount} {selected.currency}. Review the original text for
                    payment terms.
                  </p>
                )}
                <details>
                  <summary>Source text</summary>
                  <p className="memory-body">{selected.source.text}</p>
                </details>
                <details>
                  <summary>Version history ({versions.length})</summary>
                  {versions.map((v) => (
                    <article key={v.version}>
                      <strong>
                        v{v.version} · {formatDate(v.updatedAt, timeZone)}
                      </strong>
                      <p className="memory-body">{v.body}</p>
                      {v.archived && <small>Archived</small>}
                    </article>
                  ))}
                </details>
                <a className="button subtle" href={'/api/memories/' + selected.id + '/export'} download>
                  Download Markdown
                </a>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}

function MemoryEditor({
  record,
  initialKind,
  timeZone,
  close,
  save,
}: {
  record: MemoryRecord | null;
  initialKind: MemoryInput['kind'];
  timeZone: string;
  close: () => void;
  save: (input: MemoryInput) => Promise<void>;
}) {
  const effectiveZone = record?.timeZone ?? timeZone;
  const [kind, setKind] = useState<MemoryInput['kind']>(record?.kind ?? initialKind);
  const [resources, setResources] = useState<ResourceData>(
    record
      ? { profile: record.profile, program: record.program, shopping: record.shopping }
      : resourceDefaults(initialKind, timeZone),
  );
  const [title, setTitle] = useState(record?.title ?? ''),
    [body, setBody] = useState(record?.body ?? '');
  const [summary, setSummary] = useState(record?.summary ?? ''),
    [tags, setTags] = useState(record?.tags.join(', ') ?? '');
  const [amount, setAmount] = useState(record?.amount ?? ''),
    [currency, setCurrency] = useState(record?.currency ?? 'TRY');
  const [when, setWhen] = useState(
    record?.occurredAt ? dateTimeInput(new Date(record.occurredAt), effectiveZone) : '',
  );
  const [day, setDay] = useState(record?.occurredOn ?? '');
  const [remindAt, setRemindAt] = useState(
    record?.remindAt ? dateTimeInput(new Date(record.remindAt), effectiveZone) : '',
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="modal-content">
          <Dialog.Title>{record ? 'Edit record' : 'Add personal record'}</Dialog.Title>
          <Dialog.Description>
            Leave unknown dates or amounts empty. The recording time is automatic.
          </Dialog.Description>
          <Dialog.Close className="icon-button modal-close" disabled={busy} aria-label="Close record editor">
            <X size={18} />
          </Dialog.Close>
          <form
            className="memory-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                await save({
                  ...resources,
                  kind,
                  title,
                  body,
                  summary,
                  tags: [
                    ...new Set(
                      tags
                        .split(',')
                        .map((t) => t.trim())
                        .filter(Boolean),
                    ),
                  ],
                  occurredAt: when ? zonedISO(when, effectiveZone) : null,
                  occurredOn: day || null,
                  ...(kind === 'task'
                    ? {
                        taskState: record?.taskState ?? 'open',
                        remindAt: remindAt ? zonedISO(remindAt, effectiveZone) : null,
                      }
                    : {}),
                  amount: kind === 'purchase' && amount ? amount.replace(',', '.') : null,
                  currency: kind === 'purchase' && amount ? currency : null,
                });
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {kind === 'task' && (
              <label>
                Reminder time (optional)
                <input type="datetime-local" value={remindAt} onChange={(e) => setRemindAt(e.target.value)} />
                <small>
                  Leave empty to save an unscheduled task. Scheduled reminders run without an LLM.
                </small>
              </label>
            )}
            <label>
              Type
              <select
                value={kind}
                onChange={(e) => {
                  const next = e.target.value as MemoryInput['kind'];
                  setKind(next);
                  setResources(resourceDefaults(next, effectiveZone));
                }}
              >
                {Object.entries(labels).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Title
              <input required maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label>
              Original content
              <textarea
                required
                rows={5}
                maxLength={10000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
            <label>
              Short summary
              <textarea
                rows={2}
                maxLength={1000}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
              />
            </label>
            <ResourceFields value={resources} onChange={setResources} />
            <label>
              Tags (comma-separated)
              <input value={tags} onChange={(e) => setTags(e.target.value)} />
            </label>
            <label>
              Exact occurrence time (optional · {effectiveZone})
              <input
                type="datetime-local"
                value={when}
                onChange={(e) => {
                  setWhen(e.target.value);
                  if (e.target.value) setDay(e.target.value.split('T')[0]);
                }}
              />
            </label>
            <label>
              If only the date is known
              <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
            </label>
            {kind === 'purchase' && (
              <div className="form-grid">
                <label>
                  Amount
                  <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </label>
                <label>
                  Currency
                  <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                    {['TRY', 'USD', 'EUR', 'GBP'].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            {error && (
              <div className="error-banner" role="alert">
                {error}
              </div>
            )}
            <button type="submit" className="button primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
