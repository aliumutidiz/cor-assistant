import { useState, type ReactNode, type FormEvent } from 'react';
import type { Session } from './api';
import type { OperationInput } from '../shared/contracts';
import { ThemeControl } from './ThemeControl';

export function ProfileSettings({
  session,
  perform,
  refresh,
}: {
  session: Session;
  perform: (action: OperationInput) => Promise<unknown>;
  refresh: () => Promise<void>;
}) {
  const [name, setName] = useState(session.preferences.displayName ?? '');
  const [language, setLanguage] = useState<'en' | 'tr'>(session.preferences.language);
  const [style, setStyle] = useState<'concise' | 'balanced' | 'detailed'>(
    session.preferences.communicationStyle ?? 'balanced',
  );
  const [zone, setZone] = useState(session.preferences.timeZone);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await perform({
        kind: 'preferences.update',
        timeZone: zone,
        language,
        displayName: name.trim(),
        communicationStyle: style,
        onboarded: true,
      });
      await refresh();
      setNotice('Profile saved. Your assistant will use these preferences in future replies.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="profile-settings">
      <h2>Your profile</h2>
      <p className="muted">
        A few preferences help C.O.R. get to know you. You can change them here or in conversation.
      </p>
      <form className="memory-form" onSubmit={save}>
        <label>
          What should I call you?{' '}
          <input
            maxLength={80}
            autoComplete="nickname"
            value={name}
            placeholder="Your name (optional)"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="form-grid">
          <label>
            Assistant reply language
            <select value={language} onChange={(e) => setLanguage(e.target.value as 'en' | 'tr')}>
              <option value="en">English</option>
              <option value="tr">Türkçe</option>
            </select>
          </label>
          <label>
            Reply style
            <select value={style} onChange={(e) => setStyle(e.target.value as typeof style)}>
              <option value="concise">Concise</option>
              <option value="balanced">Balanced</option>
              <option value="detailed">Detailed</option>
            </select>
          </label>
        </div>
        <label>
          Time zone
          <input
            required
            value={zone}
            onChange={(e) => setZone(e.target.value)}
            placeholder="Europe/London"
          />
        </label>
        <p className="muted small">
          Existing routines keep their own time zone. A language request in an individual conversation takes
          priority.
        </p>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <button disabled={busy} className="button primary">
          {busy ? 'Saving…' : 'Save profile'}
        </button>
      </form>
      <div className="appearance-setting">
        <div>
          <h3>Appearance</h3>
          <p className="muted">Light, dark, or follow your device. Saved in this browser.</p>
        </div>
        <ThemeControl />
      </div>
    </section>
  );
}

const tabs = [
  ['profile', 'Profile & appearance'],
  ['setup', 'Connections overview'],
  ['account', 'Calendar & security'],
  ['assistant', 'Assistant session'],
  ['telegram', 'Telegram'],
  ['research', 'Web research'],
  ['voice', 'Voice'],
] as const;
export function SettingsWorkspace({
  profile,
  connections,
  account,
  assistant,
  voice,
  signOut,
}: {
  profile: ReactNode;
  connections: (section: string) => ReactNode;
  account: ReactNode;
  assistant: ReactNode;
  voice: ReactNode;
  signOut?: () => Promise<void>;
}) {
  const [tab, setTab] = useState<string>('profile');
  return (
    <div className="settings-workspace">
      <nav className="settings-navigation" aria-label="Settings sections">
        {tabs.map(([id, label]) => (
          <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
        {signOut && (
          <button className="settings-signout" onClick={() => void signOut()}>
            Sign out
          </button>
        )}
      </nav>
      <div className="settings-content" key={tab}>
        {tab === 'profile'
          ? profile
          : tab === 'account'
            ? account
            : tab === 'assistant'
              ? assistant
              : tab === 'voice'
                ? voice
                : connections(tab)}
      </div>
    </div>
  );
}
