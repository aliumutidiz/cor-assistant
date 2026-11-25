import type { Operation } from '../shared/contracts';
const phase: Record<string, number> = {
  awaiting_approval: 0,
  queued: 1,
  running: 2,
  succeeded: 3,
  failed: 3,
  unknown: 3,
  canceled: 3,
};
/** Late history reads must not replace a newer live acknowledgement or terminal result. */
export function mergeOperationHistory(previous: Operation[], incoming: Operation[], limit = 200) {
  const merged = new Map(previous.map((op) => [op.id, op]));
  for (const op of incoming) {
    const current = merged.get(op.id);
    const at = Date.parse(op.updatedAt ?? op.createdAt) || 0;
    const previousAt = current ? Date.parse(current.updatedAt ?? current.createdAt) || 0 : 0;
    if (
      !current ||
      at > previousAt ||
      (at === previousAt && (phase[op.status] ?? 0) >= (phase[current.status] ?? 0))
    )
      merged.set(op.id, op);
  }
  return [...merged.values()]
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || b.id.localeCompare(a.id))
    .slice(0, limit);
}
