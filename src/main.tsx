import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { rehydrate } from './lib/store';

rehydrate();

// PWA: service worker работает только по HTTPS (или localhost).
// По обычному http://192.168.х.х регистрация молча пропускается — интерфейс при этом полностью работоспособен.
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* офлайн-оболочка необязательна — не роняем приложение */
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
