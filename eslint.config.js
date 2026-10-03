// Expo's recommended rules (React, hooks, import resolution) — `npm run lint`.
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // Build-time config runs on Node, not in the app bundle.
    files: ['*.config.js'],
    languageOptions: { globals: { __dirname: 'readonly', require: 'readonly', module: 'writable', process: 'readonly' } },
    rules: { 'expo/no-env-var-destructuring': 'off' },
  },
  {
    ignores: ['dist/*', 'node_modules/*', 'supabase/functions/*', 'src/lib/database.types.ts'],
  },
]);
