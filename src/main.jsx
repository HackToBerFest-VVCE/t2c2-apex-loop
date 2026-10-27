import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { API_BASE } from './lib/api.js';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Makes the website installable. Off during development and in the Android app (which has its own files).
if (import.meta.env.PROD && !API_BASE && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('[CivicLens] service worker failed', err));
  });
}
