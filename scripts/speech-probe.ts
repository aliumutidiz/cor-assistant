import { readFile, stat } from 'node:fs/promises';
import { loadConfig } from '../server/config.js';
import { LocalSpeechTranscriber } from '../server/speech.js';
const file = process.argv[2];
if (!file) throw new Error('Provide a local voice file: npm run speech:probe -- recording.ogg');
if ((await stat(file)).size > 8 * 1024 * 1024) throw new Error('Voice fixture must be at most 8 MB');
const text = await new LocalSpeechTranscriber(loadConfig()).transcribe(await readFile(file));
process.stdout.write(
  JSON.stringify({ text, provider: 'local-faster-whisper', paidApiUsed: false }, null, 2) + '\n',
);
