import { assistantResponse } from '../shared/contracts.js';
import { AppError } from './errors.js';

// Recover only a complete response envelope, never a JSON fragment from prose.
// Nested writes are deliberately rejected; all reads still pass server validation.
export function parseAssistantOutput(output: unknown) {
  const decode = (value: unknown): unknown => {
    if (typeof value !== 'string') return value;
    const source = value.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1');
    try {
      return JSON.parse(source);
    } catch {
      return value;
    }
  };
  let value = decode(output);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const outer = value as Record<string, unknown>;
    if (outer.action === null && outer.read === null && typeof outer.message === 'string') {
      const nested = decode(outer.message);
      if (
        nested &&
        typeof nested === 'object' &&
        !Array.isArray(nested) &&
        'message' in nested &&
        'action' in nested &&
        'read' in nested
      ) {
        if ((nested as Record<string, unknown>).action !== null)
          throw new AppError(502, 'Asistan değişiklik önerisini geçerli biçimde iletmedi. Yeniden deneyin.');
        // Validate the outer envelope too: recovery must not discard unknown fields.
        if (!assistantResponse.safeParse(outer).success)
          throw new AppError(502, 'Asistan geçerli yapılandırılmış yanıt üretmedi.');
        value = nested;
      }
    }
    const envelope = value as Record<string, unknown>;
    if (envelope.read && typeof envelope.read === 'object' && !Array.isArray(envelope.read)) {
      const read = { ...envelope.read } as Record<string, unknown>;
      for (const [alias, field] of [
        ['timeMin', 'from'],
        ['timeMax', 'to'],
      ]) {
        if (!(alias in read)) continue;
        if (field in read && read[field] !== read[alias])
          throw new AppError(502, 'Asistan çelişkili tarih aralıkları iletti.');
        read[field] = read[alias];
        delete read[alias];
      }
      value = { ...envelope, read };
    }
  }
  const parsed = assistantResponse.safeParse(value);
  if (!parsed.success) throw new AppError(502, 'Asistan geçerli yapılandırılmış yanıt üretmedi.');
  return parsed.data;
}
