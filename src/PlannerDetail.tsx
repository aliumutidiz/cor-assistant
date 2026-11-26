import { X } from '@phosphor-icons/react';
import { focusDialog } from './dialog-focus';
import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { api, formatDate } from './api';
import type { CalendarEvent, Operation, OperationInput } from '../shared/contracts';
import { memoryInput, type MemoryRecord } from '../shared/memory';
export type PlannerItem = CalendarEvent & {
  source: 'program' | 'reminder' | 'routine';
  sourceId: string;
  entryId?: string;
  originalDay?: string;
  status?: 'done';
};
export function PlannerDetail({
  item,
  zone,
  canEdit,
  close,
  perform,
  changed,
  manage,
  onNotes,
}: {
  item: PlannerItem;
  zone: string;
  canEdit: boolean;
  close: () => void;
  perform: (input: OperationInput) => Promise<Operation | undefined>;
  changed: () => void;
  manage: () => void;
  onNotes?: () => void;
}) {
  const [moveTo, setMoveTo] = useState('');
  const [moveStart, setMoveStart] = useState(''),
    [moveEnd, setMoveEnd] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function update(status: 'done' | 'skipped' | 'moved' | 'restore') {
    setBusy(true);
    setError('');
    try {
      const record = await api<MemoryRecord>('/memories/' + item.sourceId);
      if (!record.program || !item.entryId || !item.originalDay)
        throw Error('The source program is no longer available.');
      const exceptions = (record.program.exceptions ?? []).filter(
        (x) => x.entryId !== item.entryId || x.day !== item.originalDay,
      );
      if (status !== 'restore')
        exceptions.push({
          entryId: item.entryId,
          day: item.originalDay,
          status,
          ...(status === 'moved'
            ? {
                movedTo: moveTo,
                ...(moveStart && moveEnd ? { movedStart: moveStart, movedEnd: moveEnd } : {}),
              }
            : {}),
        });
      const op = await perform({
        kind: 'memory.update',
        memoryId: record.id,
        version: record.version,
        record: memoryInput.strip().parse({ ...record, program: { ...record.program, exceptions } }),
      });
      if (op) {
        changed();
        close();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="modal-content" onOpenAutoFocus={focusDialog}>
          <div className="dialog-heading">
            <Dialog.Title>{item.summary}</Dialog.Title>
            <Dialog.Description>
              {item.start.dateTime ? formatDate(item.start.dateTime, zone) : item.start.date}
            </Dialog.Description>
            <Dialog.Close className="icon-button modal-close" aria-label="Close plan details">
              <X size={20} />
            </Dialog.Close>
          </div>
          <p className="muted">
            {item.source === 'program'
              ? 'This occurrence belongs to your personal program. Other dates stay unchanged.'
              : 'This is a scheduled notification. Manage its source in the corresponding page.'}
          </p>
          {error && <p role="alert">{error}</p>}
          <button className="text-button" onClick={manage}>
            Manage {item.source === 'program' ? 'program' : item.source}
          </button>
          {onNotes && (
            <button className="button subtle" onClick={onNotes}>
              Notes for this occurrence
            </button>
          )}
          {item.source === 'program' && canEdit && (
            <>
              <div className="form-actions plan-actions">
                <button className="button primary" disabled={busy} onClick={() => void update('done')}>
                  Done
                </button>
                <button className="button subtle" disabled={busy} onClick={() => void update('skipped')}>
                  Skip this occurrence
                </button>
                <button className="button subtle" disabled={busy} onClick={() => void update('restore')}>
                  Restore original
                </button>
              </div>
              <label>
                Move this occurrence
                <input type="date" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} />
              </label>
              <div className="form-grid">
                <label>
                  New start (optional)
                  <input type="time" value={moveStart} onChange={(e) => setMoveStart(e.target.value)} />
                </label>
                <label>
                  New end
                  <input type="time" value={moveEnd} onChange={(e) => setMoveEnd(e.target.value)} />
                </label>
              </div>
              <button
                disabled={
                  busy ||
                  !moveTo ||
                  (moveTo === item.originalDay && !moveStart) ||
                  Boolean(moveStart) !== Boolean(moveEnd) ||
                  (!!moveStart && moveEnd <= moveStart)
                }
                onClick={() => void update('moved')}
              >
                Move
              </button>
            </>
          )}
          <Dialog.Close className="button subtle">Close</Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
