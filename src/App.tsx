import { useChatDraft } from './chat-draft';
import { ChatTools, CopyReply } from './ChatTools';
import type { ConversationState } from '../shared/chat-controls';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  lazy,
  Suspense,
  type FormEvent,
  type ReactNode,
} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { MarkdownMessage } from './MarkdownMessage';
import { ReminderPanel } from './ReminderPanel';
import type { Reminder } from '../shared/reminders';
import { VoiceButton, VoiceInput, VoiceSettingsPanel, stopAllVoice } from './VoiceControls';
import type { VoiceStatus } from '../shared/voice';
import {
  ArrowDown,
  ArrowRight,
  ArrowsClockwise,
  CalendarBlank,
  Check,
  CheckCircle,
  Clock,
  Code,
  Command,
  DownloadSimple,
  Gear,
  Lightning,
  List,
  Plus,
  ShieldCheck,
  Spinner,
  Trash,
  X,
  CaretLeft,
  CaretRight,
  ChatCircle,
  Notebook,
  Pause,
  Play,
  Bell,
  MagnifyingGlass,
} from '@phosphor-icons/react';
import type {
  Action,
  Calendar,
  CalendarEvent,
  Operation,
  OperationInput,
  Routine,
  RoutineInput,
  Job,
} from '../shared/contracts';
import {
  api,
  sendChat,
  waitForChat,
  session,
  dateKey,
  dateTimeInput,
  zonedISO,
  formatDate,
  ApiError,
  type Session,
} from './api';
import { eventOnDay, eventLanes } from '../shared/calendar-layout';
import { exportCalendar } from '../shared/calendar-export';
import { operationMessage } from '../shared/operation-message';
import { AgyPanel, type AgyStatus } from './AgyPanel';
import { CalendarCache } from './calendar-cache';
import { ThemeControl } from './ThemeControl';
import { ProfileSettings, SettingsWorkspace } from './SettingsWorkspace';
const MemoryPanel = lazy(() => import('./MemoryPanel').then((module) => ({ default: module.MemoryPanel })));
const ConnectionSettings = lazy(() =>
  import('./ConnectionSettings').then((module) => ({ default: module.ConnectionSettings })),
);
type Page = 'assistant' | 'calendar' | 'routines' | 'reminders' | 'memories' | 'history' | 'settings';
type Message = {
  id?: string;
  role: 'assistant' | 'user';
  text: string;
  createdAt?: string;
  channel?: 'web' | 'telegram' | 'legacy';
};
function pendingChat(owner: string, value?: string | null) {
  try {
    const key = 'cor.pending-chat:' + owner;
    if (value === null) localStorage.removeItem(key);
    else if (value !== undefined) localStorage.setItem(key, value);
    const id = localStorage.getItem(key);
    return id && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id) ? id : null;
  } catch {
    return null;
  }
}
const statusText: Record<string, string> = {
  awaiting_approval: 'Awaiting approval',
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Completed',
  failed: 'Failed',
  unknown: 'Outcome unknown',
  canceled: 'Canceled',
};
const kindNames: Record<string, string> = {
  daily_summary: 'Daily summary',
  weekly_summary: 'Weekly summary',
  conflict_check: 'Conflict check',
  upcoming_check: 'Upcoming events',
  reminder: 'Scheduled message',
  ai_daily_summary: 'AI daily briefing',
  ai_weekly_summary: 'AI next-week briefing',
};
function Modal({
  title,
  description,
  children,
  onClose,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="modal-content">
          <div className="modal-heading">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>{description ?? 'Review and save your changes.'}</Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="Close">
              <X size={20} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <CalendarBlank size={30} weight="thin" />
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}
export function App() {
  const [s, setS] = useState<Session>();
  const [page, setPage] = useState<Page>('calendar');
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [calendarId, setCalendarId] = useState('primary');
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [eventSearch, setEventSearch] = useState('');
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState('');
  const eventsRequest = useRef(0);
  const eventCache = useRef(new CalendarCache());
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [historyFilter, setHistoryFilter] = useState('');
  const [historyQuery, setHistoryQuery] = useState('');
  const [dismissedReminders, setDismissedReminders] = useState<string[]>([]);
  const [date, setDate] = useState(() => new Date());
  const [clockNow, setClockNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setClockNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);
  const [view, setView] = useState<'week' | 'day' | 'month' | 'agenda'>('week');
  const [error, setError] = useState('');
  const [loginRequired, setLoginRequired] = useState(false);
  useEffect(() => {
    const expired = () => {
      eventCache.current.clear();
      setEvents([]);
      setS(undefined);
      setLoginRequired(true);
    };
    window.addEventListener('cor:login-required', expired);
    return () => window.removeEventListener('cor:login-required', expired);
  }, []);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [eventEditor, setEventEditor] = useState<CalendarEvent | null | undefined>();
  const [routineEditor, setRoutineEditor] = useState<Routine | null | undefined>();
  const [advanced, setAdvanced] = useState(false);
  const [chatContext, setChatContext] = useState<ConversationState>();
  const reloadConversation = async () => {
    const rows = await api<Message[]>('/chat/history');
    setMessages(rows);
    setOlderBefore(rows.length === 50 ? rows[0].id : undefined);
    setHistoryError('');
    setPrompt('');
  };
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      text: 'Hello. Connect your services in Settings to manage your calendar and routines here.',
    },
  ]);
  const [olderBefore, setOlderBefore] = useState<string>();
  const [historyError, setHistoryError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(true);
  const [olderLoading, setOlderLoading] = useState(false);
  const historyRequest = useRef(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const messagesViewport = useRef<HTMLDivElement>(null);
  const messagesContent = useRef<HTMLDivElement>(null);
  const stickToLatest = useRef(true);
  const prependHeight = useRef<{ height: number; top: number } | undefined>(undefined);
  useLayoutEffect(() => {
    const view = messagesViewport.current;
    if (!view) return;
    if (prependHeight.current !== undefined) {
      view.scrollTop = prependHeight.current.top + view.scrollHeight - prependHeight.current.height;
      prependHeight.current = undefined;
    } else if (stickToLatest.current) view.scrollTop = view.scrollHeight;
  }, [messages, loading, chatOpen]);
  useLayoutEffect(() => {
    const content = messagesContent.current,
      view = messagesViewport.current;
    if (!content || !view) return;
    const observer = new ResizeObserver(() => {
      if (stickToLatest.current) view.scrollTop = view.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [loading, chatOpen]);
  const [agyStatus, setAgyStatus] = useState<AgyStatus>();
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>();
  useEffect(() => {
    if (s)
      void api<VoiceStatus>('/voice/status')
        .then(setVoiceStatus)
        .catch(() => {});
  }, [s]);
  const refreshAgy = useCallback(async () => {
    try {
      setAgyStatus(await api<AgyStatus>('/agy/status'));
    } catch {
      /* Session handling is centralized. */
    }
  }, []);
  useEffect(() => {
    if (!s) return;
    void refreshAgy();
    const interval = setInterval(() => void refreshAgy(), 30000);
    return () => clearInterval(interval);
  }, [s, refreshAgy]);
  const [prompt, setPrompt] = useState('');
  useChatDraft(s?.owner, prompt, setPrompt);
  const [chatBusy, setChatBusy] = useState(false);
  const chatAbort = useRef<AbortController | null>(null);
  const activeChatRequest = useRef<string | undefined>(undefined);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const calendarScroll = useRef<HTMLDivElement>(null);
  const zone = s?.preferences.timeZone ?? 'Europe/Istanbul';
  const selectedDay = dateKey(date, zone);
  const movePeriod = (direction: number) => {
    const next = new Date(selectedDay + 'T12:00:00Z');
    if (view === 'month') {
      next.setUTCDate(1);
      next.setUTCMonth(next.getUTCMonth() + direction);
    } else next.setUTCDate(next.getUTCDate() + direction * (view === 'day' ? 1 : 7));
    setDate(next);
  };
  const anchor = new Date(selectedDay + 'T12:00:00Z');
  const first = new Date(anchor);
  first.setUTCDate(anchor.getUTCDate() - ((anchor.getUTCDay() + 6) % 7));
  if (view === 'day') first.setTime(anchor.getTime());
  if (view === 'month') {
    first.setUTCDate(1);
    first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));
  }
  const count = view === 'day' ? 1 : view === 'month' ? 42 : 7;
  const days = Array.from({ length: count }, (_, i) => {
    const d = new Date(first);
    d.setUTCDate(d.getUTCDate() + i);
    return d;
  });
  const from = days[0].toISOString().slice(0, 10),
    until = new Date(days.at(-1)!.getTime() + 86400000).toISOString().slice(0, 10);
  const refresh = useCallback(async () => {
    try {
      const [c, r, h] = await Promise.all([
        api<Calendar[]>('/calendars').catch(() => []),
        api<Routine[]>('/routines'),
        api<{ operations: Operation[]; jobs: Job[] }>('/history'),
      ]);
      setCalendars(c);
      setRoutines(r);
      setOperations(h.operations);
      setJobs(h.jobs);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    let alive = true;
    session()
      .then(async (current) => {
        if (!alive) return;
        setS(current);
        try {
          const history = await api<Message[]>('/chat/history');
          if (alive && Array.isArray(history)) {
            setMessages(history);
            setOlderBefore(history.length === 50 ? history[0].id : undefined);
          }
        } catch (e) {
          if (alive) setHistoryError((e as Error).message);
        } finally {
          if (alive) setHistoryLoading(false);
        }
        await refresh();
      })
      .catch((e) => {
        if (alive) {
          setLoginRequired(e instanceof ApiError && e.loginRequired);
          setError(e.message);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      chatAbort.current?.abort();
    };
  }, [refresh]);
  const refreshEvents = useCallback(
    async (force = false) => {
      if (!s) return;
      const request = ++eventsRequest.current;
      const queryFor = (first: string, last: string) =>
        new URLSearchParams({
          calendarId,
          from: zonedISO(first + 'T00:00', zone),
          to: zonedISO(last + 'T00:00', zone),
        }).toString();
      const key = queryFor(from, until);
      const cached = eventCache.current.peek(key);
      if (cached) setEvents(cached.events);
      else setEvents([]);
      setEventsLoading(!cached);
      setEventsError('');
      try {
        const result = await eventCache.current.load(
          key,
          () => api<CalendarEvent[]>('/events?' + key),
          force,
        );
        if (request === eventsRequest.current) setEvents(result);
        // Prefetch only the next visible range, after the foreground request succeeds.
        const distance = Date.parse(until + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z');
        const nextUntil = new Date(Date.parse(until + 'T12:00:00Z') + distance).toISOString().slice(0, 10);
        const nextKey = queryFor(until, nextUntil);
        if (request === eventsRequest.current && (!s.googleConnected ? s.demo : true))
          void eventCache.current
            .load(nextKey, () => api<CalendarEvent[]>('/events?' + nextKey))
            .catch(() => {});
      } catch (e) {
        if (request !== eventsRequest.current) return;
        if (!cached) setEvents([]);
        if (!s.demo && !s.googleConnected) return;
        setEventsError((e as Error).message);
      } finally {
        if (request === eventsRequest.current) setEventsLoading(false);
      }
    },
    [s, calendarId, from, until, zone],
  );
  useEffect(() => {
    void refreshEvents();
  }, [refreshEvents]);
  useEffect(() => {
    if (!s) return;
    const source = new EventSource('/api/progress');
    source.addEventListener('jobs', (event) => setJobs(JSON.parse((event as MessageEvent).data) as Job[]));
    source.addEventListener('operations', (event) => {
      const next = JSON.parse((event as MessageEvent).data) as Operation[];
      setOperations((previous) => {
        if (
          JSON.stringify(previous.map((o) => [o.id, o.status])) !==
          JSON.stringify(next.map((o) => [o.id, o.status]))
        ) {
          void refresh();
          eventCache.current.clear();
          void refreshEvents(true);
        }
        return next;
      });
    });
    return () => source.close();
  }, [s, refresh, refreshEvents]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setChatOpen(true);
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  const perform = async (action: OperationInput) => {
    setBusy(true);
    setError('');
    try {
      const op = await api<Operation>('/operations', action, 'POST', crypto.randomUUID());
      await refresh();
      if (op.status === 'awaiting_approval') setPage('history');
      return op;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  };
  const act = async (id: string, action: 'approve' | 'cancel', hash?: string) => {
    setBusy(true);
    try {
      const operation = await api<Operation>(`/operations/${id}/${action}`, hash ? { hash } : {});
      if (action === 'approve')
        setMessages((m) => [
          ...m,
          { role: 'assistant', text: operationMessage(operation, zone, s?.preferences.language ?? 'en') },
        ]);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const connect = async () => {
    try {
      const { url } = await api<{ url: string }>('/oauth/connect', {});
      window.location.assign(url);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const send = async (e?: FormEvent, value?: string) => {
    e?.preventDefault();
    const message = value ?? prompt;
    if (!message.trim() || chatBusy || historyLoading || historyError) return;
    setPrompt('');
    setChatOpen(true);
    stickToLatest.current = true;
    setMessages((m) => [...m, { role: 'user', text: message }]);
    setChatBusy(true);
    chatAbort.current = new AbortController();
    const requestId = crypto.randomUUID();
    activeChatRequest.current = requestId;
    if (s?.asyncChat) pendingChat(s.owner, requestId);
    try {
      const response = await sendChat<{ message: string; operation?: Operation }>(
        message,
        requestId,
        chatAbort.current.signal,
        s?.asyncChat,
        chatContext?.contextId,
      );
      if (s?.asyncChat) pendingChat(s.owner, null);
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          text: response.message,
        },
      ]);
      await refresh();
      if (response.operation?.status === 'awaiting_approval') setPage('history');
    } catch (e) {
      if (s?.asyncChat && e instanceof ApiError && e.status < 500 && ![401, 403, 429].includes(e.status))
        pendingChat(s.owner, null);
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          text:
            (e as Error).name === 'AbortError'
              ? 'Stopped waiting for the reply. The saved request may still run; check history before resending.'
              : (e as Error).message,
        },
      ]);
    } finally {
      activeChatRequest.current = undefined;
      setChatBusy(false);
    }
  };
  const resumedChat = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!s?.asyncChat || historyLoading) return;
    const id = pendingChat(s.owner);
    if (!id || resumedChat.current === id || activeChatRequest.current === id) return;
    resumedChat.current = id;
    setChatBusy(true);
    const abort = new AbortController();
    chatAbort.current = abort;
    void waitForChat<{ message: string; operation?: Operation }>(id, abort.signal)
      .then(async (response) => {
        pendingChat(s.owner, null);
        const rows = await api<Message[]>('/chat/history');
        if (abort.signal.aborted) return;
        setMessages((previous) => {
          const oldest = rows[0]?.id;
          return [...previous.filter((row) => row.id && oldest && BigInt(row.id) < BigInt(oldest)), ...rows];
        });
        setOlderBefore(rows.length === 50 ? rows[0].id : undefined);
        if (response.operation?.status === 'awaiting_approval') setPage('history');
        await refresh();
      })
      .catch((e) => {
        if (abort.signal.aborted) return;
        if (e instanceof ApiError && [404, 422].includes(e.status)) pendingChat(s.owner, null);
        setHistoryError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setChatBusy(false);
      });
    return () => {
      abort.abort();
      resumedChat.current = undefined;
    };
  }, [s, historyLoading, refresh]);
  const todayEvents = events.filter((e) => eventOnDay(e, dateKey(new Date(), zone), zone));
  const matchingEvents = events.filter((e) =>
    (e.summary + ' ' + (e.location ?? ''))
      .toLocaleLowerCase('tr')
      .includes(eventSearch.toLocaleLowerCase('tr')),
  );
  const pending = operations.filter((o) => o.status === 'awaiting_approval');
  if (loading)
    return (
      <div className="loading-page">
        <Spinner className="spin" size={22} />
        <span>Loading C.O.R.</span>
      </div>
    );
  if (!s)
    return (
      <main className="sign-in-page">
        <section className="sign-in-card" aria-label="Workspace access">
          <a className="sign-in-brand" href="/" aria-label="C.O.R. home">
            <img src="/brand/orbit.svg" width={48} height={48} alt="" />
            <strong>C.O.R.</strong>
          </a>
          <h1>{loginRequired ? 'Sign in' : 'Could not connect.'}</h1>
          <p>
            {loginRequired
              ? 'Access your private planning workspace.'
              : 'Your workspace could not be reached.'}
          </p>
          {loginRequired ? (
            <>
              <a className="button primary sign-in-button" href="/api/auth/login">
                Sign in with Google
                <ArrowRight size={18} />
              </a>
              <p className="sign-in-note">
                Only the owner configured for this installation can sign in. Calendar access is requested
                separately.
              </p>
              <details className="sign-in-help">
                <summary>Setting up your own installation?</summary>
                <p>
                  Try the local demo without an account. For a persistent installation, the setup wizard reads
                  your own Google OAuth client file. Creating that client in Google Cloud is a one-time step.
                </p>
                <a
                  href="https://github.com/aliumutidiz/cor-assistant/blob/main/docs/INSTALLATION.md"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Read the installation guide <ArrowRight size={15} />
                </a>
              </details>
            </>
          ) : (
            <>
              <p className="error-text" role="alert">
                {error || 'Could not start the session.'}
              </p>
              <button className="button primary" onClick={() => window.location.reload()}>
                Retry
              </button>
            </>
          )}
          <div className="sign-in-appearance">
            <ThemeControl />
          </div>
        </section>
      </main>
    );

  return (
    <div className={'app-shell' + (page === 'assistant' ? ' agent-view' : '')}>
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="C.O.R. home">
          <img src="/brand/orbit.svg" alt="" width={38} height={38} />
          <span>C.O.R.</span>
        </a>
        <span className="section-label">WORKSPACE</span>
        <nav>
          {(
            [
              { id: 'assistant', label: 'Assistant', icon: ChatCircle },
              { id: 'calendar', label: 'Calendar', icon: CalendarBlank },
              { id: 'reminders', label: 'Reminders', icon: Bell },
              { id: 'routines', label: 'Routines', icon: Lightning },
              { id: 'memories', label: 'Memory', icon: Notebook },
              { id: 'history', label: 'Activity', icon: Clock },
              { id: 'settings', label: 'Settings', icon: Gear },
            ] as const
          ).map((n) => (
            <button
              key={n.id}
              className={page === n.id ? 'nav-item active' : 'nav-item'}
              onClick={() => setPage(n.id)}
            >
              <n.icon size={20} weight={page === n.id ? 'duotone' : 'regular'} />
              {n.label}
              {n.id === 'history' && pending.length > 0 && (
                <span className="nav-count">{pending.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="calendar-list">
          <span className="section-label">MY CALENDARS</span>
          {calendars.map((c, i) => (
            <button
              key={c.id}
              onClick={() => {
                setCalendarId(c.id);
                setPage('calendar');
              }}
              className={calendarId === c.id ? 'calendar-choice selected' : 'calendar-choice'}
            >
              <span className={'calendar-dot color-' + (i % 3)} />
              {c.summary}
              <span className="choice-check">{calendarId === c.id && <Check size={14} />}</span>
            </button>
          ))}
          {!calendars.length && <p className="muted small">Connect your calendar account to get started.</p>}
        </div>
        <div className="sidebar-bottom">
          <ThemeControl />
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span>{' '}
            <strong>
              {
                {
                  assistant: 'Assistant',
                  calendar: 'Calendar',
                  reminders: 'Reminders',
                  routines: 'Routines',
                  memories: 'Memory',
                  history: 'Activity',
                  settings: 'Settings',
                }[page]
              }
            </strong>
          </div>
          <button
            className="command-trigger"
            onClick={() => {
              setChatOpen((v) => !v);
              inputRef.current?.focus();
            }}
          >
            <ChatCircle size={17} /> Ask C.O.R. <kbd>Ctrl K</kbd>
          </button>
        </header>
        <div className="content">
          <div className="page-heading">
            <div className="heading-row">
              <div>
                <h1>
                  {
                    {
                      assistant: 'Assistant',
                      calendar: 'Calendar',
                      reminders: 'Reminders',
                      routines: 'Routines',
                      memories: 'Memory, programs and lists',
                      history: 'Activity',
                      settings: 'Settings',
                    }[page]
                  }
                </h1>
              </div>
              {page === 'calendar' ? (
                <button
                  className="button primary"
                  onClick={() =>
                    setEventEditor({
                      summary: '',
                      id: '',
                      calendarId,
                      start: { dateTime: zonedISO(selectedDay + 'T09:00', zone) },
                      end: { dateTime: zonedISO(selectedDay + 'T10:00', zone) },
                    })
                  }
                >
                  <Plus size={17} />
                  Add event
                </button>
              ) : page === 'routines' ? (
                <button className="button primary" onClick={() => setRoutineEditor(null)}>
                  <Plus size={17} />
                  Create routine
                </button>
              ) : null}
            </div>
          </div>
          {s?.demo && (
            <div className="demo-banner">
              <span className="status-dot" />
              <span>
                <strong>Demo</strong> · Demo changes are held in memory and do not affect Google.
              </span>
              <button onClick={() => setPage('settings')}>
                View connections <ArrowRight size={14} />
              </button>
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError('')}>
                <X size={17} />
              </button>
            </div>
          )}
          {jobs
            .filter(
              (j) =>
                j.kind === 'routine' &&
                j.payload.routine?.kind === 'reminder' &&
                j.status === 'succeeded' &&
                j.result &&
                !(j.result as { skipped?: boolean }).skipped &&
                Date.now() - Date.parse(j.finishedAt ?? j.scheduledAt) < 15 * 60000 &&
                !dismissedReminders.includes(j.id),
            )
            .map((j) => (
              <div className="reminder-banner" role="status" key={j.id}>
                <Clock size={19} />
                <div>
                  <strong>{j.payload.routine!.name}</strong>
                  <p>{(j.result as { message: string }).message}</p>
                  <small>{formatDate(j.finishedAt ?? j.scheduledAt, zone)} · No LLM used</small>
                </div>
                <button
                  className="icon-button"
                  aria-label="Close reminder"
                  onClick={() => setDismissedReminders((ids) => [...ids, j.id])}
                >
                  <X size={17} />
                </button>
              </div>
            ))}
          {page === 'calendar' && (
            <>
              <div className="day-overview">
                <div className="overview-date">
                  <span>
                    {new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'long' }).format(new Date())}
                  </span>
                  <strong>
                    {new Intl.DateTimeFormat('en-GB', {
                      timeZone: zone,
                      day: 'numeric',
                      month: 'long',
                    }).format(new Date())}
                  </strong>
                </div>
                <div className="overview-copy">
                  <span className="mini-label">TODAY</span>
                  <p>
                    {todayEvents.length
                      ? `${todayEvents.length} event${todayEvents.length === 1 ? '' : 's'} on your calendar today.`
                      : 'No events today.'}
                  </p>
                  <small>
                    {s?.googleConnected
                      ? 'Refresh your calendar to see the latest changes.'
                      : 'Add an event to start planning.'}
                  </small>
                </div>
                <button className="text-button" onClick={() => void send(undefined, 'Summarize my day.')}>
                  <ChatCircle size={18} />
                  Summarize today <ArrowRight size={15} />
                </button>
              </div>
              <section className="calendar-panel" aria-label="Calendar" aria-busy={eventsLoading}>
                <div className="calendar-toolbar">
                  <div className="period-navigation">
                    <h2>
                      {new Intl.DateTimeFormat('en-GB', {
                        timeZone: 'UTC',
                        month: 'long',
                        year: 'numeric',
                      }).format(anchor)}
                    </h2>
                    <button
                      className="icon-button"
                      aria-label="Previous period"
                      onClick={() => movePeriod(-1)}
                    >
                      <CaretLeft size={17} />
                    </button>
                    <button className="icon-button" aria-label="Next period" onClick={() => movePeriod(1)}>
                      <CaretRight size={17} />
                    </button>
                    <button className="button subtle small" onClick={() => setDate(new Date())}>
                      Today
                    </button>
                  </div>
                  <div className="view-tabs">
                    {(
                      [
                        ['day', 'Day'],
                        ['week', 'Week'],
                        ['month', 'Month'],
                        ['agenda', 'Agenda'],
                      ] as const
                    ).map(([v, t]) => (
                      <button className={view === v ? 'selected' : ''} key={v} onClick={() => setView(v)}>
                        {t}
                      </button>
                    ))}
                  </div>
                  <input
                    className="calendar-date-picker"
                    type="date"
                    aria-label="Go to date"
                    value={selectedDay}
                    onChange={(e) => {
                      if (e.target.value) setDate(new Date(e.target.value + 'T12:00:00Z'));
                    }}
                  />
                  {(view === 'day' || view === 'week') && (
                    <button
                      className="button subtle small"
                      onClick={() => {
                        setDate(new Date());
                        const [hour, minute] = dateTimeInput(new Date(), zone)
                          .slice(11)
                          .split(':')
                          .map(Number);
                        calendarScroll.current?.scrollTo({
                          top: Math.max(0, (hour + minute / 60) * 56 - 56),
                          behavior: 'smooth',
                        });
                      }}
                    >
                      Now
                    </button>
                  )}
                  <button
                    className="icon-button"
                    aria-label="Refresh calendar"
                    onClick={() => void refreshEvents(true)}
                  >
                    <ArrowsClockwise size={18} />
                  </button>
                </div>
                <div className="calendar-context-bar">
                  <label className="calendar-search">
                    <MagnifyingGlass size={17} />
                    <input
                      aria-label="Search events in this period"
                      placeholder="Search this period…"
                      value={eventSearch}
                      onChange={(e) => {
                        setEventSearch(e.target.value);
                        if (e.target.value) setView('agenda');
                      }}
                    />
                  </label>
                  <span>
                    {eventsLoading ? 'Refreshing…' : `${events.length} events`} · {zone}
                  </span>
                </div>
                {eventsError && (
                  <div role="alert" className="calendar-inline-error">
                    {eventsError}
                    <button className="text-button" onClick={() => void refreshEvents(true)}>
                      Retry
                    </button>
                  </div>
                )}
                {view === 'agenda' ? (
                  <div className="agenda">
                    {matchingEvents.length ? (
                      matchingEvents.map((e) => (
                        <button className="agenda-event" key={e.id} onClick={() => setEventEditor(e)}>
                          <span className="calendar-dot color-0" />
                          <time>{e.start.dateTime ? formatDate(e.start.dateTime, zone) : e.start.date}</time>
                          <strong>{e.summary}</strong>
                          <span>{e.location}</span>
                          <ArrowRight size={16} />
                        </button>
                      ))
                    ) : (
                      <Empty
                        title={
                          eventsLoading
                            ? 'Loading events…'
                            : eventSearch
                              ? 'No matching events.'
                              : 'No events in this period.'
                        }
                      >
                        Choose a date or select Add event.
                      </Empty>
                    )}
                  </div>
                ) : view === 'month' ? (
                  <div className="month-grid">
                    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
                      <div key={day} className="month-weekday">
                        {day}
                      </div>
                    ))}
                    {days.map((d) => {
                      const key = d.toISOString().slice(0, 10);
                      const list = events.filter((e) => eventOnDay(e, key, zone));
                      return (
                        <div
                          className={
                            'month-day ' + (d.getUTCMonth() !== anchor.getUTCMonth() ? 'outside-month' : '')
                          }
                          key={key}
                        >
                          <button
                            onClick={() => {
                              setDate(d);
                              setView('day');
                            }}
                            className={key === dateKey(new Date(), zone) ? 'today' : ''}
                          >
                            {d.getUTCDate()}
                          </button>
                          {list.map((e) => (
                            <button className="month-event" key={e.id} onClick={() => setEventEditor(e)}>
                              {e.summary}
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className={'week-scroll ' + (view === 'day' ? 'single-day' : '')} ref={calendarScroll}>
                    <div
                      className="week-grid"
                      style={{ gridTemplateColumns: `54px repeat(${count}, minmax(100px,1fr))` }}
                    >
                      <div className="zone-label">
                        GMT
                        {new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'shortOffset' })
                          .formatToParts(new Date())
                          .find((p) => p.type === 'timeZoneName')
                          ?.value.replace('GMT', '')}
                      </div>
                      {days.map((d) => (
                        <button
                          aria-label={`Open ${d.toISOString().slice(0, 10)}`}
                          onClick={() => {
                            setDate(d);
                            setView('day');
                          }}
                          key={d.toISOString()}
                          className={
                            'day-header ' +
                            (d.toISOString().slice(0, 10) === dateKey(new Date(), zone) ? 'is-today' : '')
                          }
                        >
                          <span>
                            {new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short' }).format(
                              d,
                            )}
                          </span>
                          <strong>{d.getUTCDate()}</strong>
                        </button>
                      ))}
                      <div className="all-day-label">All day</div>
                      {days.map((d) => {
                        const key = d.toISOString().slice(0, 10);
                        return (
                          <div className="all-day-cell" key={'all-' + key}>
                            {events
                              .filter((e) => e.start.date && eventOnDay(e, key, zone))
                              .map((e) => (
                                <button
                                  className="all-day-event"
                                  key={e.id}
                                  onClick={() => setEventEditor(e)}
                                >
                                  {e.summary}
                                </button>
                              ))}
                          </div>
                        );
                      })}
                      <div className="hour-axis">
                        {Array.from({ length: 24 }, (_, i) => (
                          <span key={i}>{String(i).padStart(2, '0')}:00</span>
                        ))}
                      </div>
                      {days.map((d) => {
                        const key = d.toISOString().slice(0, 10);
                        const list = events.filter((e) => e.start.dateTime && eventOnDay(e, key, zone));
                        const lanes = eventLanes(list);
                        return (
                          <div className="day-column" key={key}>
                            {key === dateKey(clockNow, zone) && (
                              <div
                                className="calendar-now"
                                role="img"
                                aria-label={'Current time ' + dateTimeInput(clockNow, zone).slice(11)}
                                style={{
                                  top:
                                    (Number(dateTimeInput(clockNow, zone).slice(11, 13)) +
                                      Number(dateTimeInput(clockNow, zone).slice(14, 16)) / 60) *
                                    56,
                                }}
                              />
                            )}
                            {Array.from({ length: 24 }, (_, i) => (
                              <button
                                className="hour-slot"
                                key={i}
                                aria-label={`Add event ${key} ${i}:00`}
                                onClick={() =>
                                  setEventEditor({
                                    id: '',
                                    calendarId,
                                    summary: '',
                                    start: {
                                      dateTime: zonedISO(`${key}T${String(i).padStart(2, '0')}:00`, zone),
                                      timeZone: zone,
                                    },
                                    end: {
                                      dateTime: zonedISO(
                                        i === 23
                                          ? `${new Date(d.getTime() + 86400000).toISOString().slice(0, 10)}T00:00`
                                          : `${key}T${String(i + 1).padStart(2, '0')}:00`,
                                        zone,
                                      ),
                                      timeZone: zone,
                                    },
                                  })
                                }
                              />
                            ))}
                            {list.map((e, i) => {
                              const local = e.start.dateTime
                                ? dateTimeInput(new Date(e.start.dateTime), zone).slice(11)
                                : '00:00';
                              const [h, m] = local.split(':').map(Number);
                              const startsBeforeDay =
                                e.start.dateTime && dateKey(new Date(e.start.dateTime), zone) < key;
                              const top = Math.min(
                                1343,
                                Math.max(0, startsBeforeDay ? 0 : ((h * 60 + m) / 60) * 56),
                              );
                              const lane = lanes.get(e.id) ?? { lane: 0, columns: 1 };
                              const duration =
                                e.start.dateTime && e.end.dateTime
                                  ? (Math.min(
                                      Date.parse(e.end.dateTime),
                                      Date.parse(
                                        zonedISO(
                                          `${new Date(d.getTime() + 86400000).toISOString().slice(0, 10)}T00:00`,
                                          zone,
                                        ),
                                      ),
                                    ) -
                                      Math.max(
                                        Date.parse(e.start.dateTime),
                                        Date.parse(zonedISO(`${key}T00:00`, zone)),
                                      )) /
                                    60000
                                  : 45;
                              return (
                                <button
                                  key={e.id}
                                  className={'grid-event color-' + (i % 3)}
                                  style={{
                                    top,
                                    left: `calc(${(lane.lane * 100) / lane.columns}% + 4px)`,
                                    width: `calc(${100 / lane.columns}% - 8px)`,
                                    right: 'auto',
                                    height: Math.min(Math.max(24, (duration / 60) * 56), 1344 - top),
                                  }}
                                  onClick={() => setEventEditor(e)}
                                >
                                  <strong>{e.summary}</strong>
                                  <span>
                                    {e.start.date ? 'All day' : local}
                                    {e.location ? ' · ' + e.location : ''}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                <footer className="calendar-footer">
                  <span>
                    <span className="calendar-dot color-0" />
                    {calendars.find((c) => c.id === calendarId)?.summary ?? 'Calendar'}
                  </span>
                  <span>
                    {zone} · {events.length} event
                  </span>
                  <button
                    className="text-button"
                    disabled={eventsLoading || !!eventsError || !events.length}
                    title="Download events in the visible period"
                    onClick={() => {
                      const url = URL.createObjectURL(
                        new Blob([exportCalendar(events)], { type: 'text/calendar;charset=utf-8' }),
                      );
                      const link = document.createElement('a');
                      link.href = url;
                      link.download = `cor-${from}-${until}.ics`;
                      link.click();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                    }}
                  >
                    <DownloadSimple size={14} />
                    Export period
                  </button>
                </footer>
              </section>
            </>
          )}
          {page === 'reminders' && (
            <ReminderPanel zone={zone} telegramEnabled={!!s?.telegram?.enabled} perform={perform} />
          )}
          {page === 'routines' && (
            <section className="routine-section">
              <div className="section-heading">
                <h2>
                  Your routines <span>{routines.length}</span>
                </h2>
                <span className="muted small">Each routine keeps its own time zone.</span>
              </div>
              {routines.map((r) => (
                <article key={r.id} className="routine-row">
                  <span className={'routine-icon ' + (r.enabled ? 'enabled' : '')}>
                    <Clock size={22} />
                  </span>
                  <div className="routine-info">
                    <h3>
                      {r.name}
                      <span className={'pill ' + (r.enabled ? 'green' : '')}>
                        {r.enabled ? 'Enabled' : 'Paused'}
                      </span>
                    </h3>
                    <p>
                      {kindNames[r.kind]} <span>·</span> <code>{r.cron}</code> <span>·</span> {r.timeZone}
                    </p>
                    <small>
                      {r.enabled
                        ? (r.kind.startsWith('ai_') ? 'AI briefing · Next run: ' : 'No LLM · Next run: ') +
                          formatDate(r.nextRun, r.timeZone)
                        : (r.kind.startsWith('ai_')
                            ? 'AI briefing · When enabled: '
                            : 'No LLM · When enabled: ') + formatDate(r.nextRun, r.timeZone)}
                    </small>
                  </div>
                  <button
                    className="icon-button"
                    disabled={busy}
                    aria-label={r.enabled ? 'Pause routine' : 'Enable routine'}
                    onClick={() =>
                      void perform({
                        kind: 'routine.update',
                        routineId: r.id,
                        version: r.version,
                        routine: {
                          name: r.name,
                          cron: r.cron,
                          timeZone: r.timeZone,
                          kind: r.kind,
                          message: r.message,
                          enabled: !r.enabled,
                        },
                      }).catch(() => {})
                    }
                  >
                    {r.enabled ? <Pause size={18} /> : <Play size={18} />}
                  </button>
                  <button className="button subtle small" onClick={() => setRoutineEditor(r)}>
                    Edit
                  </button>
                </article>
              ))}
              {!routines.length && (
                <Empty title="Create your first routine.">
                  Start with a daily summary or a conflict check.
                </Empty>
              )}
              <div className="routine-help">
                <ChatCircle size={22} />
                <div>
                  <strong>Manage routines in conversation too.</strong>
                  <p>Try “Send a daily briefing at 09:00.” The assistant connection must be active.</p>
                </div>
                <button
                  className="text-button"
                  onClick={() => {
                    setChatOpen(true);
                    inputRef.current?.focus();
                  }}
                >
                  Ask C.O.R. <ArrowRight size={16} />
                </button>
              </div>
            </section>
          )}
          {page === 'history' && (
            <section className="history-section">
              <div className="section-heading">
                <h2>Actions and approvals</h2>
                <button className="text-button" onClick={() => void refresh()}>
                  <ArrowsClockwise size={16} />
                  Refresh
                </button>
              </div>
              <div className="history-toolbar">
                <input
                  aria-label="Search activity"
                  placeholder="Search action or title"
                  value={historyQuery}
                  onChange={(e) => setHistoryQuery(e.target.value)}
                />
                <select
                  aria-label="Filter activity status"
                  value={historyFilter}
                  onChange={(e) => setHistoryFilter(e.target.value)}
                >
                  <option value="">All statuses</option>
                  {Object.entries(statusText).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <small className="muted">Latest {operations.length} action</small>
              </div>
              {operations
                .filter(
                  (op) =>
                    (!historyFilter || op.status === historyFilter) &&
                    (op.action.kind + ' ' + (op.preview?.title ?? ''))
                      .toLocaleLowerCase('tr')
                      .includes(historyQuery.toLocaleLowerCase('tr')),
                )
                .map((op) => (
                  <article className="operation-row" key={op.id}>
                    <div className="operation-top">
                      <span
                        className={
                          'pill ' +
                          (op.status === 'succeeded'
                            ? 'green'
                            : op.status === 'awaiting_approval'
                              ? 'amber'
                              : '')
                        }
                      >
                        {statusText[op.status]}
                      </span>
                      <strong className="history-title">
                        {op.preview?.title ??
                          ('record' in op.action
                            ? op.action.record.title
                            : 'routine' in op.action
                              ? op.action.routine?.name
                              : 'reminder' in op.action
                                ? op.action.reminder.title
                                : 'event' in op.action
                                  ? op.action.event?.summary
                                  : undefined) ??
                          op.action.kind}
                      </strong>
                      <time>{formatDate(op.createdAt, zone)}</time>
                    </div>
                    <details open={op.status === 'awaiting_approval' || op.status === 'unknown'}>
                      <summary>Action details</summary>
                      <code>{op.action.kind}</code>
                      {op.preview && <p className="memory-body">{op.preview.body}</p>}
                      <pre>{JSON.stringify(op.action, null, 2)}</pre>
                      {op.result !== undefined && <pre>{JSON.stringify(op.result, null, 2)}</pre>}
                    </details>
                    {op.error && <p className="error-text">{op.error}</p>}
                    {op.status === 'awaiting_approval' && (
                      <div className="approval-actions">
                        <p>
                          Approval applies only to the content above. Expires:{' '}
                          {formatDate(op.expiresAt, zone)}.
                        </p>
                        <button
                          className="button subtle"
                          disabled={busy}
                          onClick={() => void act(op.id, 'cancel')}
                        >
                          Cancel
                        </button>
                        <button
                          className="button primary"
                          disabled={busy}
                          onClick={() => void act(op.id, 'approve', op.hash)}
                        >
                          <Check size={17} />
                          Approve and apply
                        </button>
                      </div>
                    )}
                    {op.status === 'queued' && (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => void act(op.id, 'cancel')}
                      >
                        Cancel
                      </button>
                    )}
                  </article>
                ))}
              {!operations.length && (
                <Empty title="No activity yet.">Calendar and routine changes appear here.</Empty>
              )}
              <div className="section-heading">
                <h2>Routine runs</h2>
              </div>
              {jobs
                .filter((j) => j.kind === 'routine' || j.kind === 'ai_report')
                .map((j) => (
                  <article className="operation-row" key={j.id}>
                    <div className="operation-top">
                      <strong>
                        {j.payload.routine?.name ??
                          (j.payload.taskReminder ? 'Task reminder' : 'Background job')}
                      </strong>
                      <span className="pill">{statusText[j.status]}</span>
                      <time>{formatDate(j.scheduledAt, zone)}</time>
                    </div>
                    {j.error && <p className="error-text">{j.error}</p>}
                    <details>
                      <summary>Run result</summary>
                      {typeof (j.result as { message?: unknown })?.message === 'string' ? (
                        <MarkdownMessage text={(j.result as { message: string }).message} />
                      ) : (
                        <pre>{JSON.stringify(j.result ?? {}, null, 2)}</pre>
                      )}
                    </details>
                  </article>
                ))}
            </section>
          )}
          {s.onboardingRequired && page !== 'settings' && (
            <div className="onboarding-invite" role="status">
              <div>
                <strong>Make C.O.R. yours</strong>
                <p>How should I address you, and which language do you prefer?</p>
              </div>
              <button className="button subtle" onClick={() => setPage('settings')}>
                Set up profile
              </button>
            </div>
          )}
          {page === 'settings' && (
            <SettingsWorkspace
              profile={
                <ProfileSettings session={s} perform={perform} refresh={async () => setS(await session())} />
              }
              connections={(section) => (
                <Suspense fallback={<p role="status">Loading connections…</p>}>
                  <ConnectionSettings
                    section={section}
                    session={s}
                    refresh={async () => setS(await session())}
                  />
                </Suspense>
              )}
              assistant={<AgyPanel status={agyStatus} refresh={refreshAgy} />}
              voice={<VoiceSettingsPanel onChange={setVoiceStatus} />}
              account={
                <Settings
                  s={s}
                  connect={connect}
                  refreshSession={async () => setS(await session())}
                  perform={perform}
                  advanced={() => setAdvanced(true)}
                />
              }
              signOut={
                s.canLogout
                  ? async () => {
                      try {
                        await api('/auth/logout', {});
                        try {
                          sessionStorage.removeItem('cor.draft:' + s.owner);
                        } catch {
                          /* Storage may be disabled. */
                        }
                        window.location.assign('/');
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }
                  : undefined
              }
            />
          )}
          {page === 'memories' && (
            <Suspense
              fallback={
                <p className="muted" role="status">
                  Loading records…
                </p>
              }
            >
              <MemoryPanel
                perform={perform}
                operations={operations}
                timeZone={s.preferences.timeZone}
                revision={operations.map((op) => op.id + ':' + op.status).join('|')}
              />
            </Suspense>
          )}
        </div>
      </main>
      <aside
        aria-label="Assistant conversation"
        className={'assistant-panel ' + (chatOpen || page === 'assistant' ? 'open' : '')}
      >
        <ChatTools
          key={s.owner}
          busy={chatBusy || historyLoading}
          onContext={setChatContext}
          onChanged={reloadConversation}
        />
        <div className="assistant-heading">
          <span className="assistant-logo">
            <ChatCircle size={21} />
          </span>
          <div>
            <strong>C.O.R. Assistant</strong>
            <small>{s?.agyEnabled ? 'AGY enabled' : 'Awaiting verification'}</small>
          </div>
          <button
            className="icon-button close-assistant"
            aria-label="Close assistant"
            onClick={() => {
              setChatOpen(false);
              if (page === 'assistant') setPage('calendar');
              stopAllVoice();
            }}
          >
            <X size={18} />
          </button>
        </div>
        {page !== 'assistant' && (
          <button
            className="text-button expand-assistant"
            onClick={() => {
              setPage('assistant');
              setChatOpen(true);
            }}
          >
            Open full conversation <ArrowRight size={15} />
          </button>
        )}
        {historyError && (
          <div className="error-banner" role="alert">
            Could not load conversation history.{' '}
            <button
              className="text-button"
              disabled={historyLoading}
              onClick={async () => {
                if (historyRequest.current) return;
                historyRequest.current = true;
                setHistoryLoading(true);
                try {
                  const rows = await api<Message[]>('/chat/history');
                  setMessages(rows);
                  setOlderBefore(rows.length === 50 ? rows[0].id : undefined);
                  stickToLatest.current = true;
                  setHistoryError('');
                } catch (e) {
                  setHistoryError((e as Error).message);
                } finally {
                  historyRequest.current = false;
                  setHistoryLoading(false);
                }
              }}
            >
              Reload history
            </button>
          </div>
        )}
        {agyStatus?.connection?.state === 'auth_required' && (
          <div className="error-banner" role="alert">
            AGY session closed.{' '}
            <button
              className="text-button"
              onClick={() => {
                setPage('settings');
                setChatOpen(false);
              }}
            >
              Sign in again in Settings
            </button>
          </div>
        )}
        <div
          className="messages"
          role="log"
          aria-live="polite"
          ref={messagesViewport}
          onScroll={(e) => {
            const view = e.currentTarget;
            stickToLatest.current = view.scrollHeight - view.scrollTop - view.clientHeight < 80;
            setAwayFromLatest(!stickToLatest.current);
          }}
        >
          <div ref={messagesContent}>
            {olderBefore && (
              <button
                className="text-button"
                disabled={olderLoading}
                onClick={async () => {
                  if (historyRequest.current) return;
                  historyRequest.current = true;
                  setOlderLoading(true);
                  try {
                    const rows = await api<Message[]>('/chat/history?before=' + olderBefore);
                    const view = messagesViewport.current;
                    if (view) prependHeight.current = { height: view.scrollHeight, top: view.scrollTop };
                    stickToLatest.current = false;
                    setMessages((current) => {
                      const ids = new Set(current.map((m) => m.id).filter(Boolean));
                      return [...rows.filter((m) => !m.id || !ids.has(m.id)), ...current];
                    });
                    setOlderBefore(rows.length === 50 ? rows[0].id : undefined);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    historyRequest.current = false;
                    setOlderLoading(false);
                  }
                }}
              >
                {olderLoading ? 'Loading messages…' : 'Show earlier messages'}
              </button>
            )}
            {messages.map((m, i) => (
              <div className={'message ' + m.role} key={m.id ? 'archive:' + m.id : 'local:' + i}>
                {m.role === 'assistant' && <span className="message-author">C.O.R.</span>}
                {m.createdAt && (
                  <small className="message-meta">
                    {m.channel === 'telegram' ? 'Telegram · ' : m.channel === 'web' ? 'Web · ' : ''}
                    {formatDate(m.createdAt, zone)}
                  </small>
                )}
                {m.role === 'assistant' ? <MarkdownMessage text={m.text} /> : <p>{m.text}</p>}
                {m.role === 'assistant' && <CopyReply text={m.text} />}
                {m.role === 'assistant' && voiceStatus?.enabled && voiceStatus.configured && (
                  <VoiceButton text={m.text} voice={voiceStatus.voice} />
                )}
              </div>
            ))}
            {chatBusy && (
              <div className="thinking">
                <Spinner className="spin" size={16} />
                Working on your request… <button onClick={() => chatAbort.current?.abort()}>Cancel</button>
              </div>
            )}
          </div>
        </div>
        {awayFromLatest && (
          <button
            className="text-button"
            onClick={() => {
              stickToLatest.current = true;
              if (messagesViewport.current)
                messagesViewport.current.scrollTop = messagesViewport.current.scrollHeight;
              setAwayFromLatest(false);
            }}
          >
            Jump to latest ↓
          </button>
        )}
        {messages.length < 3 && (
          <div className="suggestions" aria-label="Suggested messages">
            <small className="muted">Suggested messages · choose to send</small>
            {['Summarize my day', 'Show my routines'].map((t) => (
              <button key={t} onClick={() => void send(undefined, t)}>
                {t}
                <ArrowRight size={15} />
              </button>
            ))}
          </div>
        )}
        <form className="chat-form" onSubmit={(e) => void send(e)}>
          <label className="sr-only" htmlFor="chat-input">
            Message C.O.R.
          </label>
          <textarea
            id="chat-input"
            ref={inputRef}
            rows={2}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Message C.O.R.…"
            maxLength={6000}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="composer-toolbar">
            {voiceStatus?.speechInput && (
              <VoiceInput
                compact
                disabled={chatBusy || historyLoading || !!historyError}
                onTranscript={(text) => {
                  setPrompt((old) => (old ? old + ' ' + text : text));
                  inputRef.current?.focus();
                }}
              />
            )}
            <span className="composer-hint">Enter to send · Shift + Enter for a new line</span>
            <button
              type="submit"
              disabled={chatBusy || historyLoading || !!historyError || !prompt.trim()}
              aria-label="Send message"
            >
              <ArrowRight size={20} />
            </button>
          </div>
        </form>
        <p className="assistant-disclaimer">
          <ShieldCheck size={13} />
          Sensitive changes require your approval.
        </p>
      </aside>
      {eventEditor !== undefined && (
        <EventEditor
          event={eventEditor}
          calendarId={calendarId}
          calendars={calendars}
          zone={zone}
          busy={busy}
          onClose={() => setEventEditor(undefined)}
          save={async (a) => {
            await perform(a);
            setEventEditor(undefined);
          }}
        />
      )}
      {routineEditor !== undefined && (
        <RoutineEditor
          routine={routineEditor}
          zone={zone}
          busy={busy}
          onClose={() => setRoutineEditor(undefined)}
          save={async (a) => {
            await perform(a);
            setRoutineEditor(undefined);
          }}
        />
      )}
      {advanced && <Advanced onClose={() => setAdvanced(false)} save={perform} calendarId={calendarId} />}
    </div>
  );
}
function EventEditor({
  event: initialEvent,
  calendarId,
  calendars,
  zone: ownerZone,
  busy,
  onClose,
  save,
}: {
  event: CalendarEvent | null;
  calendarId: string;
  calendars: Calendar[];
  zone: string;
  busy: boolean;
  onClose: () => void;
  save: (a: OperationInput) => Promise<void>;
}) {
  const [event, setEvent] = useState(initialEvent);
  const zone = event?.start.timeZone ?? ownerZone;
  const [scopeLoading, setScopeLoading] = useState(false);
  const initial = new Date();
  initial.setMinutes(0, 0, 0);
  initial.setHours(initial.getHours() + 1);
  const [title, setTitle] = useState(event?.summary ?? '');
  const [start, setStart] = useState(
    event?.start.dateTime
      ? dateTimeInput(new Date(event.start.dateTime), zone)
      : dateTimeInput(initial, zone),
  );
  const [end, setEnd] = useState(
    event?.end.dateTime
      ? dateTimeInput(new Date(event.end.dateTime), zone)
      : dateTimeInput(new Date(initial.getTime() + 3600000), zone),
  );
  const [allDay, setAllDay] = useState(Boolean(event?.start.date));
  const [startDate, setStartDate] = useState(event?.start.date ?? dateKey(initial, zone));
  const [endDate, setEndDate] = useState(
    event?.end.date ?? dateKey(new Date(initial.getTime() + 86400000), zone),
  );
  const [description, setDescription] = useState(event?.description ?? '');
  const [location, setLocation] = useState(event?.location ?? '');
  const [target, setTarget] = useState(event?.calendarId ?? calendarId);
  const [recurrence, setRecurrence] = useState(event?.recurrence?.join('\n') ?? '');
  const [attendees, setAttendees] = useState(event?.attendees?.map((a) => a.email).join(', ') ?? '');
  const [notify, setNotify] = useState(false);
  const [scope, setScope] = useState<'single' | 'series'>('single');
  const [telegramMinutes, setTelegramMinutes] = useState(event?.id ? 'keep' : '');
  const [googleReminder, setGoogleReminder] = useState(event?.id ? 'keep' : 'default');
  useEffect(() => {
    if (!event?.id) return;
    let alive = true;
    void api<Reminder[]>('/reminders')
      .then((rows) => {
        if (alive)
          setTelegramMinutes(
            String(
              rows.find(
                (r) =>
                  r.event?.calendarId === event.calendarId &&
                  r.event.eventId === event.id &&
                  r.state === 'scheduled',
              )?.event?.minutesBefore ?? '',
            ),
          );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [event?.id, event?.calendarId]);
  const [error, setError] = useState('');
  const canEdit = !['reader', 'freeBusyReader'].includes(
    calendars.find((c) => c.id === target)?.accessRole ?? 'owner',
  );
  const changeScope = async (value: 'single' | 'series') => {
    if (!initialEvent?.recurringEventId) {
      setScope(value);
      return;
    }
    setScopeLoading(true);
    setError('');
    try {
      const selected =
        value === 'single'
          ? initialEvent
          : await api<CalendarEvent>(
              '/resources?' +
                new URLSearchParams({
                  kind: 'event',
                  calendarId: initialEvent.calendarId,
                  eventId: initialEvent.recurringEventId,
                }),
            );
      if (!selected?.id || !selected.etag) throw Error('Could not read the current series.');
      setEvent(selected);
      setScope(value);
      setTitle(selected.summary);
      setDescription(selected.description ?? '');
      setLocation(selected.location ?? '');
      setRecurrence(selected.recurrence?.join('\n') ?? '');
      setAttendees(selected.attendees?.map((a) => a.email).join(', ') ?? '');
      setAllDay(!!selected.start.date);
      const selectedZone = selected.start.timeZone ?? ownerZone;
      if (selected.start.dateTime) setStart(dateTimeInput(new Date(selected.start.dateTime), selectedZone));
      if (selected.end.dateTime) setEnd(dateTimeInput(new Date(selected.end.dateTime), selectedZone));
      if (selected.start.date) setStartDate(selected.start.date);
      if (selected.end.date) setEndDate(selected.end.date);
      setTelegramMinutes('keep');
      setGoogleReminder('keep');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setScopeLoading(false);
    }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const body = {
        summary: title,
        description,
        location,
        start: allDay
          ? { date: startDate, timeZone: zone }
          : { dateTime: zonedISO(start, zone), timeZone: zone },
        end: allDay ? { date: endDate, timeZone: zone } : { dateTime: zonedISO(end, zone), timeZone: zone },
        ...(recurrence.trim()
          ? { recurrence: recurrence.trim().split('\n') }
          : event?.recurrence
            ? { recurrence: [] }
            : {}),
        attendees: attendees
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
          .map((email) => {
            const existing = event?.attendees?.find((p) => p.email === email);
            return {
              email,
              ...(existing?.responseStatus ? { responseStatus: existing.responseStatus } : {}),
            };
          }),
        ...(googleReminder === 'keep'
          ? {}
          : {
              reminders:
                googleReminder === 'default'
                  ? { useDefault: true }
                  : {
                      useDefault: false,
                      overrides:
                        googleReminder === ''
                          ? []
                          : [{ method: 'popup' as const, minutes: Number(googleReminder) }],
                    },
            }),
      };
      await save({
        kind: event?.id ? 'event.update' : 'event.create',
        calendarId: target,
        eventId: event?.id || undefined,
        etag: event?.etag,
        event: body,
        scope,
        notify,
        ...(telegramMinutes === 'keep'
          ? {}
          : { telegramReminderMinutes: telegramMinutes === '' ? null : Number(telegramMinutes) }),
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal
      title={event?.id ? 'Edit event' : 'New event'}
      onClose={onClose}
      description="Check dates and the destination calendar. Invitations and series changes require approval."
    >
      <form onSubmit={(e) => void submit(e)} className="editor-form">
        {!canEdit && <p className="notice">This calendar is read-only. You can view event details.</p>}
        {initialEvent?.recurringEventId && (
          <label>
            Change scope
            <select
              value={scope}
              disabled={scopeLoading || busy}
              onChange={(e) => void changeScope(e.target.value as 'single' | 'series')}
            >
              <option value="single">This event only</option>
              <option value="series">Entire series</option>
            </select>
            <small className="muted">
              {scopeLoading
                ? 'Loading current series…'
                : scope === 'series'
                  ? 'Showing the original start and recurrence rule. Changes affect the whole series and require approval.'
                  : 'Other occurrences are not affected.'}
            </small>
          </label>
        )}
        <label>
          Event title
          <input
            autoFocus
            required
            value={title}
            maxLength={500}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What are you planning?"
          />
        </label>
        <label>
          Calendar
          <select value={target} disabled={!!event?.id} onChange={(e) => setTarget(e.target.value)}>
            {calendars.map((c) => (
              <option
                value={c.id}
                key={c.id}
                disabled={!event?.id && ['reader', 'freeBusyReader'].includes(c.accessRole ?? 'owner')}
              >
                {c.summary}
              </option>
            ))}
            {!calendars.length && <option value="primary">Primary calendar</option>}
          </select>
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          All day
        </label>
        <div className="form-grid">
          <label>
            Start
            <input
              type={allDay ? 'date' : 'datetime-local'}
              value={allDay ? startDate : start}
              required
              onChange={(e) => {
                const value = e.target.value;
                if (allDay) {
                  if (endDate <= value)
                    setEndDate(
                      new Date(Date.parse(value + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10),
                    );
                  setStartDate(value);
                } else {
                  const duration = Math.max(15 * 60000, Date.parse(end) - Date.parse(start));
                  setStart(value);
                  if (value && Number.isFinite(duration))
                    setEnd(new Date(Date.parse(value + 'Z') + duration).toISOString().slice(0, 16));
                }
              }}
            />
          </label>
          <label>
            {allDay ? 'End (exclusive)' : 'End'}
            <input
              type={allDay ? 'date' : 'datetime-local'}
              value={allDay ? endDate : end}
              required
              onChange={(e) => (allDay ? setEndDate(e.target.value) : setEnd(e.target.value))}
            />
          </label>
        </div>
        <small className="muted">Time zone: {zone}</small>
        <fieldset className="event-reminders">
          <legend>Reminders</legend>
          <label>
            Notify me on Telegram
            <select value={telegramMinutes} onChange={(e) => setTelegramMinutes(e.target.value)}>
              {telegramMinutes === 'keep' && <option value="keep">Keep current setting</option>}
              <option value="">Off</option>
              {[0, 5, 10, 15, 30, 60, 120, 300, 1440, 2880, 10080].map((m) => (
                <option key={m} value={m}>
                  {m === 0
                    ? 'At start'
                    : m < 60
                      ? `${m} minutes before`
                      : m < 1440
                        ? `${m / 60} hours before`
                        : `${m / 1440} days before`}
                </option>
              ))}
              {telegramMinutes !== '' &&
                telegramMinutes !== 'keep' &&
                ![0, 5, 10, 15, 30, 60, 120, 300, 1440, 2880, 10080].includes(Number(telegramMinutes)) && (
                  <option value={telegramMinutes}>{telegramMinutes} minutes before</option>
                )}
            </select>
          </label>
          <label>
            Google Calendar reminder
            <select value={googleReminder} onChange={(e) => setGoogleReminder(e.target.value)}>
              {event?.id && <option value="keep">Keep current reminders</option>}
              <option value="default">Calendar default</option>
              <option value="">Off</option>
              {[0, 5, 10, 15, 30, 60, 300, 1440].map((m) => (
                <option key={m} value={m}>
                  {m === 0
                    ? 'At start'
                    : m < 60
                      ? `${m} minutes before`
                      : m < 1440
                        ? `${m / 60} hours before`
                        : '1 day before'}
                </option>
              ))}
              {googleReminder !== '' &&
                googleReminder !== 'default' &&
                ![0, 5, 10, 15, 30, 60, 300, 1440].includes(Number(googleReminder)) && (
                  <option value={googleReminder}>{googleReminder} minutes before</option>
                )}
            </select>
          </label>
          <small className="muted">
            The reminder is stored in C.O.R. and follows changes to the event time.
            {allDay ? ' All-day events start at 00:00.' : ''}
          </small>
        </fieldset>
        {!event?.recurringEventId && (
          <label>
            Repeat
            <select
              aria-label="Event recurrence"
              value={
                !recurrence
                  ? 'none'
                  : recurrence === 'RRULE:FREQ=DAILY'
                    ? 'daily'
                    : recurrence === 'RRULE:FREQ=WEEKLY'
                      ? 'weekly'
                      : recurrence === 'RRULE:FREQ=MONTHLY'
                        ? 'monthly'
                        : 'custom'
              }
              onChange={(e) =>
                setRecurrence(
                  e.target.value === 'none'
                    ? ''
                    : e.target.value === 'custom'
                      ? recurrence || 'RRULE:FREQ=WEEKLY'
                      : `RRULE:FREQ=${e.target.value.toUpperCase()}`,
                )
              }
            >
              <option value="none">Does not repeat</option>
              <option value="daily">Every day</option>
              <option value="weekly">Every week</option>
              <option value="monthly">Every month</option>
              <option value="custom">Custom rule</option>
            </select>
          </label>
        )}
        <label>
          Location
          <input value={location} onChange={(e) => setLocation(e.target.value)} />
        </label>
        <label>
          Notes
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </label>
        <details className="advanced-fields">
          <summary>Recurrence and guests</summary>
          <label>
            Recurrence rule
            <textarea
              placeholder="RRULE:FREQ=WEEKLY;BYDAY=MO"
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value)}
              rows={2}
            />
          </label>
          <label>
            Guests (comma-separated emails)
            <input value={attendees} onChange={(e) => setAttendees(e.target.value)} />
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            Notify guests
          </label>
        </details>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <footer className="editor-footer">
          {event?.id && (
            <button
              type="button"
              className="icon-button danger"
              aria-label="Delete event"
              disabled={busy || scopeLoading || !canEdit}
              onClick={() =>
                void save({
                  kind: 'event.delete',
                  calendarId: target,
                  eventId: event.id,
                  etag: event.etag,
                  scope,
                  notify,
                }).catch((e) => setError(e.message))
              }
            >
              <Trash size={20} />
            </button>
          )}
          <button type="button" className="button subtle" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy || scopeLoading || !canEdit} type="submit">
            {busy ? <Spinner className="spin" size={17} /> : <Check size={17} />}Save
          </button>
        </footer>
      </form>
    </Modal>
  );
}
function RoutineEditor({
  routine,
  zone,
  busy,
  onClose,
  save,
}: {
  routine: Routine | null;
  zone: string;
  busy: boolean;
  onClose: () => void;
  save: (a: OperationInput) => Promise<void>;
}) {
  const [name, setName] = useState(routine?.name ?? '');
  const [kind, setKind] = useState<RoutineInput['kind']>(routine?.kind ?? 'daily_summary');
  const [cron, setCron] = useState(routine?.cron ?? '0 8 * * *');
  const [timeZone, setZone] = useState(routine?.timeZone ?? zone);
  const [enabled, setEnabled] = useState(routine?.enabled ?? false);
  const [message, setMessage] = useState(routine?.message ?? '');
  const [next, setNext] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(() => {
      api<{ nextRun: string }>(
        '/routines/preview',
        {
          name: name || 'Preview',
          kind,
          cron,
          timeZone,
          enabled,
          ...(kind === 'reminder' && message.trim() ? { message: message.trim() } : {}),
        },
        'POST',
        undefined,
        abort.signal,
      )
        .then((r) => {
          setNext(r.nextRun);
          setError('');
        })
        .catch((e) => {
          if (e.name !== 'AbortError') {
            setNext('');
            setError(e.message);
          }
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [name, kind, cron, timeZone, enabled, message]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await save({
        kind: routine ? 'routine.update' : 'routine.create',
        routineId: routine?.id,
        version: routine?.version,
        routine: {
          name,
          kind,
          cron,
          timeZone,
          enabled,
          ...((kind === 'reminder' || kind.startsWith('ai_')) && message.trim()
            ? { message: message.trim() }
            : {}),
        },
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal
      title={routine ? 'Edit routine' : 'New routine'}
      onClose={onClose}
      description="Schedules run on the server while your browser is closed."
    >
      <form className="editor-form" onSubmit={(e) => void submit(e)}>
        <label>
          Routine name
          <input required autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={160} />
        </label>
        <label>
          Action
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            {Object.entries(kindNames).map(([k, v]) => (
              <option value={k} key={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Schedule
          <select
            aria-label="Schedule"
            onChange={(e) => {
              if (e.target.value) setCron(e.target.value);
            }}
            value={['0 7 * * *', '0 8 * * *', '0 18 * * 0', '*/30 * * * *'].includes(cron) ? cron : ''}
          >
            <option value="0 7 * * *">Daily at 07:00</option>
            <option value="0 8 * * *">Daily at 08:00</option>
            <option value="0 18 * * 0">Sundays at 18:00</option>
            <option value="*/30 * * * *">Every 30 minutes</option>
            <option value="">Custom schedule</option>
          </select>
        </label>
        <div className="form-grid">
          <label>
            Cron expression
            <input required value={cron} onChange={(e) => setCron(e.target.value)} />
          </label>
          <label>
            Time zone
            <input required value={timeZone} onChange={(e) => setZone(e.target.value)} />
          </label>
        </div>
        {(kind === 'reminder' || kind.startsWith('ai_')) && (
          <label>
            {kind === 'reminder' ? 'Reminder message' : 'Briefing focus (optional)'}
            <textarea
              required={kind === 'reminder'}
              maxLength={1000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={
                kind === 'reminder' ? 'Example: Good night.' : 'Example: Highlight busy days and conflicts.'
              }
              rows={2}
            />
          </label>
        )}
        <div className="routine-execution-note">
          <strong>{kind.startsWith('ai_') ? 'Uses the assistant' : 'Runs without an LLM'}</strong>
          <p>
            {kind.startsWith('ai_')
              ? 'At run time the assistant reads current records and produces a briefing. Each run uses your model quota. Weekly briefings cover next Monday through Sunday.'
              : 'The scheduler runs this directly. No LLM tokens are used.'}
            {kind === 'reminder'
              ? ' Reminders appear in the open workspace and are sent through Telegram when connected. Native phone notifications are not available.'
              : ''}
          </p>
        </div>
        <small className="muted">Minute · hour · day of month · month · day of week</small>
        <label className="checkbox-label">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enable this routine
        </label>
        {next && (
          <div className="preview-note">
            <Clock size={18} />
            <span>
              {enabled ? 'Next run' : 'When enabled'}
              <strong>{formatDate(next, timeZone)}</strong>
            </span>
          </div>
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <footer className="editor-footer">
          {routine && (
            <>
              <button
                type="button"
                className="icon-button danger"
                aria-label="Delete routine"
                disabled={busy}
                onClick={() =>
                  void save({
                    kind: 'routine.delete',
                    routineId: routine.id,
                    version: routine.version,
                  }).catch((e) => setError(e.message))
                }
              >
                <Trash size={19} />
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() =>
                  void save({ kind: 'routine.run', routineId: routine.id, version: routine.version }).catch(
                    (e) => setError(e.message),
                  )
                }
              >
                <Play size={16} />
                Run now
              </button>
            </>
          )}
          <button className="button primary" disabled={busy || !next} type="submit">
            <Check size={17} />
            Save
          </button>
        </footer>
      </form>
    </Modal>
  );
}
function Settings({
  s,
  connect,
  refreshSession,
  perform,
  advanced,
}: {
  s: Session;
  connect: () => Promise<void>;
  refreshSession: () => Promise<void>;
  perform: (a: OperationInput) => Promise<unknown>;
  advanced: () => void;
}) {
  const [zone, setZone] = useState(s.preferences.timeZone);
  const [note, setNote] = useState('');
  return (
    <div className="settings-list">
      <article className="setting-row">
        <span className="setting-icon">
          <CalendarBlank size={24} />
        </span>
        <div>
          <h3>Google Calendar</h3>
          <p>
            {s.demo
              ? 'Demo mode. Configure a persistent installation for live connections.'
              : s.googleConnected
                ? 'Your calendar is connected. Actions apply to your Google account.'
                : "Connect through Google's secure authorization page."}
          </p>
        </div>
        <button className="button subtle" disabled={s.demo} onClick={() => void connect()}>
          {s.googleConnected ? 'Reconnect' : 'Connect account'}
          <ArrowRight size={15} />
        </button>
      </article>
      <article className="setting-row">
        <span className="setting-icon">
          <ChatCircle size={24} />
        </span>
        <div>
          <h3>Conversation history</h3>
          <p>Your conversation is saved. Ask about earlier messages to search the archive.</p>
          <small>
            The assistant retrieves recent and relevant earlier messages without resending the full archive.
          </small>
        </div>
        <span className="pill green">Persistent</span>
      </article>
      <article className="setting-row">
        <span className="setting-icon">
          <Clock size={24} />
        </span>
        <div>
          <h3>Time zone</h3>
          <p>Time zone for new requests. Existing routines keep their own time zone.</p>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              void perform({ kind: 'preferences.update', timeZone: zone, language: s.preferences.language })
                .then(() => {
                  setNote('Change queued. Refresh preferences after it completes.');
                })
                .catch((e) => setNote(e.message));
            }}
          >
            <input aria-label="Time zone" value={zone} onChange={(e) => setZone(e.target.value)} />
            <button className="button subtle">Save</button>
            <button className="text-button" type="button" onClick={() => void refreshSession()}>
              Refresh preferences
            </button>
          </form>
          {note && <small role="status">{note}</small>}
        </div>
      </article>
      <article className="setting-row">
        <span className="setting-icon">
          <ChatCircle size={24} />
        </span>
        <div>
          <h3>Telegram and voice commands</h3>
          <p>
            {s.telegram?.enabled
              ? 'Telegram text and voice commands use the same action controls. Fixed notifications run without an LLM.'
              : 'Configure your bot token, owner ID and allowed groups in Telegram settings.'}
          </p>
          <small>
            Transcription:{' '}
            {s.telegram?.voiceEnabled ? 'Local model configured; verify with a recording' : 'Setup pending'}.
            Recognized voice requests run directly; sensitive actions require approval.
          </small>
          {s.telegram?.status.message && <p className="error-text">{s.telegram.status.message}</p>}
          {s.telegram?.delivery?.error && (
            <p className="error-text">
              Last delivery: {s.telegram.delivery.error} Start a conversation with the bot and check your
              connection.
            </p>
          )}
        </div>
        <span className={'pill ' + (s.telegram?.status.state === 'connected' ? 'green' : '')}>
          {s.telegram?.status.state === 'connected'
            ? 'Connected'
            : s.telegram?.enabled
              ? 'Check connection'
              : 'Off'}
        </span>
      </article>
      <article className="setting-row">
        <span className="setting-icon">
          <ShieldCheck size={24} />
        </span>
        <div>
          <h3>Security and access</h3>
          <p>
            {s.demo
              ? 'Local development session. Production configuration is required before internet exposure.'
              : 'Owner identity and the secure application session are verified.'}
          </p>
          <small>Owner: {s.owner} · Sensitive actions require approval matching their content.</small>
        </div>
      </article>
      <article className="setting-row">
        <span className="setting-icon">
          <Code size={24} />
        </span>
        <div>
          <h3>Advanced calendar management</h3>
          <p>Structured operations for calendars, sharing, recurring series and event moves.</p>
        </div>
        <button className="button subtle" onClick={advanced}>
          Open editor
          <ArrowRight size={15} />
        </button>
      </article>
    </div>
  );
}
function Advanced({
  onClose,
  save,
  calendarId,
}: {
  onClose: () => void;
  save: (a: OperationInput) => Promise<unknown>;
  calendarId: string;
}) {
  const templates: Record<string, unknown> = {
    'Create calendar': { kind: 'calendar.create', summary: 'New calendar', timeZone: 'Europe/Istanbul' },
    'Clear calendar': { kind: 'calendar.clear', calendarId },
    'Share calendar': { kind: 'sharing.set', calendarId, email: '', role: 'reader' },
    'Remove access': { kind: 'sharing.delete', calendarId, ruleId: '', etag: '' },
    'Move event': {
      kind: 'event.move',
      calendarId,
      eventId: '',
      etag: '',
      destination: '',
      scope: 'single',
      notify: false,
    },
    'Delete series from this date': {
      kind: 'event.delete',
      calendarId,
      eventId: '',
      etag: '',
      scope: 'following',
      instanceStart: '',
      notify: false,
    },
    'Respond to invitation': {
      kind: 'event.respond',
      calendarId,
      eventId: '',
      etag: '',
      scope: 'single',
      response: 'accepted',
      notify: true,
    },
  };
  const [value, setValue] = useState(JSON.stringify(templates['Create calendar'], null, 2));
  const [error, setError] = useState('');
  const [acl, setAcl] = useState<unknown>();
  const [resourceKind, setResourceKind] = useState('calendar');
  const [resourceId, setResourceId] = useState('');
  return (
    <Modal
      title="Advanced action editor"
      description="The server validates every field. Sensitive actions appear for approval before execution."
      onClose={onClose}
    >
      <form
        className="editor-form"
        onSubmit={(e) => {
          e.preventDefault();
          void (async () => {
            try {
              await save(JSON.parse(value));
              onClose();
            } catch (e) {
              setError((e as Error).message);
            }
          })();
        }}
      >
        <label>
          Action template
          <select onChange={(e) => setValue(JSON.stringify(templates[e.target.value], null, 2))}>
            {Object.keys(templates).map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <label>
          Action content
          <textarea
            className="code-input"
            rows={14}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <div className="form-grid">
          <label>
            View source
            <select value={resourceKind} onChange={(e) => setResourceKind(e.target.value)}>
              <option value="calendar">Calendar and ETag</option>
              <option value="event">Event / parent series</option>
              <option value="instances">Series occurrences</option>
              <option value="settings">Google Calendar settings</option>
              <option value="colors">Colors</option>
            </select>
          </label>
          <label>
            Event / parent series ID
            <input
              value={resourceId}
              onChange={(e) => setResourceId(e.target.value)}
              placeholder="Required for live event operations"
            />
          </label>
        </div>
        <button
          className="text-button"
          type="button"
          onClick={() =>
            void api(
              '/resources?' +
                new URLSearchParams({
                  kind: resourceKind,
                  calendarId,
                  ...(resourceId ? { eventId: resourceId } : {}),
                }),
            )
              .then(setAcl)
              .catch((e) => setError(e.message))
          }
        >
          Read current resource <DownloadSimple size={16} />
        </button>
        <button
          className="text-button"
          type="button"
          onClick={() =>
            void api('/sharing?' + new URLSearchParams({ calendarId }))
              .then(setAcl)
              .catch((e) => setError(e.message))
          }
        >
          Read selected calendar sharing <DownloadSimple size={16} />
        </button>
        {acl !== undefined && <pre>{JSON.stringify(acl, null, 2)}</pre>}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <footer className="editor-footer">
          <button className="button primary" type="submit">
            Prepare action
            <ArrowRight size={17} />
          </button>
        </footer>
      </form>
    </Modal>
  );
}
