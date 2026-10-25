import type { ConversationMessage } from './repositories.js';
import { memoryTerms } from '../shared/memory-retrieval.js';
import { foldMemoryText } from '../shared/memory.js';

// Archival storage and model context are independent. No extra model call is used.
export function conversationContext(
  rows: Pick<ConversationMessage, 'role' | 'text'>[],
  request: string,
  budget = 48000,
) {
  const terms = memoryTerms(request);
  const recent = rows.slice(-32);
  const relevant = rows
    .slice(0, -32)
    .map((row, index) => ({
      row,
      index,
      score: terms.filter((term) => foldMemoryText(row.text).includes(term)).length,
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, 8)
    .sort((a, b) => a.index - b.index)
    .map((row) => row.row);
  let remaining = budget;
  const selected: Pick<ConversationMessage, 'role' | 'text'>[] = [];
  for (const row of [...relevant, ...recent].reverse()) {
    if (remaining <= 0) break;
    const text = row.text.slice(0, Math.min(6000, remaining));
    selected.unshift({ role: row.role, text });
    remaining -= text.length;
  }
  return selected;
}
