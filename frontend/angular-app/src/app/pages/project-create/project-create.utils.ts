export function isCsvFile(file: File): boolean {
  return file.size > 0 && file.name.toLocaleLowerCase().endsWith('.csv');
}

export function fileFingerprint(file: File): string {
  return `${file.name.toLocaleLowerCase()}::${file.size}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function selectedIndexAfterRemoval(currentIndex: number, removedIndex: number, remainingCount: number): number {
  if (remainingCount === 0) {
    return -1;
  }
  if (removedIndex < currentIndex) {
    return currentIndex - 1;
  }
  if (removedIndex === currentIndex) {
    return Math.min(currentIndex, remainingCount - 1);
  }
  return Math.min(currentIndex, remainingCount - 1);
}
