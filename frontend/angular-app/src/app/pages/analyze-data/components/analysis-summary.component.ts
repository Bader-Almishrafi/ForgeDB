import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DatasetAnalysisResponse, DatasetResponse } from '../../../services/api.models';

interface AnalysisSummary {
  analyzedDatasets: number;
  rows: number;
  columns: number;
  missingValues: number;
  duplicateRows: number;
  lastAnalyzedAt: string | null;
}

@Component({
  selector: 'app-analysis-summary',
  standalone: true,
  imports: [DatePipe, DecimalPipe],
  template: `
    <section class="workspace-panel space-y-4 p-5 sm:p-6 animate-dialog" data-testid="analysis-summary">
      <div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 class="text-xl font-bold text-slate-950 dark:text-white">Summary</h2>
          <p class="mt-1 text-sm text-slate-500">Only saved analysis for current active versions is included.</p>
        </div>
        @if (summary().lastAnalyzedAt) { <p class="text-xs text-slate-500">Analyzed {{ summary().lastAnalyzedAt | date:'medium' }}</p> }
      </div>
      <dl class="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div class="rounded-xl bg-slate-50 p-4 dark:bg-[#21262d]/70"><dt class="text-xs text-slate-500">Rows</dt><dd class="mt-1 text-xl font-bold">{{ summary().rows | number }}</dd></div>
        <div class="rounded-xl bg-slate-50 p-4 dark:bg-[#21262d]/70"><dt class="text-xs text-slate-500">Columns</dt><dd class="mt-1 text-xl font-bold">{{ summary().columns | number }}</dd></div>
        <div class="rounded-xl bg-slate-50 p-4 dark:bg-[#21262d]/70"><dt class="text-xs text-slate-500">Missing values</dt><dd class="mt-1 text-xl font-bold">{{ summary().missingValues | number }}</dd></div>
        <div class="rounded-xl bg-slate-50 p-4 dark:bg-[#21262d]/70"><dt class="text-xs text-slate-500">Duplicate rows</dt><dd class="mt-1 text-xl font-bold">{{ summary().duplicateRows | number }}</dd></div>
        <div class="rounded-xl bg-slate-50 p-4 dark:bg-[#21262d]/70"><dt class="text-xs text-slate-500">Analyzed version</dt><dd class="mt-1 text-lg font-bold">{{ analyzedVersionLabel() }}</dd></div>
      </dl>
      @if (selectedAnalysis(); as analysis) {
        <p class="text-xs text-slate-500">
          {{ analysis.isCleanedVersion ? 'Cleaned version' : 'Imported version' }}
          @if (analysis.analysisEngine) { · Engine: {{ analysis.analysisEngine }} }
        </p>
      } @else if (analysisEngines().length) {
        <p class="text-xs text-slate-500">Engine: {{ analysisEngines().join(', ') }}</p>
      }
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalysisSummaryComponent {
  analyses = input.required<DatasetAnalysisResponse[]>();
  projectScope = input.required<boolean>();

  readonly summary = computed<AnalysisSummary>(() => {
    const data = this.analyses();
    const analyzedAt = data.map((a) => a.analyzedAt).filter((v): v is string => !!v).sort().at(-1) ?? null;
    return {
      analyzedDatasets: data.length,
      rows: data.reduce((sum, a) => sum + a.analysisResult.rowCount, 0),
      columns: data.reduce((sum, a) => sum + a.analysisResult.columnCount, 0),
      missingValues: data.reduce((sum, a) => sum + a.analysisResult.missingValuesCount, 0),
      duplicateRows: data.reduce((sum, a) => sum + a.analysisResult.duplicateRowsCount, 0),
      lastAnalyzedAt: analyzedAt,
    };
  });

  readonly selectedAnalysis = computed(() => {
    return !this.projectScope() && this.analyses().length > 0 ? this.analyses()[0] : null;
  });

  readonly analysisEngines = computed(() => [...new Set(this.analyses()
    .map((a) => a.analysisEngine?.trim())
    .filter((e): e is string => !!e))]);

  analyzedVersionLabel(): string {
    const selected = this.selectedAnalysis();
    if (selected?.datasetVersionNumber) return `v${selected.datasetVersionNumber}`;
    return this.projectScope() ? `${this.summary().analyzedDatasets} current version${this.summary().analyzedDatasets === 1 ? '' : 's'}` : '—';
  }
}
