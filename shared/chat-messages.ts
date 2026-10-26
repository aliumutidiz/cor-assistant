export type ChatMessage = {
  id?: string;
  exchangeId?: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt?: string;
  channel?: 'web' | 'telegram' | 'legacy';
};
export function compareMessages(a: ChatMessage, b: ChatMessage) {
  const at = a.createdAt ? Date.parse(a.createdAt) : NaN,
    bt = b.createdAt ? Date.parse(b.createdAt) : NaN;
  if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at - bt;
  if (a.id && b.id && /^\d+$/.test(a.id) && /^\d+$/.test(b.id))
    return BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0;
  return a.exchangeId && a.exchangeId === b.exchangeId && a.role !== b.role
    ? a.role === 'user'
      ? -1
      : 1
    : 0;
}
/** Merge persisted snapshots with tab-local pending messages; prefer stored rows. */
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const map = new Map<string, ChatMessage>();
  for (const [i, row] of [...current, ...incoming].entries()) {
    const key = row.exchangeId ? row.exchangeId + ':' + row.role : row.id ? 'id:' + row.id : 'local:' + i;
    const previous = map.get(key);
    if (previous?.id && !row.id) continue;
    map.set(key, row);
  }
  return [...map.values()].sort(compareMessages);
}
export function reconcileMessages(current: ChatMessage[], snapshot: ChatMessage[]) {
  if (!snapshot.length) return current.filter((row) => !row.id);
  const first = snapshot[0];
  return mergeMessages(
    current.filter((row) => !row.id || compareMessages(row, first) < 0),
    snapshot,
  );
}
