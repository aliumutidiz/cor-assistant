import { useEffect, useState } from 'react';
import { Moon, Sun, Desktop } from '@phosphor-icons/react';
type Theme = 'system' | 'light' | 'dark';
let sessionTheme: Theme | undefined;
function savedTheme(): Theme {
  if (sessionTheme) return sessionTheme;
  try {
    const value = localStorage.getItem('cor.theme');
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}
export function applyTheme() {
  const value = savedTheme();
  document.documentElement.dataset.theme =
    value === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : value;
}
export function ThemeControl() {
  const [theme, setTheme] = useState<Theme>(savedTheme);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const refresh = (event: Event) => {
      if (event.type === 'storage') sessionTheme = undefined;
      setTheme(savedTheme());
      applyTheme();
    };
    media.addEventListener('change', refresh);
    window.addEventListener('cor:theme-changed', refresh);
    window.addEventListener('storage', refresh);
    applyTheme();
    return () => {
      media.removeEventListener('change', refresh);
      window.removeEventListener('cor:theme-changed', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Desktop;
  return (
    <button
      className="icon-button theme-control"
      title={'Theme: ' + theme + ' · switch'}
      aria-label={'Theme: ' + theme + '. Switch theme'}
      onClick={() => {
        const value = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
        sessionTheme = value;
        try {
          localStorage.setItem('cor.theme', value);
        } catch {
          /* The theme still works in this session. */
        }
        setTheme(value);
        document.documentElement.dataset.theme =
          value === 'system'
            ? matchMedia('(prefers-color-scheme: dark)').matches
              ? 'dark'
              : 'light'
            : value;
        window.dispatchEvent(new Event('cor:theme-changed'));
      }}
    >
      <Icon size={19} />
      <span>{theme}</span>
    </button>
  );
}
