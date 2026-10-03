/**
 * Dynamic layer over app.json (Expo passes app.json in as `config`).
 *
 * Android push notifications need Firebase's google-services.json at build
 * time. This repo is public, so that file is never committed: on EAS it comes
 * from a file-type environment variable (GOOGLE_SERVICES_JSON, holding the
 * path EAS writes the file to — see README "Push notifications (Android)"),
 * and locally from ./google-services.json if a developer has one (gitignored).
 * Without either, the app still builds — push registration just has no FCM
 * credentials, as before.
 */
const fs = require('fs');
const path = require('path');

module.exports = ({ config }) => {
  const local = path.join(__dirname, 'google-services.json');
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON || (fs.existsSync(local) ? './google-services.json' : undefined);
  // Sentry source-map upload at build time, only once the project is set up on
  // EAS (SENTRY_ORG / SENTRY_PROJECT plain, SENTRY_AUTH_TOKEN secret). Crash
  // reporting itself only needs EXPO_PUBLIC_SENTRY_DSN (src/sentry.ts).
  const { SENTRY_ORG, SENTRY_PROJECT, SENTRY_AUTH_TOKEN } = process.env;
  const sentryPlugin =
    SENTRY_ORG && SENTRY_PROJECT && SENTRY_AUTH_TOKEN
      ? [['@sentry/react-native/expo', { organization: SENTRY_ORG, project: SENTRY_PROJECT }]]
      : [];
  return {
    ...config,
    plugins: [...(config.plugins ?? []), ...sentryPlugin],
    android: {
      ...config.android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
  };
};
