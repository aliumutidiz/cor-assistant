import { useCallback, useEffect, useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Bell, Plus, Pause, Play, PencilSimple, Trash, X, Clock } from '@phosphor-icons/react';
import type { Reminder, ReminderInput } from '../shared/reminders';
import type { Operation, OperationInput } from '../shared/contracts';
import { api, dateTimeInput, formatDate, zonedISO } from './api';

export function ReminderPanel({
  zone,
  telegramEnabled,
  perform,
}: {
  zone: string;
  telegramEnabled: boolean;
  perform: (action: OperationInput) => Promise<Operation>;
}) {
  const [items, setItems] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState<'active' | 'history'>('active');
  const [editor, setEditor] = useState<Reminder | null | undefined>();
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    try {
      setItems(await api<Reminder[]>('/reminders'));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), 5000);
    return () => clearInterval(timer);
  }, [reload]);
  const apply = async (action: OperationInput) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const op = await perform(action);
      if (op.status === 'failed' || op.status === 'unknown')
        throw Error(op.error ?? 'The action outcome could not be verified.');
      setNotice(
        op.status === 'succeeded'
          ? 'Reminder saved.'
          : 'Action queued. The list will refresh when it completes.',
      );
      await reload();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const visible = items.filter((r) =>
    filter === 'active' ? r.state === 'scheduled' : r.state !== 'scheduled',
  );
  return (
    <section className="reminder-workspace">
      <div className="reminder-toolbar">
        <div className="view-tabs" aria-label="Filter reminders">
          <button className={filter === 'active' ? 'selected' : ''} onClick={() => setFilter('active')}>
            Pending <span>{items.filter((r) => r.state === 'scheduled').length}</span>
          </button>
          <button className={filter === 'history' ? 'selected' : ''} onClick={() => setFilter('history')}>
            History
          </button>
        </div>
        <button className="button primary" onClick={() => setEditor(null)}>
          <Plus size={17} />
          Add reminder
        </button>
      </div>
      <p className="reminder-explainer">
        <Bell size={18} />
        Independent of your calendar. Receive a Telegram message when it is due.
      </p>
      {!telegramEnabled && (
        <p className="notice">
          Telegram is not connected. You can save reminders; connect Telegram in Settings for delivery.
        </p>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {loading ? (
        <p className="muted" role="status">
          Loading reminders…
        </p>
      ) : visible.length ? (
        <div className="reminder-list">
          {visible.map((r) => (
            <article className={'reminder-row ' + (!r.enabled ? 'is-paused' : '')} key={r.id}>
              <div className="reminder-clock">
                <Clock size={21} />
              </div>
              <div className="reminder-copy">
                <strong>{r.title}</strong>
                <p>{r.message !== r.title ? r.message : null}</p>
                <div className="reminder-meta">
                  <time>{r.remindAt ? formatDate(r.remindAt, zone) : 'Waiting for next occurrence'}</time>
                  <span>
                    {r.state === 'delivered'
                      ? 'Delivered'
                      : r.state === 'canceled'
                        ? 'Canceled'
                        : r.enabled
                          ? 'Scheduled'
                          : 'Paused'}
                  </span>
                  {r.event && (
                    <span>
                      Linked to event · {r.event.minutesBefore} min before
                      {r.repeating ? ' · Her tekrarda' : ''}
                    </span>
                  )}
                </div>
                {r.lastError && <small className="error-text">{r.lastError}</small>}
              </div>
              {r.state === 'scheduled' && (
                <div className="reminder-actions">
                  <button
                    className="icon-button"
                    disabled={busy}
                    aria-label={`Edit ${r.title}`}
                    onClick={() => setEditor(r)}
                  >
                    <PencilSimple size={18} />
                  </button>
                  <button
                    className="icon-button"
                    disabled={busy}
                    aria-label={r.enabled ? 'Pause reminder' : 'Enable reminder'}
                    onClick={() => {
                      const input: ReminderInput = {
                        title: r.title,
                        message: r.message,
                        enabled: !r.enabled,
                        ...(r.event ? { event: r.event } : { remindAt: r.remindAt! }),
                      };
                      void apply({
                        kind: 'reminder.update',
                        reminderId: r.id,
                        version: r.version,
                        reminder: input,
                      });
                    }}
                  >
                    {r.enabled ? <Pause size={18} /> : <Play size={18} />}
                  </button>
                  <button
                    className="icon-button danger"
                    disabled={busy}
                    aria-label={`Cancel reminder ${r.title}`}
                    onClick={() =>
                      void apply({ kind: 'reminder.cancel', reminderId: r.id, version: r.version })
                    }
                  >
                    <Trash size={18} />
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="empty">
          <Bell size={32} weight="thin" />
          <strong>{filter === 'active' ? 'Keep the details close.' : 'No history yet.'}</strong>
          <p>
            {filter === 'active'
              ? 'Choose a time or say “remind me in five hours” in chat.'
              : 'Delivered and canceled reminders appear here.'}
          </p>
        </div>
      )}
      {editor !== undefined && (
        <ReminderEditor
          reminder={editor}
          zone={zone}
          busy={busy}
          onClose={() => setEditor(undefined)}
          save={async (input) => {
            const ok = await apply(
              editor
                ? { kind: 'reminder.update', reminderId: editor.id, version: editor.version, reminder: input }
                : { kind: 'reminder.create', reminder: input },
            );
            if (ok) setEditor(undefined);
            else throw Error('Could not save. Check the error shown on this page.');
          }}
        />
      )}
    </section>
  );
}

function ReminderEditor({
  reminder,
  zone,
  busy,
  onClose,
  save,
}: {
  reminder: Reminder | null;
  zone: string;
  busy: boolean;
  onClose: () => void;
  save: (input: ReminderInput) => Promise<void>;
}) {
  const [title, setTitle] = useState(reminder?.title ?? '');
  const [message, setMessage] = useState(reminder?.message ?? '');
  const [at, setAt] = useState(dateTimeInput(new Date(reminder?.remindAt ?? Date.now() + 3600000), zone));
  const [minutes, setMinutes] = useState(reminder?.event?.minutesBefore ?? 60);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await save({
        title,
        message: message.trim() || title,
        enabled: reminder?.enabled ?? true,
        ...(reminder?.event
          ? { event: { ...reminder.event, minutesBefore: minutes } }
          : { remindAt: zonedISO(at, zone) }),
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Dialog.Root open onOpenChange={(open) => !open && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="modal-content">
          <div className="modal-heading">
            <div>
              <Dialog.Title>{reminder ? 'Edit reminder' : 'New reminder'}</Dialog.Title>
              <Dialog.Description>Does not create an event or task. Time zone: {zone}</Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" disabled={busy} aria-label="Close">
              <X size={20} />
            </Dialog.Close>
          </div>
          <form className="editor-form" onSubmit={(e) => void submit(e)}>
            <label>
              Reminder title
              <input
                autoFocus
                required
                maxLength={300}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What should I remind you about?"
              />
            </label>
            <label>
              Message <span className="muted">(optional)</span>
              <textarea
                rows={3}
                maxLength={2000}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Leave empty to send the title."
              />
            </label>
            {reminder?.event ? (
              <label>
                Minutes before the event
                <input
                  type="number"
                  min={0}
                  max={525600}
                  required
                  value={minutes}
                  onChange={(e) => setMinutes(Number(e.target.value))}
                />
                <small className="muted">The reminder follows changes to the event time.</small>
              </label>
            ) : (
              <>
                <div className="reminder-presets">
                  {[
                    [15, 'In 15 minutes'],
                    [60, 'In 1 hour'],
                    [300, 'In 5 hours'],
                  ].map(([minutes, label]) => (
                    <button
                      type="button"
                      className="button subtle small"
                      key={minutes}
                      onClick={() =>
                        setAt(dateTimeInput(new Date(Date.now() + Number(minutes) * 60000), zone))
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <label>
                  Reminder time
                  <input type="datetime-local" required value={at} onChange={(e) => setAt(e.target.value)} />
                </label>
              </>
            )}
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
            <footer className="editor-footer">
              <button type="button" className="button subtle" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button className="button primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
