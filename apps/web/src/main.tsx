import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './staff-layout-notification-ux.css';

// Apply desktop-only viewport rules inside the Tauri WebView; browser layouts remain unchanged.
if ('__TAURI_INTERNALS__' in window) {
  document.documentElement.classList.add('tauri-desktop');
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
