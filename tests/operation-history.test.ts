import { it, expect } from 'vitest';
import { mergeOperationHistory } from '../src/operation-history';
import type { Operation } from '../shared/contracts';
it('keeps pending acknowledgements and does not regress terminal results behind late snapshots', () => {
  const op = {
    id: 'one',
    status: 'succeeded',
    createdAt: '2026-11-25T09:00:00Z',
    updatedAt: '2026-11-25T09:00:02Z',
  } as Operation;
  const stale = { ...op, status: 'running', updatedAt: '2026-11-25T09:00:01Z' } as Operation;
  expect(mergeOperationHistory([op], [stale])[0].status).toBe('succeeded');
  expect(mergeOperationHistory([stale], [])).toEqual([stale]);
  expect(mergeOperationHistory([stale], [op])[0].status).toBe('succeeded');
  expect(mergeOperationHistory([op], [{ ...op, status: 'queued' }])[0].status).toBe('succeeded');
});
