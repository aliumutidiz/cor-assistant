import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { ChatMessage } from '../shared/chat-messages';
import type { ConversationState } from '../shared/chat-controls';
export type ChatSnapshot = { context: ConversationState; messages: ChatMessage[] };
export function useChatSync(
  enabled: boolean,
  owner: string | undefined,
  onSnapshot: (snapshot: ChatSnapshot) => void,
) {
  const [failed, setFailed] = useState(false);
  const receive = useRef(onSnapshot);
  receive.current = onSnapshot;
  useEffect(() => {
    if (!enabled || !owner) return;
    let running = false,
      closed = false;
    const abort = new AbortController();
    const refresh = async () => {
      if (running || closed || document.visibilityState === 'hidden') return;
      running = true;
      try {
        const snapshot = await api<ChatSnapshot>(
          '/chat/snapshot',
          undefined,
          'GET',
          undefined,
          AbortSignal.any([abort.signal, AbortSignal.timeout(12000)]),
        );
        if (
          !closed &&
          snapshot?.context &&
          Number.isInteger(snapshot.context.version) &&
          Array.isArray(snapshot.messages)
        ) {
          setFailed(false);
          receive.current(snapshot);
        }
      } catch {
        if (!closed && !abort.signal.aborted) setFailed(true);
        /* Preserve readable history through a temporary outage; next focus/tick retries. */
      } finally {
        running = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    const focus = () => void refresh();
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    window.addEventListener('cor:chat-refresh', focus);
    return () => {
      closed = true;
      abort.abort();
      clearInterval(timer);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', focus);
      window.removeEventListener('cor:chat-refresh', focus);
    };
  }, [enabled, owner]);
  return failed;
}
