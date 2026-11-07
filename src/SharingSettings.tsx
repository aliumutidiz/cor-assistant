import { useEffect, useState } from 'react';
import { api } from './api';
type Member = { id: string; email: string; role: 'viewer' | 'editor'; createdAt: string };
export function SharingSettings() {
  const [items, setItems] = useState<Member[]>([]),
    [email, setEmail] = useState(''),
    [role, setRole] = useState<'viewer' | 'editor'>('viewer');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  const load = async () => {
    setItems(await api<Member[]>('/workspace/members'));
    setLoaded(true);
  };
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  async function change(id?: string) {
    setBusy(true);
    setError('');
    try {
      if (id) await api('/workspace/members/' + id, {}, 'DELETE');
      else {
        await api('/workspace/members', { email: email.trim(), role });
        setEmail('');
      }
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="profile-settings">
      <h2>Shared access</h2>
      <p className="muted">
        Invite a trusted person to this workspace using their Google account. They use your connected calendar
        without receiving its credentials.
      </p>
      <p>
        Invited people can see workspace records, routines and shared conversation history. Editors can make
        normal changes and chat with the assistant. Only you manage connections, access, owner preferences and
        sensitive approvals.
      </p>
      {error && <p role="alert">{error}</p>}
      <form
        className="memory-form"
        onSubmit={(e) => {
          e.preventDefault();
          void change();
        }}
      >
        <label>
          Google account email
          <input
            type="email"
            required
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Permission
          <select
            aria-label="Permission"
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
          >
            <option value="viewer">View only</option>
            <option value="editor">View and edit</option>
          </select>
        </label>
        <button className="button primary" disabled={busy}>
          Allow this account
        </button>
      </form>
      {loaded && !items.length && <p className="muted">No invited accounts.</p>}
      {items.map((item) => (
        <div className="today-task" key={item.id}>
          <div>
            <strong>{item.email}</strong>
            <p className="muted">{item.role === 'editor' ? 'View and edit' : 'View only'}</p>
          </div>
          <button className="text-button" disabled={busy} onClick={() => void change(item.id)}>
            Revoke access
          </button>
        </div>
      ))}
      <p className="muted">
        No invitation email is sent. Share your site's address; the invited person signs in with the exact
        account listed here. Revoking access blocks new requests and pending edits. Information already viewed
        or downloaded cannot be recalled.
      </p>
    </section>
  );
}
