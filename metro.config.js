// Sentry's Metro config: adds debug IDs to the JS bundle so crash stack traces
// can be matched to uploaded source maps. Otherwise Expo's defaults.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);
