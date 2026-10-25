import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { AppError } from './errors.js';

const blocked = new BlockList();
for (const [ip, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(ip, bits, 'ipv4');
const global6 = new BlockList();
global6.addSubnet('2000::', 3, 'ipv6');
const blocked6 = new BlockList();
for (const [ip, bits] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
] as const)
  blocked6.addSubnet(ip, bits, 'ipv6');
export function isPublicAddress(ip: string) {
  return isIP(ip) === 4
    ? !blocked.check(ip, 'ipv4')
    : isIP(ip) === 6 && global6.check(ip, 'ipv6') && !blocked6.check(ip, 'ipv6');
}
export function publicUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(400, 'Geçerli bir HTTP/HTTPS adresi gerekli.');
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !['80', '443'].includes(url.port))
  )
    throw new AppError(400, 'Yalnızca herkese açık HTTP/HTTPS sayfaları okunabilir.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    (isIP(host) && !isPublicAddress(host))
  )
    throw new AppError(400, 'Özel ağ adresleri okunamaz.');
  return url;
}
export async function readPublicWeb(
  value: string,
  signal?: AbortSignal,
  redirects = 0,
): Promise<{ url: string; contentType: string; text: string }> {
  const url = publicUrl(value),
    host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await lookup(host, { all: true }).catch(() => {
        throw new AppError(502, 'Kaynak adresi çözümlenemedi.');
      });
  if (!addresses.length || addresses.some((row) => !isPublicAddress(row.address)))
    throw new AppError(400, 'Özel ağ adresleri okunamaz.');
  const chosen = addresses[0];
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        method: 'GET',
        signal: AbortSignal.any([AbortSignal.timeout(12000), ...(signal ? [signal] : [])]),
        headers: {
          'User-Agent': 'COR/0.1 (personal research)',
          Accept: 'text/markdown,text/html;q=0.9,text/plain;q=0.8,application/json;q=0.5',
          'Accept-Encoding': 'identity',
        },
        // DNS answers are checked and then pinned for this connection; redirects
        // must go through the same policy, avoiding DNS rebinding/TOCTOU.
        lookup: (_host, options, callback) => {
          if (options.all) callback(null, [{ address: chosen.address, family: chosen.family }]);
          else callback(null, chosen.address, chosen.family);
        },
      },
      (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
          response.resume();
          if (redirects >= 3 || !response.headers.location) {
            reject(new AppError(502, 'Sayfa çok fazla yönlendirme döndürdü.'));
            return;
          }
          readPublicWeb(new URL(response.headers.location, url).href, signal, redirects + 1).then(
            resolve,
            reject,
          );
          return;
        }
        const contentType = response.headers['content-type'] ?? '';
        if (
          (response.statusCode ?? 500) >= 400 ||
          !/^(text\/(html|plain|markdown)|application\/json)/i.test(contentType)
        ) {
          response.resume();
          reject(new AppError(502, 'Sayfa okunabilir bir metin döndürmedi.'));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 512000) {
            response.destroy();
            reject(new AppError(413, 'Sayfa okuma sınırını aştı.'));
          } else chunks.push(chunk);
        });
        response.on('error', () => reject(new AppError(502, 'Sayfa okunamadı.')));
        response.on('end', () =>
          resolve({ url: url.href, contentType, text: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    request.on('error', () => reject(new AppError(502, 'İnternet kaynağına ulaşılamadı.')));
    request.end();
  });
}
export function webText(html: string) {
  return html
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
export function readableWebText(html: string) {
  // Prefer semantic content before applying the text budget. Menus in long
  // documentation sites must not crowd the actual article out of the context.
  const clean = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  const article = clean.match(/<article\b[^>]*>([\s\S]*?)<\/article\s*>/i)?.[1];
  const main = clean.match(/<main\b[^>]*>([\s\S]*?)<\/main\s*>/i)?.[1];
  const content = (article ?? main ?? clean).replace(/<(nav|aside|footer)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  const title = webText(clean.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] ?? '').slice(0, 200);
  return (title ? title + '\n\n' : '') + webText(content);
}
