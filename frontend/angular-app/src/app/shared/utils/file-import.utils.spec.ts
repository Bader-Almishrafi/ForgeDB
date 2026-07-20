import { describe, expect, it } from 'vitest';
import { formatFileSize, isCsvFile } from './file-import.utils';

describe('file import utilities', () => {
  it('accepts non-empty CSV files case-insensitively', () => {
    expect(isCsvFile(new File(['id\n1'], 'records.CSV'))).toBe(true);
  });

  it('rejects empty or non-CSV files', () => {
    expect(isCsvFile(new File([], 'empty.csv'))).toBe(false);
    expect(isCsvFile(new File(['{}'], 'records.json'))).toBe(false);
  });

  it('formats browser file sizes', () => {
    expect(formatFileSize(800)).toBe('800 B');
    expect(formatFileSize(2048)).toBe('2.0 KB');
    expect(formatFileSize(2 * 1024 * 1024)).toBe('2.0 MB');
  });
});
