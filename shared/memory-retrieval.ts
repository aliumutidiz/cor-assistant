import { foldMemoryText, resourceSearchText, type MemoryRecord } from './memory.js';

const stop = new Set(
  'bana benim beni bizim bunu buna bunlar bunun şunu şuna şöyle böyle daha kadar hangi nasıl neden için sonra önce bugün yarın hafta lütfen acaba istiyorum söyler misin şey bir olan olarak şimdi saat her tüm tekrar hakkında hatırla hatırlıyor musun kaydet oluştur güncelle'
    .split(' ')
    .map(foldMemoryText),
);
export function memoryTerms(request: string) {
  return [...new Set((request.match(/[\p{L}\p{N}]{3,}/gu) ?? []).map(foldMemoryText))]
    .filter((term) => !stop.has(term))
    .slice(0, 12);
}
export function memoryScore(record: MemoryRecord, terms: string[]) {
  const title = foldMemoryText(record.title),
    tags = foldMemoryText(record.tags.join(' '));
  const summary = foldMemoryText(record.summary),
    body = foldMemoryText(record.body + ' ' + resourceSearchText(record));
  return terms.reduce(
    (score, term) =>
      score +
      (title.includes(term) ? 8 : 0) +
      (tags.includes(term) ? 5 : 0) +
      (summary.includes(term) ? 3 : 0) +
      (body.includes(term) ? 1 : 0),
    0,
  );
}
export function boundedMemoryHints(records: MemoryRecord[], request: string, budget = 4000) {
  const terms = memoryTerms(request);
  const ranked = records
    .map((record) => ({ record, score: memoryScore(record, terms) }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || b.record.updatedAt.localeCompare(a.record.updatedAt));
  const result: {
    id: string;
    version: number;
    kind: MemoryRecord['kind'];
    title: string;
    summary: string;
    source: string;
    recordedAt: string;
    updatedAt: string;
    truncated: boolean;
  }[] = [];
  let used = 2;
  for (const { record: r } of ranked) {
    if (result.length >= 6) break;
    const original = r.summary || r.body;
    const hint = {
      id: r.id,
      version: r.version,
      kind: r.kind,
      title: r.title,
      summary: original.slice(0, 500),
      source: r.source.channel,
      recordedAt: r.createdAt,
      updatedAt: r.updatedAt,
      truncated: original.length > 500,
    };
    const size = JSON.stringify(hint).length + 1;
    if (used + size > budget) continue;
    result.push(hint);
    used += size;
  }
  return result;
}
