import type { Store } from './repositories.js';
import { newJob } from './repositories.js';
import { programAvailability } from './program-availability.js';
import type { Job } from '../shared/contracts.js';

export class ProgramNotifications {
  private lastScan = 0;
  constructor(private store: Store) {}
  async schedule(now = Date.now()) {
    if (now - this.lastScan < 30000) return;
    this.lastScan = now;
    const data = await programAvailability(
      this.store,
      new Date(now - 15 * 60000).toISOString(),
      new Date(now + 86400000 + 60000).toISOString(),
    );
    const records = new Map<string, Awaited<ReturnType<Store['memory']>>>();
    for (const item of data.occurrences) {
      if (item.notifyMinutesBefore === undefined || item.status === 'done') continue;
      const stamp = Date.parse(item.start) - item.notifyMinutesBefore * 60000;
      if (stamp > now || stamp < now - 15 * 60000) continue;
      if (!records.has(item.programId)) records.set(item.programId, await this.store.memory(item.programId));
      const record = records.get(item.programId);
      if (!record?.program) continue;
      const quiet = record.program.quietHours;
      const hour = Number(
        new Intl.DateTimeFormat('en', { timeZone: item.timeZone, hour: 'numeric', hourCycle: 'h23' }).format(
          new Date(stamp),
        ),
      );
      if (
        quiet &&
        (quiet.start < quiet.end
          ? hour >= quiet.start && hour < quiet.end
          : quiet.start > quiet.end && (hour >= quiet.start || hour < quiet.end))
      )
        continue;
      const notifyAt = new Date(stamp).toISOString();
      await this.store.enqueue(
        newJob(
          'routine',
          `program:${item.programId}:${item.entryId}:${item.originalDay}:${notifyAt}`,
          {
            programReminder: {
              memoryId: record.id,
              version: record.version,
              entryId: item.entryId,
              originalDay: item.originalDay,
              start: item.start,
              notifyAt,
            },
          },
          notifyAt,
        ),
      );
    }
  }
  async current(payload: NonNullable<Job['payload']['programReminder']>) {
    const record = await this.store.memory(payload.memoryId);
    if (
      !record ||
      record.archived ||
      !record.program?.enabled ||
      Date.now() - Date.parse(payload.notifyAt) > 15 * 60000
    )
      return;
    const result = await programAvailability(
      this.store,
      payload.start,
      new Date(Date.parse(payload.start) + 60000).toISOString(),
    );
    const occurrence = result.occurrences.find(
      (item) =>
        item.programId === record.id &&
        item.entryId === payload.entryId &&
        item.originalDay === payload.originalDay &&
        item.start === payload.start &&
        item.status !== 'done',
    );
    if (
      !occurrence ||
      occurrence.notifyMinutesBefore === undefined ||
      Date.parse(occurrence.start) - occurrence.notifyMinutesBefore * 60000 !== Date.parse(payload.notifyAt)
    )
      return;
    const quiet = record.program.quietHours;
    for (const instant of [Date.parse(payload.notifyAt), Date.now()]) {
      const hour = Number(
        new Intl.DateTimeFormat('en', {
          timeZone: occurrence.timeZone,
          hour: 'numeric',
          hourCycle: 'h23',
        }).format(new Date(instant)),
      );
      if (
        quiet &&
        (quiet.start < quiet.end
          ? hour >= quiet.start && hour < quiet.end
          : quiet.start > quiet.end && (hour >= quiet.start || hour < quiet.end))
      )
        return;
    }
    return occurrence;
  }
}
