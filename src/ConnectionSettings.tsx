import { useEffect, useState } from 'react';
import { api, type Session } from './api';
import type { TelegramSettingsView } from '../shared/connections';

export function ConnectionSettings({
  session,
  refresh,
  section,
}: {
  session: Session;
  refresh: () => Promise<void>;
  section?: string;
}) {
  const [telegram, setTelegram] = useState<TelegramSettingsView>();
  const [research, setResearch] = useState<{ enabled: boolean; endpoint: string }>();
  const [token, setToken] = useState(''),
    [owner, setOwner] = useState(''),
    [groups, setGroups] = useState('');
  const [selectedTab, setTab] = useState('setup'),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const tab = section ?? selectedTab;
  useEffect(() => {
    const abort = new AbortController();
    void Promise.all([
      api<TelegramSettingsView>('/settings/telegram', undefined, 'GET', undefined, abort.signal),
      api<{ enabled: boolean; endpoint: string }>(
        '/settings/research',
        undefined,
        'GET',
        undefined,
        abort.signal,
      ),
    ])
      .then(([tg, web]) => {
        setTelegram(tg);
        setResearch(web);
        setOwner(tg.ownerId ? String(tg.ownerId) : '');
        setGroups(tg.chatIds.join(', '));
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, []);
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="connection-settings">
      {!section && (
        <nav className="settings-tabs" aria-label="Connections">
          {[
            ['setup', 'Setup'],
            ['telegram', 'Telegram'],
            ['research', 'Research'],
          ].map(([id, label]) => (
            <button
              key={id}
              className={'button ' + (tab === id ? 'primary' : 'subtle')}
              aria-pressed={tab === id}
              onClick={() => {
                setTab(id);
                setNotice('');
              }}
            >
              {label}
            </button>
          ))}
        </nav>
      )}
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {tab === 'setup' && (
        <div className="setup-checklist">
          <h2>Setup status</h2>
          <p className="muted">Connect the services you need. Optional connections are independent.</p>
          <ol>
            <li>
              <strong>Account</strong>
              <span>
                {session.owner} · {session.demo ? 'Temporary demo data' : 'Persistent installation'}
              </span>
            </li>
            <li>
              <strong>Google Calendar</strong>
              <span>
                {session.googleConnected ? 'Connected' : 'Connect your account in the Calendar section.'}
              </span>
            </li>
            <li>
              <strong>Assistant</strong>
              <span>
                {session.agyEnabled
                  ? 'Connection enabled; session status appears below.'
                  : 'Install AGY and verify its session on the server.'}
              </span>
            </li>
            <li>
              <strong>Telegram</strong>
              <span>
                {telegram?.enabled
                  ? 'Enabled · test the connection in Telegram settings.'
                  : 'Optional · configure your bot and allowed destinations.'}
              </span>
            </li>
            <li>
              <strong>Web research</strong>
              <span>
                {research?.enabled
                  ? 'Enabled · test the connection in Research settings.'
                  : 'Optional · connect a SearXNG instance.'}
              </span>
            </li>
            <li>
              <strong>Profile</strong>
              <span>
                Choose Owner profile in Memory or describe your preferences in chat. Programs and lists are
                stored there too.
              </span>
            </li>
          </ol>
          <a className="button subtle" href="/api/brain/export" download>
            Export personal records
          </a>
          <p className="muted small">
            This export is not a database backup. Credentials, conversation history and previous revisions are
            excluded.
          </p>
        </div>
      )}
      {tab === 'telegram' && telegram && (
        <form
          className="memory-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const chatIds = groups
                .split(',')
                .map((id) => id.trim())
                .filter(Boolean)
                .map(Number);
              if (
                chatIds.some((id) => !Number.isSafeInteger(id) || id >= 0) ||
                (owner && (!Number.isSafeInteger(Number(owner)) || Number(owner) <= 0))
              )
                throw new Error('The user ID must be positive and group IDs must be negative integers.');
              const saved = await api<TelegramSettingsView>(
                '/settings/telegram',
                {
                  enabled: telegram.enabled,
                  ownerId: owner ? Number(owner) : null,
                  chatIds,
                  notificationChatId: telegram.notificationChatId,
                  ...(token ? { token } : {}),
                },
                'PUT',
              );
              setTelegram(saved);
              setToken('');
              setNotice('Saved. Telegram will reconnect within a few seconds.');
              await refresh();
            });
          }}
        >
          <h2>Telegram connection</h2>
          <label>
            <input
              type="checkbox"
              checked={telegram.enabled}
              onChange={(e) => setTelegram({ ...telegram, enabled: e.target.checked })}
            />{' '}
            Telegram enabled
          </label>
          <label>
            Bot token {telegram.tokenConfigured && '· saved'}
            <input
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              value={token}
              maxLength={200}
              placeholder={
                telegram.tokenConfigured ? 'Leave empty to keep the current value' : 'BotFather token'
              }
              onChange={(e) => setToken(e.target.value)}
            />
          </label>
          <label>
            Allowed owner user ID
            <input inputMode="numeric" value={owner} onChange={(e) => setOwner(e.target.value)} />
          </label>
          <label>
            Allowed group IDs (comma-separated)
            <input
              value={groups}
              onChange={(e) => setGroups(e.target.value)}
              placeholder="Leave empty for private chat only"
            />
          </label>
          <label>
            Destination for reminders and routine messages
            <select
              value={telegram.notificationChatId ?? ''}
              onChange={(e) =>
                setTelegram({
                  ...telegram,
                  notificationChatId: e.target.value ? Number(e.target.value) : null,
                })
              }
            >
              <option value="">Private chat (when group mode is off)</option>
              {groups
                .split(',')
                .map((id) => id.trim())
                .filter((id) => /^-\d+$/.test(id))
                .map((id) => (
                  <option value={id} key={id}>
                    {id}
                  </option>
                ))}
            </select>
          </label>
          <p className="muted small">
            Only the allowed owner can issue commands, including in groups. Tokens are encrypted and never
            returned. Changing connections can interrupt active conversations.
          </p>
          <div className="form-actions">
            <button className="button primary" disabled={busy || session.demo}>
              Save
            </button>
            <button
              type="button"
              className="button subtle"
              disabled={busy || !telegram.tokenConfigured}
              onClick={() =>
                void run(async () => {
                  const result = await api<{ username?: string }>('/settings/telegram/check', {});
                  setNotice('Bot connection verified' + (result.username ? ': @' + result.username : '.'));
                })
              }
            >
              Test saved connection
            </button>
          </div>
        </form>
      )}
      {tab === 'research' && research && (
        <form
          className="memory-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              setResearch(await api('/settings/research', research, 'PUT'));
              setNotice('Research settings saved.');
            });
          }}
        >
          <h2>Web research</h2>
          <p className="muted">
            Connect your own SearXNG instance with JSON output enabled. Enabling this option does not install
            the service.
          </p>
          <label>
            <input
              type="checkbox"
              checked={research.enabled}
              onChange={(e) => setResearch({ ...research, enabled: e.target.checked })}
            />{' '}
            Web research enabled
          </label>
          <label>
            SearXNG base URL
            <input
              type="url"
              value={research.endpoint}
              placeholder="http://127.0.0.1:8088/"
              onChange={(e) => setResearch({ ...research, endpoint: e.target.value })}
              maxLength={2048}
            />
          </label>
          <p className="muted small">
            Use a local loopback search service or a public HTTP/HTTPS endpoint. Source pages cannot access
            private networks. Queries are sent to your chosen search service and its engines.
          </p>
          <div className="form-actions">
            <button className="button primary" disabled={busy}>
              Save
            </button>
            <button
              type="button"
              className="button subtle"
              disabled={busy || !research.enabled}
              onClick={() =>
                void run(async () => {
                  await api('/settings/research/check', {});
                  setNotice('Search service verified with a JSON response.');
                })
              }
            >
              Test saved connection
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
