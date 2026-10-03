/**
 * Password rules for every place a password is set (admin create/reset, bulk
 * import, own change). Must match passwordProblem in
 * supabase/functions/admin-users/index.ts, which enforces it server-side for
 * admin-set passwords. Set Supabase Auth's own minimum length (Dashboard →
 * Authentication → Providers → Email) to the same MIN_PASSWORD so the
 * self-service change path is held to it too.
 */
export const MIN_PASSWORD = 8;

/** Why `password` is not acceptable for `username`, or null if it is. */
export function passwordProblem(password: string, username = ''): string | null {
  if (password.length < MIN_PASSWORD) return `Password minimal ${MIN_PASSWORD} karakter.`;
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return 'Password harus berisi huruf dan angka.';
  const u = username.trim().toLowerCase();
  if (u && password.toLowerCase().includes(u)) return 'Password tidak boleh memuat username.';
  return null;
}
