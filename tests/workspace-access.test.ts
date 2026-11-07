import { describe, it, expect, vi } from 'vitest';
import { MemoryStore, newJob } from '../server/repositories';
import {
  workspaceActor,
  authorizeWorkspace,
  activityView,
  type WorkspaceActor,
} from '../server/workspace-access';
import { RoutineService, OperationService } from '../server/services';
import { DemoCalendar } from '../server/google';
import { ChatRequests } from '../server/chat-requests';
import type { AssistantService } from '../server/provider';
import { initialConversationState } from '../shared/chat-controls';

async function setup() {
  const store = new MemoryStore(),
    calendar = new DemoCalendar();
  const member = {
    id: crypto.randomUUID(),
    email: 'editor@example.org',
    role: 'editor' as const,
    createdAt: new Date().toISOString(),
  };
  await store.set('workspace.members', [member]);
  const actor: WorkspaceActor = { email: member.email, memberId: member.id, role: member.role };
  const operations = new OperationService(store, calendar, new RoutineService(store));
  return { store, actor, operations };
}
describe('workspace permissions beyond HTTP', () => {
  it('does not expose raw Telegram or assistant transport payloads to invited members', () => {
    const job = newJob('telegram_incoming', 'fixture-incoming', {
      telegram: { update: { internal: 'private transport data' } },
    });
    const visible = activityView([], [job], {
      email: 'guest@example.org',
      memberId: 'guest',
      role: 'viewer',
    });
    expect(visible.jobs[0].payload.telegram).toBeUndefined();
    expect(JSON.stringify(visible)).not.toContain('private transport data');
  });
  it('defaults to denial for new routes and keeps owner-only tools inaccessible', () => {
    for (const role of ['viewer', 'editor'] as const)
      for (const route of [
        '/api/agy/console/input',
        '/api/settings/telegram',
        '/api/workspace/members',
        '/api/operations/id/approve',
        '/api/new-module',
      ])
        expect(() => authorizeWorkspace({ email: 'guest@example.org', role }, 'POST', route)).toThrow();
    expect(() =>
      authorizeWorkspace({ email: 'guest@example.org', role: 'viewer' }, 'GET', '/api/planner'),
    ).not.toThrow();
  });
  it('records the initiating account and cancels queued writes after revocation', async () => {
    const h = await setup();
    const operation = await workspaceActor.run(h.actor, () =>
      h.operations.submit(
        { kind: 'memory.create', record: { kind: 'idea', title: 'Shared idea', body: 'A shared plan' } },
        'member-test-operation',
      ),
    );
    expect(operation.actor).toEqual(h.actor);
    await h.store.set('workspace.members', []);
    await expect(h.operations.execute(operation.id)).rejects.toMatchObject({ status: 403 });
    expect((await h.store.operation(operation.id))?.status).toBe('failed');
  });
  it('does not start a revoked guest assistant request', async () => {
    const h = await setup(),
      chat = vi.fn();
    const requests = new ChatRequests(h.store, { chat } as unknown as AssistantService);
    const id = crypto.randomUUID();
    await requests.submit(id, 'List the routines', undefined, h.actor);
    await h.store.set('workspace.members', []);
    await requests.tick();
    expect(chat).not.toHaveBeenCalled();
    expect((await requests.inspect(id)).status).toBe('failed');
  });
  it('scrubs guest request results and queued payloads when the owner forgets an exchange', async () => {
    const h = await setup(),
      id = crypto.randomUUID();
    const key = `chat:web:member:${h.actor.memberId}:${id}`;
    await h.store.set('assistant.request:' + id, {
      conversationKey: key,
      status: 'succeeded',
      result: { message: 'Private reply' },
    });
    await h.store.appendConversation(key, 'Shared request', 'Private reply');
    const row = (await h.store.conversation())[0];
    await h.store.changeConversation({
      expectedVersion: initialConversationState.version,
      mode: 'forget',
      messageId: row.id,
    });
    expect(await h.store.get('assistant.request:' + id)).toMatchObject({
      status: 'failed',
      error: 'This reply was removed from local chat history.',
    });
  });
});
