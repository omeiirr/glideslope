import { render } from 'preact';
import '@fontsource-variable/atkinson-hyperlegible-next';
import '@fontsource-variable/atkinson-hyperlegible-mono';
import './ui/styles.css';
import { App } from './ui/App';

render(<App />, document.getElementById('app')!);

// Cross-origin isolation for multi-threaded speech recognition (public/coi.js). The first visit reloads once
// when the service worker takes over; a browser that still isn't isolated after that (no credentialless
// support, e.g. Safari) just stays on one thread.
if (import.meta.env.PROD && !crossOriginIsolated && 'serviceWorker' in navigator) {
  const first = !navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./coi.js').then(
    () => first && navigator.serviceWorker.addEventListener('controllerchange', () => location.reload()),
    () => {},
  );
}
