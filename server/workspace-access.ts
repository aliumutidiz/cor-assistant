import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Store } from './repositories.js';
import { AppError } from './errors.js';
import { redactCredentials } from '../shared/sensitive.js';
import type { Job, Operation } from '../shared/contracts.js';
export type WorkspaceActor = { email: string; role: 'owner' | 'viewer' | 'editor'; memberId?: string };
export type WorkspaceMember = { id: string; email: string; role: 'viewer' | 'editor'; createdAt: string };
export const workspaceActor = new AsyncLocalStorage<WorkspaceActor>();
export function activityView(operations: Operation[], jobs: Job[], actor: WorkspaceActor) {
  if (!actor.memberId) return { operations, jobs };
  const visibleJobs = jobs.map((job) => ({
    ...job,
    payload: {
      routine: job.payload.routine,
      reminder: job.payload.reminder,
      programReminder: job.payload.programReminder,
      taskReminder: job.payload.taskReminder,
      operationId: job.payload.operationId,
    },
  }));
  return JSON.parse(
    JSON.stringify({ operations, jobs: visibleJobs }, (_key, value) =>
      typeof value === 'string' ? redactCredentials(value) : value,
    ),
  ) as { operations: Operation[]; jobs: Job[] };
}
export async function members(store: Store) {
  return (await store.get<WorkspaceMember[]>('workspace.members')) ?? [];
}
export async function resolveActor(
  store: Store,
  owner: string,
  email: string,
): Promise<WorkspaceActor | undefined> {
  email = email.toLowerCase();
  if (owner && email === owner.toLowerCase()) return { email, role: 'owner' };
  const member = (await members(store)).find((item) => item.email === email);
  return member ? { email, role: member.role, memberId: member.id } : undefined;
}
export async function validateActor(store: Store, actor?: WorkspaceActor) {
  if (!actor || actor.role === 'owner') return;
  const member = (await members(store)).find(
    (item) => item.id === actor.memberId && item.email === actor.email,
  );
  if (!member || member.role !== 'editor')
    throw new AppError(403, 'Workspace editing permission is no longer active.');
}
export function authorizeWorkspace(actor: WorkspaceActor, method: string, path: string) {
  if (actor.role === 'owner') return;
  const reads =
    /^\/api\/(?:session|calendars|events|sharing|resources|routines|reminders|planner|history|progress|memories(?:\/[^/]+(?:\/(?:revisions|export|occurrences))?)?|brain\/export|chat\/(?:history|context|snapshot|export|requests\/[^/]+)|agy\/status|voice\/status)$/;
  if (['GET', 'HEAD'].includes(method) && reads.test(path)) return;
  if (method === 'POST' && path === '/api/auth/logout') return;
  if (
    actor.role === 'editor' &&
    method === 'POST' &&
    [
      '/api/operations',
      '/api/chat',
      '/api/chat/requests',
      '/api/sync',
      '/api/listen',
      '/api/speak',
      '/api/speak/stream',
    ].includes(path)
  )
    return;
  throw new AppError(
    403,
    actor.role === 'viewer'
      ? 'This invitation allows viewing only.'
      : 'Only the workspace owner can manage connections, access, conversation resets and sensitive approvals.',
  );
}
export function workspaceRoutes(app: FastifyInstance, store: Store, owner: string) {
  let tail: Promise<unknown> = Promise.resolve();
  app.get('/api/workspace/members', () => members(store));
  app.post('/api/workspace/members', async (req) => {
    const input = z
      .object({
        email: z
          .email()
          .max(254)
          .transform((value) => value.toLowerCase()),
        role: z.enum(['viewer', 'editor']),
      })
      .strict()
      .parse(req.body);
    const task = tail.then(async () => {
      if (input.email === owner.toLowerCase()) throw new AppError(400, 'The owner already has access.');
      const list = await members(store);
      if (list.length >= 10 && !list.some((item) => item.email === input.email))
        throw new AppError(400, 'A personal workspace supports up to ten invited accounts.');
      const old = list.find((item) => item.email === input.email);
      if (old?.role === input.role) return old;
      const member: WorkspaceMember = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
      await store.set('workspace.members', [...list.filter((item) => item.email !== input.email), member]);
      return member;
    });
    tail = task.catch(() => {});
    return task;
  });
  app.delete('/api/workspace/members/:id', async (req) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const task = tail.then(async () => {
      await store.set(
        'workspace.members',
        (await members(store)).filter((item) => item.id !== id),
      );
      return { ok: true };
    });
    tail = task.catch(() => {});
    return task;
  });
}
