import { z } from 'zod';
export const voiceSettings = z
  .object({
    enabled: z.boolean().default(false),
    freeTierConfirmed: z.boolean().default(false),
    voice: z.enum(['Sulafat', 'Kore', 'Charon', 'Aoede', 'Puck']).default('Charon'),
    dailyLimit: z.number().int().min(1).max(200).default(20),
  })
  .strict();
export type VoiceSettings = z.infer<typeof voiceSettings>;
export type VoiceFrame = { type: 'audio'; format: 'pcm' | 'wav'; data: string };
export type VoiceStatus = VoiceSettings & {
  configured: boolean;
  used: number;
  day: string;
  speechInput: boolean;
};
