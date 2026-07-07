/**
 * Mirrors the backend's identifier rules so the "Rename to sanitized" one-click validation
 * fix always produces a name the backend will actually accept:
 *  - safe-lowercase pattern `^[a-z_][a-z0-9_]{0,62}$` and the reserved-word check in
 *    backend/ForgeDB.API/Services/Generators/SqlIdentifiers.cs (IsSafeLowercaseIdentifier,
 *    ReservedWords, IsUnusableEvenQuoted — empty or over PostgreSQL's 63-byte limit);
 *  - the normalize-to-valid-identifier transform in
 *    backend/ForgeDB.API/Services/DatasetHeuristics.cs (NormalizeIdentifier), which lowercases,
 *    collapses illegal runs to a single underscore, trims edge underscores, and prefixes a
 *    leading digit — extended here with truncation to 63 chars, since NormalizeIdentifier alone
 *    does not bound length and the backend's "invalid-identifier" error fires on names over 63
 *    chars even when otherwise well-formed.
 */
const SAFE_LOWERCASE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const MAX_IDENTIFIER_LENGTH = 63;

// Mirrors SqlIdentifiers.ReservedWords exactly (backend/ForgeDB.API/Services/Generators/SqlIdentifiers.cs).
const RESERVED_WORDS = new Set([
  'all', 'analyse', 'analyze', 'and', 'any', 'array', 'as', 'asc', 'asymmetric',
  'both', 'case', 'cast', 'check', 'collate', 'column', 'constraint', 'create',
  'current_date', 'current_role', 'current_time', 'current_timestamp', 'current_user',
  'default', 'deferrable', 'desc', 'distinct', 'do', 'else', 'end', 'except', 'false',
  'fetch', 'for', 'foreign', 'from', 'grant', 'group', 'having', 'in', 'initially',
  'intersect', 'into', 'lateral', 'leading', 'limit', 'localtime', 'localtimestamp',
  'not', 'null', 'offset', 'on', 'only', 'or', 'order', 'placing', 'primary',
  'references', 'returning', 'select', 'session_user', 'some', 'symmetric', 'table',
  'then', 'to', 'trailing', 'true', 'union', 'unique', 'user', 'using', 'variadic',
  'when', 'where', 'window', 'with',
]);

export function isSafeLowercaseIdentifier(identifier: string): boolean {
  return SAFE_LOWERCASE_PATTERN.test(identifier);
}

export function isReservedWord(identifier: string): boolean {
  return RESERVED_WORDS.has(identifier.toLowerCase());
}

/** Mirrors SqlIdentifiers.IsUnusableEvenQuoted: empty/whitespace, or over 63 chars. */
export function isUnusableEvenQuoted(identifier: string | null | undefined): boolean {
  return !identifier || identifier.trim().length === 0 || identifier.length > MAX_IDENTIFIER_LENGTH;
}

/**
 * Produces a valid identifier from an arbitrary string: lowercase, illegal-character runs
 * collapsed to `_`, edge underscores trimmed, `t_` prefix if it would start with a digit,
 * truncated to 63 chars, falling back to `fallback` if nothing usable remains.
 */
export function sanitizeIdentifier(value: string, fallback = 'unnamed'): string {
  let normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!normalized) {
    normalized = fallback;
  }

  if (/^[0-9]/.test(normalized)) {
    normalized = `t_${normalized}`;
  }

  if (normalized.length > MAX_IDENTIFIER_LENGTH) {
    normalized = normalized.slice(0, MAX_IDENTIFIER_LENGTH).replace(/_+$/, '');
    if (!normalized) {
      normalized = fallback.slice(0, MAX_IDENTIFIER_LENGTH);
    }
  }

  return normalized;
}
