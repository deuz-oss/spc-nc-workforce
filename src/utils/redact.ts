/** `https://host/path?query#hash` → `https://host/path` — for anything sent off
 * the phone (crash reports), since PostgREST filters in the query string can
 * carry WA numbers or names. */
export function stripQuery(url: string): string {
  const i = url.search(/[?#]/);
  return i === -1 ? url : url.slice(0, i);
}
