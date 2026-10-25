import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import type { TelegramEntity } from '../shared/contracts.js';

type Node = {
  type: string;
  value?: string;
  url?: string;
  alt?: string;
  identifier?: string;
  ordered?: boolean;
  start?: number | null;
  checked?: boolean | null;
  children?: Node[];
};

// Telegram entities render Markdown without feeding model text into Telegram's
// HTML/Markdown parser. Offsets and chunk boundaries are measured in UTF-16.
export function telegramMarkdown(markdown: string) {
  const root = fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }) as Node;
  let text = '';
  const entities: TelegramEntity[] = [];
  const definitions = new Map<string, string>();
  const collect = (node: Node) => {
    if (node.type === 'definition' && node.identifier && node.url)
      definitions.set(node.identifier.toUpperCase(), node.url);
    node.children?.forEach(collect);
  };
  collect(root);
  const wrap = (type: TelegramEntity['type'], render: () => void, url?: string) => {
    const offset = text.length;
    render();
    if (text.length > offset)
      entities.push({ type, offset, length: text.length - offset, ...(url ? { url } : {}) });
  };
  const safeUrl = (url?: string) => {
    try {
      const parsed = new URL(url!);
      return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password
        ? parsed.href
        : undefined;
    } catch {
      return undefined;
    }
  };
  const visit = (node: Node) => {
    const children = () => node.children?.forEach(visit);
    switch (node.type) {
      case 'root':
        children();
        break;
      case 'text':
      case 'html':
        text += node.value ?? '';
        break;
      case 'strong':
        wrap('bold', children);
        break;
      case 'emphasis':
        wrap('italic', children);
        break;
      case 'delete':
        wrap('strikethrough', children);
        break;
      case 'inlineCode':
        wrap('code', () => {
          text += node.value ?? '';
        });
        break;
      case 'code':
        wrap('pre', () => {
          text += node.value ?? '';
        });
        text += '\n\n';
        break;
      case 'heading':
        wrap('bold', children);
        text += '\n\n';
        break;
      case 'paragraph':
        children();
        text += '\n\n';
        break;
      case 'break':
        text += '\n';
        break;
      case 'thematicBreak':
        text += '—\n\n';
        break;
      case 'link':
      case 'linkReference': {
        const url = safeUrl(node.url ?? definitions.get((node.identifier ?? '').toUpperCase()));
        if (url) wrap('text_link', children, url);
        else children();
        break;
      }
      case 'image':
      case 'imageReference':
        text += node.alt ?? '';
        break;
      case 'definition':
        break;
      case 'list':
        node.children?.forEach((item, i) => {
          text += node.ordered ? `${(node.start ?? 1) + i}. ` : '• ';
          if (item.checked != null) text += item.checked ? '☑ ' : '☐ ';
          visit(item);
        });
        text += '\n';
        break;
      case 'tableRow':
        node.children?.forEach((cell, i) => {
          if (i) text += ' | ';
          visit(cell);
        });
        text += '\n';
        break;
      default:
        children();
    }
  };
  visit(root);
  text = text.trimEnd();
  // Telegram forbids any other entity from overlapping code/pre entities.
  const code = entities.filter((e) => e.type === 'code' || e.type === 'pre');
  const compatible = entities.flatMap((entity) => {
    if (entity.type === 'code' || entity.type === 'pre') return [entity];
    let ranges = [{ start: entity.offset, end: entity.offset + entity.length }];
    for (const literal of code)
      ranges = ranges.flatMap(({ start, end }) => {
        const left = literal.offset,
          right = left + literal.length;
        if (right <= start || left >= end) return [{ start, end }];
        return [
          ...(start < left ? [{ start, end: left }] : []),
          ...(end > right ? [{ start: right, end }] : []),
        ];
      });
    return ranges.map(({ start, end }) => ({ ...entity, offset: start, length: end - start }));
  });
  const chunks: { text: string; entities: TelegramEntity[] }[] = [];
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(offset + 3500, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    const spans = compatible
      .flatMap((entity) => {
        const start = Math.max(entity.offset, offset),
          stop = Math.min(entity.offset + entity.length, end);
        return stop > start ? [{ ...entity, offset: start - offset, length: stop - start }] : [];
      })
      .sort((a, b) => a.offset - b.offset || b.length - a.length);
    chunks.push({ text: text.slice(offset, end), entities: spans });
    offset = end;
  }
  return chunks;
}
