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

@Component({
  selector: 'app-delete-dataset-dialog',
  standalone: true,
  templateUrl: './delete-dataset-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeleteDatasetDialogComponent implements OnChanges {
  private readonly api = inject(ForgeApiService);
  private readonly initialFocus = viewChild<ElementRef<HTMLButtonElement>>('initialFocus');
  private previouslyFocused: HTMLElement | null = null;

  @Input() isOpen = false;
  @Input() dataset: DatasetResponse | null = null;
  
  @Output() closeDialog = new EventEmitter<void>();
  @Output() deleted = new EventEmitter<void>();

  readonly deleting = signal(false);
  readonly deleteError = signal('');

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.deleteError.set('');
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
    if (!this.deleting()) {
      this.deleteError.set('');
      this.finishClose();
    }
  }

  deleteDataset(): void {
    if (!this.dataset || this.deleting()) return;
    this.deleting.set(true);
    this.deleteError.set('');
    
    this.api.deleteDataset(this.dataset.id).pipe(finalize(() => this.deleting.set(false))).subscribe({
      next: () => {
        this.deleted.emit();
        this.finishClose();
      },
      error: (error: unknown) => this.deleteError.set(this.errorText(error, 'Unable to delete this dataset.')),
    });
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
