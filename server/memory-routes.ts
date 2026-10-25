import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Store } from './repositories.js';
import { PersonalMemory } from './memory-service.js';
import { memoryKind, memorySearch } from '../shared/memory.js';
import { Readable } from 'node:stream';

export function memoryRoutes(app: FastifyInstance, store: Store) {
  const service = new PersonalMemory(store);
  app.get('/api/brain/export', async (_req, reply) => {
    // Stream bounded pages rather than accumulating years of records in RAM.
    // Concurrent edits can change later pages; this is not a database snapshot.
    async function* content() {
      yield JSON.stringify({
        format: 'cor.personal-memory',
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        scope:
          'Current personal records including archived entries. No credentials, chat history, revisions or application backup.',
      }).slice(0, -1) + ',"records":[';
      let comma = '';
      const seen = new Set<string>();
      for (const archived of [false, true]) {
        let before: string | undefined;
        do {
          const page = await service.search({ archived, before, limit: 50 });
          for (const record of page.items) {
            if (seen.has(record.id)) continue;
            seen.add(record.id);
            yield comma + JSON.stringify(record);
            comma = ',';
          }
          before = page.next;
        } while (before);
      }
      yield ']}';
    }
    return reply
      .type('application/json; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="cor-memory.json"')
      .header('Cache-Control', 'no-store')
      .send(Readable.from(content(), { objectMode: false, highWaterMark: 16384 }));
  });
  app.get('/api/memories', async (req) => {
    const query = z
      .object({
        query: z.string().max(200).optional(),
        kind: memoryKind.optional(),
        taskState: z.enum(['open', 'done']).optional(),
        before: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        archived: z.enum(['true', 'false']).optional(),
      })
      .strict()
      .parse(req.query);
    return service.search(memorySearch.parse({ ...query, archived: query.archived === 'true' }));
  });
  app.get('/api/memories/:id', async (req) =>
    service.inspect(z.object({ id: z.uuid() }).parse(req.params).id),
  );
  app.get('/api/memories/:id/revisions', async (req) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    await service.inspect(id);
    return store.memoryHistory(id);
  });
  app.get('/api/memories/:id/export', async (req, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const record = await service.inspect(id);
    const content = [
      `# ${record.title}`,
      '',
      `Type: ${record.kind}`,
      `Recorded: ${record.createdAt}`,
      `Occurred: ${record.occurredAt ?? 'Unknown'}`,
      `Occurrence day: ${record.occurredOn ?? 'Unknown'}`,
      `Version: ${record.version}`,
      `Archived: ${record.archived}`,
      ...(record.kind === 'task'
        ? [`Task state: ${record.taskState ?? 'open'}`, `Remind at: ${record.remindAt ?? 'Not scheduled'}`]
        : []),
      ...(record.amount !== null ? [`Amount: ${record.amount} ${record.currency}`] : []),
      `Tags: ${record.tags.join(', ')}`,
      '',
      record.body,
      '',
      '## Summary',
      '',
      record.summary,
      '',
      '## Source',
      '',
      `Channel: ${record.source.channel}`,
      '',
      record.source.text,
      '',
    ].join('\n');
    return reply
      .type('text/markdown; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="cor-record-${id}.md"`)
      .send(content);
  });
}
