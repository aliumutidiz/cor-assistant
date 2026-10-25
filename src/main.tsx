import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import './styles.css';
import { App } from './App';
import { applyTheme } from './ThemeControl';
applyTheme();
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
