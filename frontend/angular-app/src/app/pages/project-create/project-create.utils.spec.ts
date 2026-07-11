import { describe, expect, it } from 'vitest';
import { fileFingerprint, formatFileSize, isCsvFile, selectedIndexAfterRemoval } from './project-create.utils';

describe('project create file utilities', () => {
  it('accepts non-empty CSV files case-insensitively', () => {
    expect(isCsvFile(new File(['id\n1'], 'records.CSV', { lastModified: 1 }))).toBe(true);
  });

  it('rejects non-CSV and empty files to match backend validation', () => {
    expect(isCsvFile(new File(['{}'], 'records.json'))).toBe(false);
    expect(isCsvFile(new File([], 'empty.csv'))).toBe(false);
  });

  it('uses browser metadata to detect duplicate selections', () => {
    const first = new File(['id\n1'], 'records.csv', { lastModified: 25 });
    const duplicate = new File(['id\n1'], 'RECORDS.CSV', { lastModified: 99 });
    expect(fileFingerprint(first)).toBe(fileFingerprint(duplicate));
  });

  it('formats browser-provided file sizes', () => {
    expect(formatFileSize(800)).toBe('800 B');
    expect(formatFileSize(2048)).toBe('2.0 KB');
    expect(formatFileSize(2 * 1024 * 1024)).toBe('2.0 MB');
  });

  it('keeps selected positions valid after removal', () => {
    expect(selectedIndexAfterRemoval(2, 0, 2)).toBe(1);
    expect(selectedIndexAfterRemoval(2, 2, 2)).toBe(1);
    expect(selectedIndexAfterRemoval(0, 0, 0)).toBe(-1);
  });
});
