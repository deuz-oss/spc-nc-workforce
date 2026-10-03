import * as Sentry from '@sentry/react-native';
import type { Breadcrumb } from '@sentry/react-native';
import { stripQuery } from './utils/redact';

/**
 * Crash reporting via Sentry — on only when EXPO_PUBLIC_SENTRY_DSN is set
 * (EAS environment per build profile); without it every function here is a
 * no-op and errors still go to client_errors (utils/errorReport.ts).
 *
 * Nothing personal leaves the phone: no default PII (IP, device name), the user
 * is tagged by id only, and URLs lose their query string — PostgREST filters
 * there can carry WA numbers or names.
 */
const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
export const sentryEnabled = !!DSN;

function scrubBreadcrumb(b: Breadcrumb): Breadcrumb {
  if (typeof b.data?.url === 'string') b.data = { ...b.data, url: stripQuery(b.data.url) };
  return b;
}

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment: __DEV__ ? 'development' : (process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT ?? 'production'),
    sendDefaultPii: false,
    tracesSampleRate: 0, // errors only — no performance tracing
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSend(event) {
      if (event.request?.url) event.request.url = stripQuery(event.request.url);
      return event;
    },
  });
}

/** Errors Sentry doesn't capture by itself (render crashes caught by
 * ErrorBoundary, handled failures worth seeing). Uncaught errors and native
 * crashes are captured by the SDK's own handlers. */
export function captureToSentry(error: unknown, context: string) {
  if (sentryEnabled) Sentry.captureException(error, { tags: { context: context.slice(0, 200) } });
}

/** Tag later events with the signed-in user's id (never name or username). */
export function setSentryUser(id: string | null) {
  if (sentryEnabled) Sentry.setUser(id ? { id } : null);
}
