export const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;

export function isCsvFile(file: File): boolean {
  return file.size > 0
    && file.size <= MAX_IMPORT_FILE_BYTES
    && file.name.toLocaleLowerCase().endsWith('.csv');
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
