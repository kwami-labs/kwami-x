/**
 * Whether a configuration value is real or still the shipped placeholder.
 *
 * `.env.example` carries illustrative values, and the overwhelmingly common
 * first run is `cp .env.example .env` followed by starting the server. Treating
 * those literals as credentials produces a `fetch failed` against
 * `your-project.supabase.co` — a far worse first impression than the demo arena.
 *
 * Shared because the client and the server both have to reach the same verdict.
 * They did not: the server decided demo mode with this check while the sign-in
 * gate decided "configured" from a non-empty string, so a fresh clone got demo
 * Kwamis behind a sign-in wall that could never be passed. Two definitions of
 * "configured" is one too many.
 */
export function isConfigured(value: unknown): boolean {
  if (typeof value !== 'string' || value.trim() === '') return false
  return !/your-project|your-server|\.{3}$|^(sk|pk|sb)_(test|publishable|secret)_\.{3}$/.test(value)
}
