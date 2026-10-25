import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { bootstrap, loadSkill } from '../server/skills.js';
import { scopedResponseSchema } from '../server/provider.js';

// Synthetic provider evaluation payload, never a live operation request.
const fixture = {
  prompt:
    (await bootstrap()) +
    '\n\n' +
    (await loadSkill('routine-management')) +
    '\nAUTHORITATIVE_CONTEXT: ' +
    JSON.stringify({
      now: '2026-10-19T18:00:00+03:00',
      timeZone: 'Europe/Istanbul',
      calendars: [{ id: 'primary', summary: 'Synthetic test calendar' }],
      routines: [],
      channels: { telegram: true, voice: false },
    }) +
    '\nUSER_REQUEST: ' +
    JSON.stringify(
      'Her gün sabah 7 için Su iç hatırlatması oluştur, ama şimdilik etkinleştirme. Henüz bir işlem uygulanmadı; yalnızca öneriyi döndür.',
    ),
  schema: z.toJSONSchema(scopedResponseSchema('routine-management')),
};
await writeFile(new URL('../.runtime/agy-fixture.json', import.meta.url), JSON.stringify(fixture));
console.log('Synthetic English-skill/Turkish-request fixture prepared; no model call made.');
