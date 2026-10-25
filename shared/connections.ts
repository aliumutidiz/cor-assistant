import { z } from 'zod';
export const telegramSettings = z
  .object({
    enabled: z.boolean(),
    ownerId: z.number().int().positive().safe().nullable(),
    chatIds: z.array(z.number().int().negative().safe()).max(20),
    notificationChatId: z.number().int().negative().safe().nullable(),
    token: z.string().trim().max(200).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.chatIds).size !== value.chatIds.length)
      ctx.addIssue({ code: 'custom', message: 'Group IDs must be distinct.' });
    if (value.notificationChatId !== null && !value.chatIds.includes(value.notificationChatId))
      ctx.addIssue({ code: 'custom', message: 'Notification group must be allowed.' });
    if (value.chatIds.length && value.notificationChatId === null)
      ctx.addIssue({ code: 'custom', message: 'Choose a notification group when group mode is enabled.' });
    if (value.enabled && !value.ownerId) ctx.addIssue({ code: 'custom', message: 'Owner ID is required.' });
    if (value.token && !/^\d{5,15}:[A-Za-z0-9_-]{20,}$/.test(value.token))
      ctx.addIssue({ code: 'custom', message: 'Invalid bot token.' });
  });
export type TelegramSettings = z.infer<typeof telegramSettings>;
export type TelegramSettingsView = Omit<TelegramSettings, 'token'> & {
  tokenConfigured: boolean;
  revision: string;
};
