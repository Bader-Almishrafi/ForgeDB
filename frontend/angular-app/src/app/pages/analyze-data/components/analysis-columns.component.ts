import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ColumnAnalysis, DatasetAnalysisResponse, DatasetResponse } from '../../../services/api.models';

interface AnalysisColumnRow {
  key: string;
  datasetName: string;
  column: ColumnAnalysis;
  missingPercentage: number | null;
}

@Component({
  selector: 'app-analysis-columns',
  standalone: true,
  imports: [DecimalPipe, FormsModule],
  template: `
    <section class="workspace-panel p-5 sm:p-6 animate-dialog" data-testid="analysis-columns" style="animation-delay: 0.2s">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><h2 class="text-xl font-bold text-slate-950 dark:text-white">Columns</h2><p class="mt-1 text-sm text-slate-500">Detected types and saved column statistics.</p></div>
        <label class="block sm:w-72"><span class="sr-only">Search columns</span><input type="search" class="input-field" placeholder="Search columns" [ngModel]="columnSearch()" (ngModelChange)="columnSearch.set($event)"></label>
      </div>
      <div class="table-wrap mt-4 max-h-[34rem]">
        <table class="data-table">
          <thead class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800">
            <tr><th class="px-3 py-2 text-left">Dataset</th><th class="px-3 py-2 text-left">Column</th><th class="px-3 py-2 text-left">Type</th><th class="px-3 py-2 text-right">Missing</th><th class="px-3 py-2 text-right">Unique</th><th class="px-3 py-2 text-left">Numeric statistics</th></tr>
          </thead>
          <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
            @for (row of filteredColumns(); track row.key) {
              <tr>
                <td class="px-3 py-3">{{ row.datasetName }}</td>
                <td class="px-3 py-3 font-mono font-semibold">{{ row.column.columnName }}</td>
                <td class="px-3 py-3">{{ row.column.detectedDataType }}</td>
                <td class="px-3 py-3 text-right">{{ row.column.missingValuesCount | number }} @if (row.missingPercentage !== null) { <span class="text-xs text-slate-400">({{ row.missingPercentage | number:'1.0-1' }}%)</span> }</td>
                <td class="px-3 py-3 text-right">{{ row.column.uniqueValuesCount | number }}</td>
                <td class="whitespace-nowrap px-3 py-3 text-xs text-slate-500">@if (row.column.numericStats; as stats) { Min {{ stats.min | number:'1.0-2' }} · Avg {{ stats.average | number:'1.0-2' }} · Max {{ stats.max | number:'1.0-2' }} } @else { — }</td>
              </tr>
            } @empty {
              <tr><td colspan="6" class="px-3 py-10 text-center text-slate-500">No columns match this search.</td></tr>
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalysisColumnsComponent {
  analyses = input.required<DatasetAnalysisResponse[]>();
  datasets = input.required<DatasetResponse[]>();
  
  readonly columnSearch = signal('');

  private datasetName(datasetId: number, fallback: string): string {
    return this.datasets().find((dataset) => dataset.id === datasetId)?.tableName ?? fallback;
  }

  readonly columns = computed<AnalysisColumnRow[]>(() => this.analyses().flatMap((analysis) => {
    const datasetName = this.datasetName(analysis.datasetId, analysis.tableName);
    const rows = analysis.analysisResult.rowCount;
    return analysis.analysisResult.columns.map((column) => ({
      key: `${analysis.datasetId}:${column.columnName}`,
      datasetName,
      column,
      missingPercentage: rows > 0 ? column.missingValuesCount / rows * 100 : null,
    }));
  }));

  readonly filteredColumns = computed(() => {
    const query = this.columnSearch().trim().toLocaleLowerCase();
    return query
      ? this.columns().filter((row) => `${row.datasetName} ${row.column.columnName} ${row.column.detectedDataType}`.toLocaleLowerCase().includes(query))
      : this.columns();
  });
}
