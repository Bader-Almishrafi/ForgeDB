/**
 * Pure validation rules and diagnostic heuristics for CSV and external dataset importing.
 * Decouples DOM file processing from pure mathematical and lexical verification.
 */

export type CsvDelimiter = ',' | ';' | '\t' | '|';

export interface CsvHeaderValidation {
  valid: boolean;
  duplicateHeaders: string[];
  emptyHeadersCount: number;
}

export function detectCsvDelimiter(headerLine: string): CsvDelimiter {
  const delimiters: CsvDelimiter[] = [',', ';', '\t', '|'];
  let maxCount = 0;
  let detected: CsvDelimiter = ',';

  for (const del of delimiters) {
    const count = headerLine.split(del).length - 1;
    if (count > maxCount) {
      maxCount = count;
      detected = del;
    }
  }
  return detected;
}

export function validateCsvHeader(headers: string[]): CsvHeaderValidation {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  let emptyCount = 0;

  for (const h of headers) {
    const trimmed = h.trim();
    if (!trimmed) {
      emptyCount++;
    } else {
      const lower = trimmed.toLocaleLowerCase();
      if (seen.has(lower)) {
        duplicates.add(trimmed);
      } else {
        seen.add(lower);
      }
    }
  }

  return {
    valid: duplicates.size === 0 && emptyCount === 0,
    duplicateHeaders: Array.from(duplicates),
    emptyHeadersCount: emptyCount,
  };
}

export function sanitizeColumnIdentifier(rawName: string): string {
  // Converts spaces and invalid characters to underscores, strips non-ascii/symbols, ensures valid Postgres identifier
  let cleaned = rawName
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();

  if (!cleaned || /^\d/.test(cleaned)) {
    cleaned = `col_${cleaned || 'unnamed'}`;
  }
  return cleaned.slice(0, 63);
}

export function estimateDatasetRows(fileSizeBytes: number, averageRowBytes = 180): number {
  if (fileSizeBytes <= 0) return 0;
  return Math.max(1, Math.round(fileSizeBytes / averageRowBytes));
}

export function validateImportFile(file: File, maxSizeBytes = 500 * 1024 * 1024): { valid: boolean; error?: string } {
  if (file.size === 0) {
    return { valid: false, error: 'File is empty (0 bytes).' };
  }
  if (file.size > maxSizeBytes) {
    return { valid: false, error: `File size exceeds maximum allowed size (${Math.round(maxSizeBytes / (1024 * 1024))} MB).` };
  }
  const name = file.name.toLocaleLowerCase();
  if (!name.endsWith('.csv') && !name.endsWith('.xls') && !name.endsWith('.xlsx')) {
    return { valid: false, error: 'Unsupported format. Please upload CSV or Excel files.' };
  }
  return { valid: true };
}
