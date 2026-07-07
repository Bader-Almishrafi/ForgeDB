import { describe, expect, it } from 'vitest';
import { isSafeLowercaseIdentifier, isUnusableEvenQuoted, sanitizeIdentifier } from './identifier-sanitizer';

describe('identifier-sanitizer', () => {
  it('lowercases and replaces illegal characters with underscores', () => {
    expect(sanitizeIdentifier('Full Name!!')).toBe('full_name');
  });

  it('collapses repeated illegal runs into a single underscore', () => {
    expect(sanitizeIdentifier('a---b   c')).toBe('a_b_c');
  });

  it('prefixes an identifier that would start with a digit', () => {
    expect(sanitizeIdentifier('123abc')).toBe('t_123abc');
  });

  it('falls back when nothing usable remains', () => {
    expect(sanitizeIdentifier('!!!', 'column_1')).toBe('column_1');
  });

  it('truncates to 63 characters, mirroring the backend length limit', () => {
    const result = sanitizeIdentifier('x'.repeat(80));
    expect(result.length).toBeLessThanOrEqual(63);
    expect(isUnusableEvenQuoted(result)).toBe(false);
  });

  it('produces a name that always passes isSafeLowercaseIdentifier', () => {
    expect(isSafeLowercaseIdentifier(sanitizeIdentifier('Order #2026 (final)'))).toBe(true);
  });
});
