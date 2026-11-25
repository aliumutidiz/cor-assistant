import * as Dialog from '@radix-ui/react-dialog';
import { X } from '@phosphor-icons/react';
import { focusDialog } from './dialog-focus';
import { useMediaQuery } from './use-media-query';
import { useMemo, useState, useRef, type CSSProperties } from 'react';
import type { CalendarEvent } from '../shared/contracts';
import { dateKey } from '../shared/time';

export function MonthCalendar({
  days,
  anchor,
  byDay,
  loading,
  incomplete,
  zone,
  onSelect,
  onOpen,
  onDay,
}: {
  days: Date[];
  anchor: Date;
  byDay: Map<string, CalendarEvent[]>;
  loading: boolean;
  incomplete: boolean;
  onSelect: (day: string) => void;
  zone: string;
  onOpen: (event: CalendarEvent) => void;
  onDay: (day: Date) => void;
}) {
  const today = dateKey(new Date(), zone);
  const month = anchor.toISOString().slice(0, 7);
  const selected = anchor.toISOString().slice(0, 10);
  const dayEvents = byDay.get(selected) ?? [];
  const formatter = useMemo(
    () => new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit' }),
    [zone],
  );
  const time = (event: CalendarEvent) =>
    event.start.date ? 'All day' : formatter.format(new Date(event.start.dateTime!));
  const narrow = useMediaQuery('(max-width: 760px)');
  const [dayPanelOpen, setDayPanelOpen] = useState(false);
  const openingDetail = useRef(false);
  const agendaRef = useRef<HTMLElement>(null);
  const choose = (day: string) => {
    openingDetail.current = false;
    onSelect(day);
    if (narrow) setDayPanelOpen(true);
    else
      requestAnimationFrame(() => {
        const node = agendaRef.current;
        if (node && node.getBoundingClientRect().top > innerHeight - 100)
          node.scrollIntoView({ block: 'start' });
      });
  };
  const openItem = (event: CalendarEvent) => {
    openingDetail.current = true;
    setDayPanelOpen(false);
    onOpen(event);
  };
  const dayTitle = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(selected + 'T12:00:00Z'));
  const agenda = (inDialog: boolean) => (
    <section ref={agendaRef} className="month-day-agenda" aria-label="Selected day items" aria-live="polite">
      {inDialog && (
        <Dialog.Description className="sr-only">
          Appointments and plans for the selected day.
        </Dialog.Description>
      )}
      <header>
        <div>
          {inDialog ? (
            <Dialog.Title asChild>
              <h3>{dayTitle}</h3>
            </Dialog.Title>
          ) : (
            <h3>{dayTitle}</h3>
          )}
          <span>
            {dayEvents.length} {dayEvents.length === 1 ? 'item' : 'items'}
          </span>
        </div>
        <button
          className="button subtle small"
          onClick={() => {
            setDayPanelOpen(false);
            onDay(new Date(selected + 'T12:00:00Z'));
          }}
        >
          Open day
        </button>
        {inDialog && (
          <Dialog.Close className="icon-button" aria-label="Close day details">
            <X size={20} />
          </Dialog.Close>
        )}
      </header>
      {inDialog && incomplete && (
        <p className="error-text" role="status">
          Some information could not be refreshed. This day may be incomplete.
        </p>
      )}
      {dayEvents.length ? (
        dayEvents.map((event) => (
          <button
            key={event.id}
            className="month-agenda-event"
            data-source={'source' in event ? String(event.source) : 'calendar'}
            onClick={() => openItem(event)}
          >
            <time>{time(event)}</time>
            <span>
              <strong>{event.summary}</strong>
              {event.location && <small>{event.location}</small>}
            </span>
          </button>
        ))
      ) : (
        <p className="muted" role="status">
          {loading
            ? 'Loading this day…'
            : incomplete
              ? 'This day could not be fully loaded. Refresh the calendar to try again.'
              : 'No items scheduled for this day.'}
        </p>
      )}
    </section>
  );
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
          const list = byDay.get(key) ?? [];
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
                    onClick={() => openItem(event)}
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
      {narrow && dayPanelOpen ? (
        <Dialog.Root open onOpenChange={setDayPanelOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="modal-overlay" />
            <Dialog.Content
              className="modal-content month-day-sheet"
              onOpenAutoFocus={focusDialog}
              onCloseAutoFocus={(event) => {
                if (openingDetail.current) event.preventDefault();
              }}
            >
              {agenda(true)}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      ) : (
        agenda(false)
      )}
    </div>
  );
}
