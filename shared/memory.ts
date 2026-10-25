import { z } from 'zod';
import { personalProgram, shoppingList, userProfile } from './personal-resources.js';
export function foldMemoryText(value: string) {
  return value.toLocaleLowerCase('tr').normalize('NFD').replace(/\p{M}/gu, '').replaceAll('ı', 'i');
}

export const memoryKind = z.enum(['idea', 'purchase', 'fact', 'task', 'profile', 'program', 'shopping_list']);
export const memoryInput = z
  .object({
    kind: memoryKind,
    title: z.string().trim().min(1).max(300),
    body: z.string().trim().min(1).max(10000),
    summary: z.string().trim().max(1000).default(''),
    tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
    profile: userProfile.optional(),
    program: personalProgram.optional(),
    shopping: shoppingList.optional(),
    occurredAt: z.iso.datetime({ offset: true }).nullable().default(null),
    occurredOn: z.iso.date().nullable().default(null),
    taskState: z.enum(['open', 'done']).optional(),
    remindAt: z.iso.datetime({ offset: true }).nullable().optional(),
    amount: z
      .string()
      .regex(/^\d{1,12}(?:\.\d{1,2})?$/)
      .nullable()
      .default(null),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable()
      .default(null),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (new TextEncoder().encode(JSON.stringify(v)).length > 40000)
      ctx.addIssue({
        code: 'custom',
        message: 'A personal record must fit within 40000 UTF-8 bytes. Split large records.',
      });
    if (v.kind === 'profile' && v.body.length > 1000)
      ctx.addIssue({
        code: 'custom',
        path: ['body'],
        message: 'Keep each profile statement within 1000 characters; split unrelated facts.',
      });
    for (const [field, kind] of [
      ['profile', 'profile'],
      ['program', 'program'],
      ['shopping', 'shopping_list'],
    ] as const) {
      if ((v.kind === kind) !== (v[field] !== undefined))
        ctx.addIssue({ code: 'custom', path: [field], message: `Required only for ${kind} records.` });
    }
    if (v.kind !== 'task' && (v.taskState !== undefined || v.remindAt != null))
      ctx.addIssue({ code: 'custom', message: 'Only tasks may have task state or reminder time.' });
    if (v.kind !== 'purchase' && (v.amount !== null || v.currency !== null))
      ctx.addIssue({ code: 'custom', message: 'Only purchases may have an amount or currency.' });
    if ((v.amount === null) !== (v.currency === null))
      ctx.addIssue({ code: 'custom', message: 'Amount and currency must be provided together.' });
  });
export const memoryOperation = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('memory.create'), record: memoryInput }).strict(),
  z
    .object({ kind: z.literal('memory.complete'), memoryId: z.uuid(), version: z.number().int().positive() })
    .strict(),
  z
    .object({
      kind: z.literal('memory.update'),
      memoryId: z.uuid(),
      version: z.number().int().positive(),
      record: memoryInput,
    })
    .strict(),
  z
    .object({ kind: z.literal('memory.archive'), memoryId: z.uuid(), version: z.number().int().positive() })
    .strict(),
  z
    .object({ kind: z.literal('memory.restore'), memoryId: z.uuid(), version: z.number().int().positive() })
    .strict(),
]);
export type MemoryAction = z.infer<typeof memoryOperation>;
export type MemoryInput = z.infer<typeof memoryInput>;
export type MemoryRecord = MemoryInput & {
  id: string;
  seq: string;
  version: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  source: { channel: 'web' | 'chat' | 'telegram'; text: string };
  timeZone: string;
};
export function resourceSearchText(record: Pick<MemoryInput, 'shopping' | 'program'>) {
  return [
    ...(record.shopping?.items.map((item) =>
      [item.name, item.quantity, item.category, item.note].join(' '),
    ) ?? []),
    ...(record.program?.entries.map((entry) => [entry.title, entry.location].join(' ')) ?? []),
  ].join(' ');
}
export const memorySearch = z
  .object({
    query: z.string().trim().max(200).default(''),
    kind: memoryKind.optional(),
    before: z
      .string()
      .regex(/^[1-9]\d{0,18}$/)
      .refine((v) => BigInt(v) <= 9223372036854775807n)
      .optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    archived: z.boolean().default(false),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();
export type MemorySearch = z.infer<typeof memorySearch>;
export type MemoryPage = { items: MemoryRecord[]; next?: string };
