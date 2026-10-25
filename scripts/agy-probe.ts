import { loadConfig } from '../server/config.js';
import { AgyProvider } from '../server/provider.js';
const config = loadConfig();
const provider = new AgyProvider(config);
const result = await provider.generate('Return {"ok":true}. Do not use tools or access files.', {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
  additionalProperties: false,
});
process.stdout.write(
  JSON.stringify({ platform: process.platform, verifiedAt: new Date().toISOString(), ...result }, null, 2) +
    '\n',
);
