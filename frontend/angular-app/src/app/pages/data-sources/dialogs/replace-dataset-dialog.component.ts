import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  inject,
  Input,
  OnChanges,
  Output,
  signal,
  SimpleChanges,
  viewChild,
} from '@angular/core';
import { finalize } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { DatasetResponse } from '../../../services/api.models';
import { ForgeApiService } from '../../../services/forge-api.service';
import { isCsvFile, formatFileSize } from '../../../shared/utils/file-import.utils';

@Component({
  selector: 'app-replace-dataset-dialog',
  standalone: true,
  templateUrl: './replace-dataset-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReplaceDatasetDialogComponent implements OnChanges {
  private readonly api = inject(ForgeApiService);
  private readonly initialFocus = viewChild<ElementRef<HTMLInputElement>>('initialFocus');
  private previouslyFocused: HTMLElement | null = null;

  @Input() isOpen = false;
  @Input() dataset: DatasetResponse | null = null;
  
  @Output() closeDialog = new EventEmitter<void>();
  @Output() replaced = new EventEmitter<DatasetResponse>();

  readonly replaceFile = signal<File | null>(null);
  readonly replaceError = signal('');
  readonly replacing = signal(false);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.replaceFile.set(null);
      this.replaceError.set('');
      setTimeout(() => this.initialFocus()?.nativeElement.focus());
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isOpen) this.close();
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.close();
  }

  close(): void {
    if (!this.replacing()) {
      this.finishClose();
    }
  }

  onReplaceFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    this.replaceError.set('');
    if (!file) return;
    
    if (!isCsvFile(file)) {
      this.replaceFile.set(null);
      this.replaceError.set('Choose one non-empty CSV file no larger than 10 MB.');
      return;
    }
    this.replaceFile.set(file);
  }

  replaceDataset(): void {
    const dataset = this.dataset;
    const file = this.replaceFile();
    if (!dataset || !file || this.replacing()) return;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('sourceType', 'csv');
    formData.append('sourceName', file.name);
    
    this.replacing.set(true);
    this.replaceError.set('');
    
    this.api.replaceDataset(dataset.id, formData).pipe(finalize(() => this.replacing.set(false))).subscribe({
      next: (updated) => {
        this.replaced.emit(updated);
        this.finishClose();
      },
      error: (error: unknown) => this.replaceError.set(this.errorText(error, 'Unable to replace this dataset.')),
    });
  }

  formatSize(bytes: number): string {
    return formatFileSize(bytes);
  }

  private errorText(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && error.error && typeof error.error === 'object' && 'message' in error.error) {
      const message = (error.error as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) return message;
    }
    return fallback;
  }

  private finishClose(): void {
    this.closeDialog.emit();
    const focusTarget = this.previouslyFocused;
    this.previouslyFocused = null;
    setTimeout(() => focusTarget?.focus());
  }
}
