import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyThemePreference, readThemePreference } from './lib/theme';
import './styles/index.css';

applyThemePreference(readThemePreference());

const root = document.getElementById('root');
if (!root) throw new Error('index.html is missing #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
