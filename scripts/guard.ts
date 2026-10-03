/**
 * Keeps the developer scripts that write demo/test data (seed-supabase.ts,
 * smoke-rls.ts) off production. The demo accounts they create or sign in as
 * have passwords published in this repo (src/store/seed.ts), so running either
 * against production would open it to anyone who reads the code.
 *
 * Allowed projects are listed in .env, never in the repo:
 *
 *   STAGING_PROJECT_REFS=<staging-ref>[,<another-ref>]
 *
 * A project ref is the subdomain of EXPO_PUBLIC_SUPABASE_URL.
 */

export function projectRefOf(url: string): string {
  return new URL(url).hostname.split('.')[0];
}

/** Why `url` must not be written to by a demo/test script, or null if it's a listed staging project. */
export function stagingRefusal(url: string, allowlist: string | undefined): string | null {
  const ref = projectRefOf(url);
  const allowed = (allowlist ?? '')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
  if (!allowed.length) {
    return (
      'STAGING_PROJECT_REFS is not set in .env. List the staging/demo project refs this script may write to, e.g.\n' +
      `  STAGING_PROJECT_REFS=${ref}\n` +
      '— only if that project is staging. Never list production.'
    );
  }
  if (!allowed.includes(ref)) {
    return `Project ${ref} is not in STAGING_PROJECT_REFS (${allowed.join(', ')}). This script only runs against staging.`;
  }
  return null;
}

/** Exits the process unless `url` is a listed staging project. */
export function assertStagingProject(url: string, script: string) {
  const refusal = stagingRefusal(url, process.env.STAGING_PROJECT_REFS);
  if (refusal) {
    console.error(`Refusing to run ${script} against ${url}.\n${refusal}`);
    process.exit(1);
  }
}
