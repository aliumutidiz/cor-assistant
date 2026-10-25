import { redactCredentials } from '../shared/sensitive.js';
/** Only data is sanitized. Source records and identifiers remain unchanged in storage. */
export function modelData(value: unknown): string {
  return (
    JSON.stringify(value, (_key, item) => (typeof item === 'string' ? redactCredentials(item) : item)) ??
    'null'
  );
}
export function boundedModelRecords<T>(records: T[], budget: number) {
  const items: T[] = [];
  let bytes = 2;
  for (const record of records) {
    const size = Buffer.byteLength(modelData(record)) + 1;
    if (bytes + size > budget) continue;
    items.push(record);
    bytes += size;
  }
  return { items, total: records.length, truncated: items.length !== records.length };
}
/** Keep complete records, never cut JSON or pretend omitted records are absent. */
export function boundedToolResults(results: unknown[], budget = 48000) {
  let remaining = budget;
  return results.map((value) => {
    const read = value as Record<string, unknown>;
    const rawSize = Buffer.byteLength(modelData(read)) + 1;
    if (rawSize <= remaining) {
      remaining -= rawSize;
      return read;
    }
    if (Array.isArray(read.data)) {
      const metadata = {
        ...read,
        data: [],
        complete: false,
        truncated: true,
        totalItems: read.data.length,
        policy:
          'Partial tool result. Omitted records are unknown, not absent; narrow the query before making completeness claims.',
      };
      const available = Math.max(0, remaining - Buffer.byteLength(modelData(metadata)) - 100);
      const bounded = boundedModelRecords(read.data, available);
      const result = { ...metadata, data: bounded.items };
      remaining = Math.max(0, remaining - Buffer.byteLength(modelData(result)));
      return result;
    }
    remaining = Math.max(0, remaining - 300);
    return {
      kind: read.kind,
      data: null,
      complete: false,
      truncated: true,
      policy:
        'Tool result exceeds the context budget. Its content was omitted. Narrow the query; do not infer absence or act on omitted identifiers.',
    };
  });
}
