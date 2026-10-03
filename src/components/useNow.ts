import { useEffect, useState } from 'react';

/**
 * The current time, refreshed every `intervalMs` — for render code that needs
 * "now" (today's date, elapsed time) without calling Date.now() during render,
 * and so that a screen left open past midnight moves on to the new day.
 */
export function useNow(intervalMs = 60000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
