import { Plus, X } from '@phosphor-icons/react';
import type { MemoryInput, MemoryRecord } from '../shared/memory';
import { programOccurrences } from '../shared/personal-resources';
import { dateKey } from '../shared/time';

export const memoryLabels = {
  idea: 'Idea',
  purchase: 'Purchase',
  fact: 'Personal fact',
  task: 'Task',
  profile: 'Owner profile',
  program: 'Program',
  shopping_list: 'Shopping list',
};
export type ResourceData = Pick<MemoryInput, 'profile' | 'program' | 'shopping'>;
export function resourceDefaults(kind: MemoryInput['kind'], zone: string): ResourceData {
  if (kind === 'profile') return { profile: { category: 'preference', validUntil: null } };
  if (kind === 'program')
    return {
      program: {
        timeZone: zone,
        enabled: true,
        from: null,
        until: null,
        excludedDates: [],
        entries: [
          {
            id: crypto.randomUUID(),
            title: '',
            frequency: 'weekly',
            days: [1],
            start: '09:00',
            end: '10:00',
            location: '',
          },
        ],
      },
    };
  if (kind === 'shopping_list') return { shopping: { items: [] } };
  return {};
}
export function ResourceFields({
  value,
  onChange,
}: {
  value: ResourceData;
  onChange: (value: ResourceData) => void;
}) {
  const profile = value.profile,
    program = value.program,
    shopping = value.shopping;
  return (
    <>
      {profile && (
        <fieldset className="resource-fields">
          <legend>Profile detail</legend>
          <p className="muted small">
            Add a short fact about yourself. C.O.R. retrieves it for relevant conversations. It cannot change
            security or connection permissions.
          </p>
          <label>
            Category
            <select
              value={profile.category}
              onChange={(e) =>
                onChange({ profile: { ...profile, category: e.target.value as typeof profile.category } })
              }
            >
              <option value="identity">About me</option>
              <option value="preference">Preference</option>
              <option value="priority">Priority</option>
              <option value="boundary">Personal limit</option>
            </select>
          </label>
          <label>
            Valid until (optional)
            <input
              type="date"
              value={profile.validUntil ?? ''}
              onChange={(e) => onChange({ profile: { ...profile, validUntil: e.target.value || null } })}
            />
          </label>
        </fieldset>
      )}
      {program && (
        <fieldset className="resource-fields">
          <legend>Recurring program</legend>
          <p className="muted small">
            Programs do not create Google events or notifications. Weeks start on Monday; missing dates are
            skipped.
          </p>
          <label>
            <input
              type="checkbox"
              checked={program.enabled}
              onChange={(e) => onChange({ program: { ...program, enabled: e.target.checked } })}
            />{' '}
            Program active
          </label>
          <label>
            Time zone
            <input
              required
              value={program.timeZone}
              onChange={(e) => onChange({ program: { ...program, timeZone: e.target.value } })}
            />
          </label>
          <div className="form-grid">
            <label>
              Start
              <input
                type="date"
                value={program.from ?? ''}
                onChange={(e) => onChange({ program: { ...program, from: e.target.value || null } })}
              />
            </label>
            <label>
              End
              <input
                type="date"
                value={program.until ?? ''}
                onChange={(e) => onChange({ program: { ...program, until: e.target.value || null } })}
              />
            </label>
          </div>
          {program.entries.map((entry) => {
            const update = (patch: Partial<typeof entry>) =>
              onChange({
                program: {
                  ...program,
                  entries: program.entries.map((item) =>
                    item.id === entry.id ? { ...entry, ...patch } : item,
                  ),
                },
              });
            return (
              <div className="resource-entry" key={entry.id}>
                <label>
                  Activity / class
                  <input
                    required
                    maxLength={200}
                    value={entry.title}
                    onChange={(e) => update({ title: e.target.value })}
                  />
                </label>
                <label>
                  Repeat
                  <select
                    value={entry.frequency}
                    onChange={(e) =>
                      update({ frequency: e.target.value as typeof entry.frequency, days: [1] })
                    }
                  >
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </label>
                <div className="resource-days" aria-label="Repeat days">
                  {Array.from({ length: entry.frequency === 'weekly' ? 7 : 31 }, (_, i) => i + 1).map(
                    (day) => (
                      <label key={day}>
                        <input
                          type="checkbox"
                          checked={entry.days.includes(day)}
                          onChange={(e) =>
                            update({
                              days: e.target.checked
                                ? [...entry.days, day].sort((a, b) => a - b)
                                : entry.days.filter((d) => d !== day),
                            })
                          }
                        />
                        {entry.frequency === 'weekly'
                          ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][day - 1]
                          : day}
                      </label>
                    ),
                  )}
                </div>
                <div className="form-grid">
                  <label>
                    Start time
                    <input
                      required
                      type="time"
                      value={entry.start}
                      onChange={(e) => update({ start: e.target.value })}
                    />
                  </label>
                  <label>
                    End time
                    <input
                      required
                      type="time"
                      value={entry.end}
                      onChange={(e) => update({ end: e.target.value })}
                    />
                  </label>
                </div>
                <label>
                  Location
                  <input
                    maxLength={300}
                    value={entry.location}
                    onChange={(e) => update({ location: e.target.value })}
                  />
                </label>
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    onChange({
                      program: {
                        ...program,
                        entries: program.entries.filter((item) => item.id !== entry.id),
                      },
                    })
                  }
                >
                  <X size={15} /> Remove row
                </button>
              </div>
            );
          })}
          <button
            type="button"
            className="text-button"
            disabled={program.entries.length >= 100}
            onClick={() =>
              onChange({
                program: {
                  ...program,
                  entries: [
                    ...program.entries,
                    {
                      id: crypto.randomUUID(),
                      title: '',
                      frequency: 'weekly',
                      days: [1],
                      start: '09:00',
                      end: '10:00',
                      location: '',
                    },
                  ],
                },
              })
            }
          >
            <Plus size={15} /> Add program entry
          </button>
          <label>
            Excluded dates (comma-separated YYYY-MM-DD)
            <input
              value={program.excludedDates.join(', ')}
              onChange={(e) =>
                onChange({
                  program: {
                    ...program,
                    excludedDates: e.target.value
                      .split(',')
                      .map((day) => day.trim())
                      .filter(Boolean),
                  },
                })
              }
            />
          </label>
        </fieldset>
      )}
      {shopping && (
        <fieldset className="resource-fields">
          <legend>Shopping</legend>
          {shopping.items.map((item) => {
            const update = (patch: Partial<typeof item>) =>
              onChange({
                shopping: {
                  items: shopping.items.map((row) => (row.id === item.id ? { ...row, ...patch } : row)),
                },
              });
            return (
              <div className="resource-entry" key={item.id}>
                <label>
                  Item
                  <input
                    required
                    maxLength={200}
                    value={item.name}
                    onChange={(e) => update({ name: e.target.value })}
                  />
                </label>
                <div className="form-grid">
                  <label>
                    Quantity / unit
                    <input
                      maxLength={60}
                      value={item.quantity}
                      onChange={(e) => update({ quantity: e.target.value })}
                    />
                  </label>
                  <label>
                    Category
                    <input
                      maxLength={80}
                      value={item.category}
                      onChange={(e) => update({ category: e.target.value })}
                    />
                  </label>
                </div>
                <label>
                  Note
                  <input
                    maxLength={500}
                    value={item.note}
                    onChange={(e) => update({ note: e.target.value })}
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={(e) => update({ checked: e.target.checked })}
                  />{' '}
                  Bought
                </label>
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    onChange({ shopping: { items: shopping.items.filter((row) => row.id !== item.id) } })
                  }
                >
                  Remove row
                </button>
              </div>
            );
          })}
          <button
            type="button"
            className="text-button"
            disabled={shopping.items.length >= 200}
            onClick={() =>
              onChange({
                shopping: {
                  items: [
                    ...shopping.items,
                    {
                      id: crypto.randomUUID(),
                      name: '',
                      quantity: '',
                      category: '',
                      note: '',
                      checked: false,
                    },
                  ],
                },
              })
            }
          >
            <Plus size={15} /> Add item
          </button>
        </fieldset>
      )}
    </>
  );
}
export function ResourcePreview({
  record,
  toggle,
  busy = false,
}: {
  record: MemoryRecord;
  toggle?: (id: string) => void;
  busy?: boolean;
}) {
  const shopping = record.shopping,
    program = record.program;
  const today = dateKey(new Date(), program?.timeZone ?? record.timeZone);
  const until = new Date(Date.parse(today + 'T12:00:00Z') + 7 * 86400000).toISOString().slice(0, 10);
  return (
    <>
      {record.profile && (
        <small>
          {record.profile.validUntil
            ? `Valid until ${record.profile.validUntil}`
            : 'Persistent profile detail'}
        </small>
      )}
      {shopping && (
        <div className="shopping-items">
          {busy && <small role="status">Saving…</small>}
          <small>
            {shopping.items.filter((item) => item.checked).length} / {shopping.items.length} bought
          </small>
          {shopping.items.map((item) => (
            <label key={item.id} className={item.checked ? 'checked' : ''}>
              <input
                type="checkbox"
                checked={item.checked}
                disabled={!toggle || record.archived || busy}
                onChange={() => toggle?.(item.id)}
              />
              <span>
                {item.name} {item.quantity && <small>· {item.quantity}</small>}
                {item.note && <small className="item-note">{item.note}</small>}
              </span>
            </label>
          ))}
        </div>
      )}
      {program && (
        <div className="program-preview">
          <small>
            {program.enabled ? 'Next 7 days' : 'Program paused'} · {program.timeZone}
          </small>
          {programOccurrences(program, today, until)
            .slice(0, 14)
            .map((item) => (
              <div key={item.entryId + item.day}>
                <time>
                  {item.day} · {item.start}–{item.end}
                </time>
                <strong>{item.title}</strong>
                {item.location && <small>{item.location}</small>}
              </div>
            ))}
        </div>
      )}
    </>
  );
}
