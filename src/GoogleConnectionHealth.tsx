import { useEffect, useState } from 'react';
import { api } from './api';
type Status = { state: string; checkedAt?: string; message?: string; refreshExpiresAt?: string };
export function GoogleConnectionHealth({ connect }: { connect: () => Promise<void> }) {
  const [status, setStatus] = useState<Status>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const read = () => api<Status>('/google/status').then(setStatus);
  useEffect(() => {
    void read().catch((e) => setError(e.message));
  }, []);
  async function check() {
    setBusy(true);
    setError('');
    try {
      await api('/google/check', {});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      await read().catch(() => {});
      setBusy(false);
    }
  }
  return (
    <section className="profile-settings">
      <h2>Google connection health</h2>
      <p role="status">{status?.state.replaceAll('_', ' ') ?? 'Checking saved connection…'}</p>
      {status?.message && <p>{status.message}</p>}
      {status?.refreshExpiresAt && (
        <p>Google authorization expires: {new Date(status.refreshExpiresAt).toLocaleString()}</p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="form-actions">
        <button className="button subtle" disabled={busy} onClick={() => void check()}>
          Check connection
        </button>
        {['reauthorization_required', 'not_connected'].includes(status?.state ?? '') && (
          <button className="button primary" onClick={() => void connect()}>
            Reconnect Google
          </button>
        )}
      </div>
      <details>
        <summary>Disconnecting every week?</summary>
        <p>
          In Google Cloud → Google Auth Platform → Audience, check whether the app is in Testing. Calendar
          refresh tokens issued in Testing can expire after seven days. Change the publishing status to In
          production, then reconnect Calendar once. Your C.O.R. workspace remains private; access is still
          restricted to the owner and invited accounts.
        </p>
        <p>
          Google may still revoke authorization. C.O.R. renews short-lived access tokens automatically but
          cannot guarantee an unlimited Google authorization.
        </p>
        <a href="https://console.cloud.google.com/auth/audience" target="_blank" rel="noopener noreferrer">
          Open Google Auth Platform
        </a>
      </details>
    </section>
  );
}
