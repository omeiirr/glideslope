import { useEffect, useState } from 'preact/hooks';
import type { Session } from '../game/session';

/** Re-render when the session changes, at most ~8 times a second (the canvas has its own frame loop). */
export function useSession(session: Session) {
  const [, bump] = useState(0);
  useEffect(() => {
    let pending = false;
    let timer: ReturnType<typeof setTimeout>;
    const off = session.subscribe(() => {
      if (pending) return;
      pending = true;
      timer = setTimeout(() => {
        pending = false;
        bump((v) => v + 1);
      }, 120);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [session]);
}

export const hhmmss = (simTime: number): string => {
  const t = Math.floor(14 * 3600 + simTime);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(t / 3600) % 24)}:${p(Math.floor(t / 60) % 60)}:${p(t % 60)}`;
};
