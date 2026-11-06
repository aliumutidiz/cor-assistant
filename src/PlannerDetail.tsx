import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { api } from './api';
import type { CalendarEvent, Operation, OperationInput } from '../shared/contracts';
import type { MemoryRecord } from '../shared/memory';
export type PlannerItem = CalendarEvent & {
  source: 'program' | 'reminder' | 'routine';
  sourceId: string;
  entryId?: string;
  originalDay?: string;
  status?: 'done';
};
export function PlannerDetail({
  item,
  close,
  perform,
  changed,
  manage,
}: {
  item: PlannerItem;
  close: () => void;
  perform: (input: OperationInput) => Promise<Operation | undefined>;
  changed: () => void;
  manage: () => void;
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
      const { memoryInput } = await import('../shared/memory');
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
        <Dialog.Content className="modal-content">
          <Dialog.Title>{item.summary}</Dialog.Title>
          <Dialog.Description>
            {item.source === 'program'
              ? 'This occurrence belongs to your personal program. Other dates stay unchanged.'
              : 'This is a scheduled notification. Manage its source in the corresponding page.'}
          </Dialog.Description>
          {error && <p role="alert">{error}</p>}
          <button className="text-button" onClick={manage}>
            Manage {item.source === 'program' ? 'program' : item.source}
          </button>
          {item.source === 'program' && (
            <>
              <div className="form-actions">
                <button disabled={busy} onClick={() => void update('done')}>
                  Done
                </button>
                <button disabled={busy} onClick={() => void update('skipped')}>
                  Skip this occurrence
                </button>
                <button disabled={busy} onClick={() => void update('restore')}>
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
          <Dialog.Close className="text-button">Close</Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
