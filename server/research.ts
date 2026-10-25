import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Store } from './repositories.js';
import { AppError } from './errors.js';
import { publicUrl, readPublicWeb, webText, readableWebText } from './public-web.js';
import { containsCredential } from './sensitive.js';

export const researchSettings = z
  .object({ enabled: z.boolean(), endpoint: z.string().trim().max(2048) })
  .strict();
function endpointUrl(endpoint: string) {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new AppError(400, 'Geçerli bir SearXNG adresi gerekli.');
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new AppError(400, 'SearXNG kök adresini gir.');
  const loopback = ['127.0.0.1', '[::1]'].includes(url.hostname);
  if (!loopback) publicUrl(endpoint);
  else if (!['http:', 'https:'].includes(url.protocol)) throw new AppError(400, 'HTTP/HTTPS gerekli.');
  return { url, loopback };
}
export class ResearchService {
  private cache = new Map<string, { at: number; result: unknown }>();
  constructor(private store: Store) {}
  async settings() {
    return (
      (await this.store.get<z.infer<typeof researchSettings>>('research.settings')) ?? {
        enabled: false,
        endpoint: '',
      }
    );
  }
  async configure(value: unknown) {
    const settings = researchSettings.parse(value);
    if (settings.endpoint) endpointUrl(settings.endpoint);
    if (settings.enabled && !settings.endpoint) throw new AppError(400, 'SearXNG adresi gerekli.');
    this.cache.clear();
    await this.store.set('research.settings', settings);
    return settings;
  }
  async search(query: string, signal?: AbortSignal) {
    query = z.string().trim().min(2).max(200).parse(query);
    if (containsCredential(query)) throw new AppError(400, 'Bağlantı sırları internette aranamaz.');
    const settings = await this.settings();
    if (!settings.enabled)
      throw new AppError(409, 'İnternet araştırması Ayarlar > Araştırma bölümünden kurulmalı.');
    const key = settings.endpoint + query,
      cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < 15 * 60000) return cached.result;
    const { url, loopback } = endpointUrl(settings.endpoint);
    url.pathname = '/search';
    url.search = new URLSearchParams({
      q: query,
      format: 'json',
      language: 'auto',
      safesearch: '1',
    }).toString();
    let text: string;
    if (loopback) {
      // Only an authenticated owner can set this exact search-service origin.
      // Neither the model nor a search result controls its host, path or redirects.
      const response = await fetch(url, {
        redirect: 'error',
        signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]),
      }).catch(() => {
        throw new AppError(502, 'Arama servisine ulaşılamadı.');
      });
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json'))
        throw new AppError(502, 'SearXNG JSON aramasını etkinleştir ve bağlantıyı kontrol et.');
      const reader = response.body!.getReader();
      let size = 0;
      const chunks: Uint8Array[] = [];
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 512000) throw new AppError(413, 'Arama yanıtı sınırı aştı.');
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      text = Buffer.concat(chunks).toString('utf8');
    } else text = (await readPublicWeb(url.href, signal)).text;
    const schema = z.object({
      results: z
        .array(z.object({ title: z.string(), url: z.string(), content: z.string().optional() }))
        .max(1000),
    });
    let decoded: unknown;
    try {
      decoded = JSON.parse(text);
    } catch {
      throw new AppError(502, 'Arama servisi geçerli JSON döndürmedi.');
    }
    const parsed = schema.safeParse(decoded);
    if (!parsed.success) throw new AppError(502, 'Arama yanıtının biçimi doğrulanamadı.');
    const payload = parsed.data;
    const results = payload.results
      .flatMap((row) => {
        try {
          const url = publicUrl(row.url);
          return [
            {
              title: webText(row.title).slice(0, 200),
              url: url.href,
              snippet: webText(row.content ?? '').slice(0, 700),
            },
          ];
        } catch {
          return [];
        }
      })
      .slice(0, 6);
    const result = {
      kind: 'web-search',
      query,
      fetchedAt: new Date().toISOString(),
      results,
      untrusted: true,
      scope: 'Search snippets, not verified full pages.',
    };
    this.cache.set(key, { at: Date.now(), result });
    while (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value!);
    return result;
  }
  async fetch(url: string, signal?: AbortSignal) {
    if (containsCredential(url)) throw new AppError(400, 'Bağlantı sırları içeren adresler okunamaz.');
    if (!(await this.settings()).enabled) throw new AppError(409, 'İnternet araştırması etkin değil.');
    const page = await readPublicWeb(z.string().max(2048).parse(url), signal);
    const text = page.contentType.includes('html') ? readableWebText(page.text) : page.text;
    return {
      kind: 'web-page',
      url: page.url,
      text: text.slice(0, 6000),
      truncated: text.length > 6000,
      untrusted: true,
      fetchedAt: new Date().toISOString(),
    };
  }
}
export function researchRoutes(app: FastifyInstance, service: ResearchService) {
  app.get('/api/settings/research', () => service.settings());
  app.put('/api/settings/research', (req) => service.configure(req.body));
  app.post('/api/settings/research/check', async () => {
    const result = await service.search('C.O.R. personal assistant');
    return { ok: true, result };
  });
}
