import { useCallback, useEffect, useRef, useState } from 'react';
const pages = [
  'today',
  'assistant',
  'calendar',
  'routines',
  'reminders',
  'memories',
  'programs',
  'history',
  'settings',
] as const;
export type WorkspacePage = (typeof pages)[number];
function currentPage(): WorkspacePage {
  const candidate = window.location.hash.slice(1);
  return (pages as readonly string[]).includes(candidate) ? (candidate as WorkspacePage) : 'calendar';
}
/** Section navigation participates in browser Back/Forward without loading the application again. */
export function useWorkspacePage() {
  const [page, setCurrentPage] = useState(currentPage);
  const current = useRef(page);
  useEffect(() => {
    const restore = () => {
      const next = currentPage();
      current.current = next;
      setCurrentPage(next);
    };
    window.addEventListener('popstate', restore);
    window.addEventListener('hashchange', restore);
    return () => {
      window.removeEventListener('popstate', restore);
      window.removeEventListener('hashchange', restore);
    };
  }, []);
  const navigate = useCallback((next: WorkspacePage) => {
    if (current.current === next) return;
    window.history.pushState(null, '', '#' + next);
    current.current = next;
    setCurrentPage(next);
  }, []);
  return [page, navigate] as const;
}
