export const APP_NAME = 'Vectors';

export function App() {
  return (
    <div class="app">
      <header class="topbar">
        <div class="brand">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#5CC8FF"
            stroke-width="1.8"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <circle cx="12" cy="12" r="4.5" />
            <path d="M12 12 L19 6" />
          </svg>
          <span class="brand-name">Schiphol Approach</span>
          <span class="mono dim">EHAM · APP 119.055</span>
        </div>
        <div class="spacer" />
        <div class="stats mono">
          <div>
            <span class="dim">UTC </span>--:--:--
          </div>
        </div>
      </header>
      <div class="body">
        <aside class="left" aria-label="Flight strips">
          <div class="panel-title">
            <span>ARRIVAL SEQUENCE</span>
            <span>RWY 18R</span>
          </div>
        </aside>
        <main class="scope" aria-label="Radar scope" />
        <aside class="right" aria-label="Radio">
          <div class="panel-title">
            <span>RADIO</span>
            <span class="mono">119.055</span>
          </div>
        </aside>
      </div>
      <footer class="pttbar">
        <span class="dim">hold Space to talk</span>
      </footer>
    </div>
  );
}
