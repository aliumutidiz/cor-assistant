import { useEffect, useRef } from 'react';
import { containsCredential } from '../shared/sensitive';
/** Tab-local, owner-scoped recovery; never writes draft text to persistent localStorage. */
export function useChatDraft(owner: string | undefined, text: string, setText: (value: string) => void) {
  const loaded = useRef<string | undefined>(undefined);
  const skip = useRef(false);
  useEffect(() => {
    if (!owner) return;
    const key = 'cor.draft:' + owner;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const saved = JSON.parse(raw);
        if (
          typeof saved.text === 'string' &&
          saved.text.length <= 6000 &&
          typeof saved.at === 'number' &&
          Date.now() - saved.at < 86400000 &&
          !containsCredential(saved.text)
        ) {
          setText(saved.text);
          skip.current = true;
        } else sessionStorage.removeItem(key);
      }
    } catch {
      /* Storage may be disabled. */
    }
    loaded.current = owner;
    return () => {
      loaded.current = undefined;
    };
  }, [owner, setText]);
  useEffect(() => {
    if (!owner || loaded.current !== owner) return;
    if (skip.current) {
      skip.current = false;
      return;
    }
    try {
      const key = 'cor.draft:' + owner;
      if (!text || containsCredential(text)) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, JSON.stringify({ text, at: Date.now() }));
    } catch {
      /* Sending still works without draft storage. */
    }
  }, [owner, text]);
}
