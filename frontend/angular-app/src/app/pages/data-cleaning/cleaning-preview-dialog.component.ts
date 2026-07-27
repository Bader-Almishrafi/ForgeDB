import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CleaningOperationRequest, CleaningPreviewResponse, CleaningSuggestion, DatasetCleaningPreview, DatasetCleaningSummary } from '../../services/api.models';

@Component({
  selector: 'app-cleaning-preview-dialog',
  standalone: true,
  imports: [DecimalPipe, FormsModule],
  templateUrl: './cleaning-preview-dialog.component.html',
  styles: ['dialog::backdrop { background: rgb(15 23 42 / 55%); backdrop-filter: blur(2px); }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CleaningPreviewDialogComponent implements OnChanges {
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');
  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');
  private returnFocusElement: HTMLElement | null = null;

  @Input() result: CleaningPreviewResponse | null = null;
  @Input() operations: CleaningOperationRequest[] = [];
  @Input() suggestions: CleaningSuggestion[] = [];
  @Input() datasets: DatasetCleaningSummary[] = [];
  @Input() applyLoading = false;
  @Input() previewLoading = false;
  @Input() destructiveConfirmed = false;

  @Output() closeRequested = new EventEmitter<void>();
  @Output() applyRequested = new EventEmitter<void>();
  @Output() removeRequested = new EventEmitter<string | null | undefined>();
  @Output() destructiveConfirmedChange = new EventEmitter<boolean>();

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['result']) {
      if (this.result) this.open();
      else this.close();
    }
  }

  open(): void {
    const dialog = this.dialog()?.nativeElement;
    if (!dialog || dialog.open) return;
    this.returnFocusElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    setTimeout(() => this.closeButton()?.nativeElement.focus());
  }

  close(): void {
    const dialog = this.dialog()?.nativeElement;
    if (dialog?.open) dialog.close();
    const returnFocusElement = this.returnFocusElement;
    this.returnFocusElement = null;
    setTimeout(() => returnFocusElement?.focus());
  }

  previewColumns(dataset: DatasetCleaningPreview): string[] {
    return [...new Set(dataset.rows.flatMap((row) => [
      ...Object.keys(row.before ?? {}),
      ...Object.keys(row.after ?? {}),
    ]))];
  }

  previewVersionLabel(dataset: DatasetCleaningPreview): string {
    const current = this.datasets.find((item) => item.datasetId === dataset.datasetId);
    return current?.activeVersionId === dataset.sourceVersionId ? `v${current.versionNumber}` : `ID ${dataset.sourceVersionId}`;
  }

  operationLabel(operation: CleaningOperationRequest): string {
    const suggestion = this.suggestions.find((item) => item.id === operation.suggestionId);
    return suggestion ? `${suggestion.issueType}${suggestion.column ? ` · ${suggestion.column}` : ''}` : operation.operationType.replaceAll('_', ' ');
  }

  formatValue(value: unknown): string {
    if (value === null || value === undefined || value === '') return 'NULL';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }
}
