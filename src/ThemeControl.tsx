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
  const options = [
    { value: 'light', label: 'Light theme', icon: Sun },
    { value: 'dark', label: 'Dark theme', icon: Moon },
    { value: 'system', label: 'Use device theme', icon: Desktop },
  ] as const;
  return (
    <div className="theme-selector" role="group" aria-label="Appearance">
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={theme === value}
          onClick={() => {
            sessionTheme = value;
            try {
              localStorage.setItem('cor.theme', value);
            } catch {
              /* Session-only preference remains available. */
            }
            setTheme(value);
            applyTheme();
            window.dispatchEvent(new Event('cor:theme-changed'));
          }}
        >
          <Icon size={19} />
        </button>
      ))}
    </div>
  );
}
