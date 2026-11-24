import { useState, type CSSProperties } from 'react';
import type { CalendarEvent } from '../shared/contracts';
import { eventOnDay } from '../shared/calendar-layout';
import { dateKey } from '../shared/time';

export function MonthCalendar({
  days,
  anchor,
  events,
  zone,
  onOpen,
  onDay,
}: {
  days: Date[];
  anchor: Date;
  events: CalendarEvent[];
  zone: string;
  onOpen: (event: CalendarEvent) => void;
  onDay: (day: Date) => void;
}) {
  const today = dateKey(new Date(), zone);
  const month = anchor.toISOString().slice(0, 7);
  const [selection, setSelection] = useState<{ month: string; day: string }>();
  const selected =
    selection?.month === month ? selection.day : today.startsWith(month) ? today : month + '-01';
  const dayEvents = events.filter((event) => eventOnDay(event, selected, zone));
  const time = (event: CalendarEvent) =>
    event.start.date
      ? 'All day'
      : new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit' }).format(
          new Date(event.start.dateTime!),
        );
  const choose = (day: string) => setSelection({ month, day });
  return (
    <div className="month-workspace" style={{ '--month-rows': days.length / 7 } as CSSProperties}>
      <div className="month-grid" aria-label="Month overview">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
          <div key={day} className="month-weekday">
            {day}
          </div>
        ))}
        {days.map((day) => {
          const key = day.toISOString().slice(0, 10);
          const list = events.filter((event) => eventOnDay(event, key, zone));
          return (
            <div
              key={key}
              className={
                'month-day' +
                (key.slice(0, 7) !== month ? ' outside-month' : '') +
                (selected === key ? ' selected-day' : '')
              }
            >
              <button
                className={'month-date' + (key === today ? ' today' : '')}
                aria-label={`Show ${key}, ${list.length} items`}
                aria-pressed={selected === key}
                onClick={() => choose(key)}
              >
                {day.getUTCDate()}
              </button>
              <div className="month-previews">
                {list.slice(0, 2).map((event) => (
                  <button
                    key={event.id}
                    className="month-event"
                    data-source={'source' in event ? String(event.source) : 'calendar'}
                    title={`${time(event)} · ${event.summary}`}
                    onClick={() => onOpen(event)}
                  >
                    <time>{time(event)}</time>
                    <span>{event.summary}</span>
                  </button>
                ))}
                {list.length > 2 && (
                  <button
                    className="month-more"
                    aria-label={`Show all ${list.length} items on ${key}`}
                    onClick={() => choose(key)}
                  >
                    +{list.length - 2} more
                  </button>
                )}
              </div>
              {list.length > 0 && (
                <button
                  className="month-mobile-count"
                  aria-label={`Show all ${list.length} items on ${key}`}
                  onClick={() => choose(key)}
                >
                  {list.length}
                  <span className="month-count-dot" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <section className="month-day-agenda" aria-label="Selected day items" aria-live="polite">
        <header>
          <div>
            <h3>
              {new Intl.DateTimeFormat('en-GB', {
                timeZone: 'UTC',
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              }).format(new Date(selected + 'T12:00:00Z'))}
            </h3>
            <span>
              {dayEvents.length} {dayEvents.length === 1 ? 'item' : 'items'}
            </span>
          </div>
          <button className="button subtle small" onClick={() => onDay(new Date(selected + 'T12:00:00Z'))}>
            Open day
          </button>
        </header>
        {dayEvents.length ? (
          dayEvents.map((event) => (
            <button
              key={event.id}
              className="month-agenda-event"
              data-source={'source' in event ? String(event.source) : 'calendar'}
              onClick={() => onOpen(event)}
            >
              <time>{time(event)}</time>
              <span>
                <strong>{event.summary}</strong>
                {event.location && <small>{event.location}</small>}
              </span>
            </button>
          ))
        ) : (
          <p className="muted">No items scheduled for this day.</p>
        )}
      </section>
    </div>
  );
}
