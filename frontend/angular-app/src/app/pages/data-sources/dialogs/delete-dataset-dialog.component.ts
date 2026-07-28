import { ChangeDetectionStrategy, Component, EventEmitter, inject, Input, Output, signal } from '@angular/core';
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
export class DeleteDatasetDialogComponent {
  private readonly api = inject(ForgeApiService);

  @Input() isOpen = false;
  @Input() dataset: DatasetResponse | null = null;
  
  @Output() closeDialog = new EventEmitter<void>();
  @Output() deleted = new EventEmitter<void>();

  readonly deleting = signal(false);
  readonly deleteError = signal('');

  close(): void {
    if (!this.deleting()) {
      this.closeDialog.emit();
      this.deleteError.set('');
    }
  }

  deleteDataset(): void {
    if (!this.dataset || this.deleting()) return;
    this.deleting.set(true);
    this.deleteError.set('');
    
    this.api.deleteDataset(this.dataset.id).pipe(finalize(() => this.deleting.set(false))).subscribe({
      next: () => {
        this.deleted.emit();
        this.closeDialog.emit();
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
}
