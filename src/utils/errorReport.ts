import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from '../lib/supabase';
import { captureToSentry } from '../sentry';

/**
 * Minimal crash reporting: uncaught errors and render crashes are written to
 * the client_errors table (migration 0018), and also sent to Sentry when it is
 * configured (src/sentry.ts) — client_errors stays as the fallback. Best-effort
 * and never throws; repeats of the same message are dropped for a minute and
 * a session sends at most MAX_PER_SESSION reports (the server rate-limits too).
 */
const MAX_PER_SESSION = 20;
const REPEAT_WINDOW_MS = 60 * 1000;

let sent = 0;
const lastSentAt = new Map<string, number>();

export function reportError(error: unknown, context: string): void {
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    const message = `${err.name}: ${err.message}`.slice(0, 2000);
    console.warn(`[${context}]`, message);
    // Uncaught errors reach Sentry through its own global handler already.
    if (!context.startsWith('global') && !context.startsWith('window.') && context !== 'unhandledrejection') {
      captureToSentry(err, context);
    }
    const now = Date.now();
    if (sent >= MAX_PER_SESSION || now - (lastSentAt.get(message) ?? 0) < REPEAT_WINDOW_MS) return;
    lastSentAt.set(message, now);
    sent++;
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return; // the table only takes a signed-in user's own reports
      await supabase.from('client_errors').insert({
        message,
        stack: err.stack?.slice(0, 8000) ?? null,
        context: context.slice(0, 200),
        platform: `${Platform.OS} ${String(Platform.Version ?? '')}`.trim().slice(0, 40),
        app_version: (Constants.expoConfig?.version ?? '').slice(0, 40),
      });
    })().catch(() => undefined);
  } catch {
    /* reporting must never cause an error of its own */
  }
}

let installed = false;

/** Routes errors nothing else caught to reportError (native: the RN global
 * handler, which still gets called afterwards; web: window error events). */
export function installGlobalErrorHandlers(): void {
  if (installed) return;
  installed = true;
  const g = globalThis as unknown as {
    ErrorUtils?: {
      getGlobalHandler(): (e: unknown, fatal?: boolean) => void;
      setGlobalHandler(h: (e: unknown, fatal?: boolean) => void): void;
    };
  };
  if (g.ErrorUtils) {
    const previous = g.ErrorUtils.getGlobalHandler();
    g.ErrorUtils.setGlobalHandler((e, fatal) => {
      reportError(e, fatal ? 'global (fatal)' : 'global');
      previous(e, fatal);
    });
  }
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.addEventListener('error', (ev) => reportError(ev.error ?? ev.message, 'window.error'));
    window.addEventListener('unhandledrejection', (ev) => reportError(ev.reason, 'unhandledrejection'));
  }
}
