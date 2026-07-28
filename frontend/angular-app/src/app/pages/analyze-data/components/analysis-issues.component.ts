import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DatasetAnalysisResponse, DatasetResponse } from '../../../services/api.models';

interface AnalysisIssue {
  key: string;
  datasetName: string;
  type: 'Missing values' | 'Duplicate rows';
  column: string | null;
  count: number;
  percentage: number | null;
}

@Component({
  selector: 'app-analysis-issues',
  standalone: true,
  imports: [DecimalPipe],
  template: `
    <section class="workspace-panel p-5 sm:p-6 animate-dialog" data-testid="analysis-issues" style="animation-delay: 0.1s">
      <h2 class="text-xl font-bold text-slate-950 dark:text-white">Issues</h2>
      @if (issues().length) {
        <div class="table-wrap mt-4 max-h-[30rem]">
          <table class="data-table">
            <thead class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800">
              <tr><th class="px-3 py-2 text-left">Dataset</th><th class="px-3 py-2 text-left">Issue</th><th class="px-3 py-2 text-left">Column</th><th class="px-3 py-2 text-right">Count</th><th class="px-3 py-2 text-right">Percent</th></tr>
            </thead>
            <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
              @for (issue of issues(); track issue.key) {
                <tr><td class="px-3 py-3 font-medium">{{ issue.datasetName }}</td><td class="px-3 py-3">{{ issue.type }}</td><td class="px-3 py-3 text-slate-500">{{ issue.column || 'All columns' }}</td><td class="px-3 py-3 text-right">{{ issue.count | number }}</td><td class="px-3 py-3 text-right">@if (issue.percentage !== null) { {{ issue.percentage | number:'1.0-1' }}% } @else { — }</td></tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <p class="mt-4 text-sm text-slate-500">No missing values or duplicate rows were reported for this scope.</p>
      }
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalysisIssuesComponent {
  analyses = input.required<DatasetAnalysisResponse[]>();
  datasets = input.required<DatasetResponse[]>();

  private datasetName(datasetId: number, fallback: string): string {
    return this.datasets().find((dataset) => dataset.id === datasetId)?.tableName ?? fallback;
  }

  readonly issues = computed<AnalysisIssue[]>(() => {
    const issues: AnalysisIssue[] = [];
    for (const analysis of this.analyses()) {
      const datasetName = this.datasetName(analysis.datasetId, analysis.tableName);
      const rows = analysis.analysisResult.rowCount;
      if (analysis.analysisResult.duplicateRowsCount > 0) {
        issues.push({
          key: `${analysis.datasetId}:duplicates`,
          datasetName,
          type: 'Duplicate rows',
          column: null,
          count: analysis.analysisResult.duplicateRowsCount,
          percentage: rows > 0 ? analysis.analysisResult.duplicateRowsCount / rows * 100 : null,
        });
      }
      for (const column of analysis.analysisResult.columns) {
        if (column.missingValuesCount <= 0) continue;
        issues.push({
          key: `${analysis.datasetId}:missing:${column.columnName}`,
          datasetName,
          type: 'Missing values',
          column: column.columnName,
          count: column.missingValuesCount,
          percentage: rows > 0 ? column.missingValuesCount / rows * 100 : null,
        });
      }
    }
    return issues.sort((left, right) => right.count - left.count);
  });
}
