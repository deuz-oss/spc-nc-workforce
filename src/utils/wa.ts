/**
 * WhatsApp numbers — must match normalize_wa() / consumers_server_checks in
 * migration 0015, which enforce the same rules server-side.
 */

/** '0812-3456 789' / '+62 812…' / '812…' → '62812…' (digits only). */
export function normalizeWa(input: string): string {
  const d = input.replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('62')) return d;
  if (d.startsWith('0')) return `62${d.slice(1)}`;
  if (d.startsWith('8')) return `62${d}`;
  return d;
}

/** An Indonesian mobile number (62 8xx, 10-15 digits in total). */
export function isValidWa(input: string): boolean {
  return /^628[0-9]{7,12}$/.test(normalizeWa(input));
}
