import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { ApiErrorBody, DatasetPreview } from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { WorkflowStateService } from '../../services/workflow-state.service';

@Component({
  selector: 'app-analysis',
  standalone: true,
  imports: [FormsModule, NgClass, RouterLink],
  templateUrl: './analysis.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalysisComponent implements OnInit {
  readonly preview = signal<DatasetPreview | null>(null);
  readonly loading = signal(false);
  readonly analyzing = signal(false);

  datasetId = 0;
  errorMessage = '';
  successMessage = '';
  searchTerm = '';

  constructor(
    private api: ForgeApiService,
    private route: ActivatedRoute,
    private router: Router,
    private workflow: WorkflowStateService,
  ) {}

  ngOnInit(): void {
    this.datasetId = Number(this.route.snapshot.paramMap.get('datasetId'));
    if (!Number.isFinite(this.datasetId) || this.datasetId <= 0) {
      this.router.navigate(['/projects']);
      return;
    }

    this.loadPreview();
  }

  loadPreview(): void {
    this.errorMessage = '';
    this.loading.set(true);

    this.api.getDatasetPreview(this.datasetId)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (preview) => {
          this.preview.set(preview);
          this.workflow.setDatasetId(preview.datasetId, preview.tableName);
        },
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to load dataset preview.';
        },
      });
  }

  analyze(): void {
    this.errorMessage = '';
    this.successMessage = '';
    this.analyzing.set(true);

    this.api.analyzeDataset(this.datasetId, { analysisType: 'profile' })
      .pipe(finalize(() => this.analyzing.set(false)))
      .subscribe({
        next: () => {
          this.workflow.setDatasetId(this.datasetId, this.preview()?.tableName, 'Analyzed');
          this.successMessage = 'Analysis completed. Dashboard data is ready.';
        },
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to analyze dataset.';
        },
      });
  }

  cellValue(row: Record<string, unknown>, column: string): string {
    const value = row[column];
    if (value === null || value === undefined || value === '') {
      return 'NULL';
    }

    return String(value);
  }

  filteredRows(data: DatasetPreview): Record<string, unknown>[] {
    const term = this.searchTerm.trim().toLowerCase();
    if (!term) {
      return data.rows;
    }

    return data.rows.filter((row) =>
      data.columns.some((column) => this.cellValue(row, column).toLowerCase().includes(term)));
  }

  missingCount(data: DatasetPreview, column: string): number {
    return data.rows.filter((row) => this.isMissing(row[column])).length;
  }

  uniqueCount(data: DatasetPreview, column: string): number {
    return new Set(data.rows.map((row) => this.cellValue(row, column))).size;
  }

  duplicatePreviewRows(data: DatasetPreview): number {
    const rowCounts = this.rowCounts(data);
    return data.rows.filter((row) => (rowCounts.get(this.rowSignature(data, row)) ?? 0) > 1).length;
  }

  totalMissingCells(data: DatasetPreview): number {
    return data.columns.reduce((total, column) => total + this.missingCount(data, column), 0);
  }

  isDuplicateRow(data: DatasetPreview, row: Record<string, unknown>): boolean {
    return (this.rowCounts(data).get(this.rowSignature(data, row)) ?? 0) > 1;
  }

  inferredType(data: DatasetPreview, column: string): string {
    const values = data.rows
      .map((row) => row[column])
      .filter((value) => !this.isMissing(value))
      .map((value) => String(value));

    if (values.length === 0) {
      return 'empty';
    }

    if (values.every((value) => /^-?\d+$/.test(value))) {
      return 'integer';
    }

    if (values.every((value) => /^-?\d+(\.\d+)?$/.test(value))) {
      return 'decimal';
    }

    if (values.every((value) => /^(true|false)$/i.test(value))) {
      return 'boolean';
    }

    if (values.every((value) => !Number.isNaN(Date.parse(value)))) {
      return 'datetime';
    }

    return 'string';
  }

  typeBadgeClass(type: string): string {
    if (type === 'integer' || type === 'decimal') {
      return 'bg-sky-50 text-sky-700 ring-sky-200';
    }

    if (type === 'datetime') {
      return 'bg-violet-50 text-violet-700 ring-violet-200';
    }

    if (type === 'boolean') {
      return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
    }

    if (type === 'empty') {
      return 'bg-amber-50 text-amber-700 ring-amber-200';
    }

    return 'bg-slate-100 text-slate-700 ring-slate-200';
  }

  topValues(data: DatasetPreview, column: string): Array<{ value: string; count: number }> {
    const counts = new Map<string, number>();
    data.rows.forEach((row) => {
      const value = this.cellValue(row, column);
      counts.set(value, (counts.get(value) ?? 0) + 1);
    });

    return Array.from(counts.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value))
      .slice(0, 5);
  }

  topValuePercent(values: Array<{ value: string; count: number }>, count: number): number {
    const max = Math.max(...values.map((value) => value.count), 1);
    return Math.max(8, Math.round((count / max) * 100));
  }

  cellClass(row: Record<string, unknown>, column: string): string {
    return this.isMissing(row[column])
      ? 'bg-amber-50 text-amber-800'
      : 'text-slate-700';
  }

  private isMissing(value: unknown): boolean {
    return value === null || value === undefined || value === '';
  }

  private rowCounts(data: DatasetPreview): Map<string, number> {
    const counts = new Map<string, number>();
    data.rows.forEach((row) => {
      const signature = this.rowSignature(data, row);
      counts.set(signature, (counts.get(signature) ?? 0) + 1);
    });

    return counts;
  }

  private rowSignature(data: DatasetPreview, row: Record<string, unknown>): string {
    return data.columns.map((column) => this.cellValue(row, column)).join('\u001f');
  }
}
