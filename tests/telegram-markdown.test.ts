import { describe, it, expect } from 'vitest';
import { telegramMarkdown } from '../server/telegram-markdown.js';

describe('Telegram Markdown entities', () => {
  it('renders emphasis, lists, links, code and headings', () => {
    const [result] = telegramMarkdown(
      '# Program\n\n**Yarın** *15.00*\n\n- [Takvim](https://calendar.google.com/)\n- `kod`\n\n~~eski~~',
    );
    expect(result.text).not.toContain('**');
    expect(result.text).toContain('• Takvim');
    for (const type of ['bold', 'italic', 'text_link', 'code', 'strikethrough'])
      expect(result.entities.some((e) => e.type === type)).toBe(true);
    expect(result.entities.find((e) => e.type === 'text_link')?.url).toBe('https://calendar.google.com/');
  });
  it('does not execute HTML, images or unsafe links', () => {
    const [result] = telegramMarkdown(
      '<b>Literal</b> [click](javascript:alert) ![image](https://evil.example/track)',
    );
    expect(result.text).toContain('<b>Literal</b>');
    expect(result.entities).toEqual([]);
    expect(result.text).not.toContain('https://evil');
  });
  it('splits long formatted responses without losing text, surrogate pairs or valid spans', () => {
    const original = '😀Türkçe '.repeat(1200).trimEnd();
    const chunks = telegramMarkdown('**' + original + '**');
    expect(chunks.map((c) => c.text).join('')).toBe(original.trimEnd());
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(3500);
      expect(chunk.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
      for (const e of chunk.entities) {
        expect(e.offset).toBeGreaterThanOrEqual(0);
        expect(e.offset + e.length).toBeLessThanOrEqual(chunk.text.length);
      }
    }
  });
  it('keeps code entities separate from bold and links', () => {
    const [result] = telegramMarkdown('**önce `kod` sonra**');
    const code = result.entities.find((e) => e.type === 'code')!;
    for (const e of result.entities.filter((e) => e.type !== 'code'))
      expect(e.offset + e.length <= code.offset || e.offset >= code.offset + code.length).toBe(true);
  });
});
