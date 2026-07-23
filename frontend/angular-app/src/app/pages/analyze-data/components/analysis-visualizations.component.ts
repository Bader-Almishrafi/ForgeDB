import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DatasetAnalysisResponse, DatasetResponse } from '../../../services/api.models';
import { AnalysisChartComponent, AnalysisChartPoint } from '../analysis-chart.component';

@Component({
  selector: 'app-analysis-visualizations',
  standalone: true,
  imports: [AnalysisChartComponent],
  template: `
    @if (missingChartPoints().length || typeChartPoints().length || duplicateChartPoints().length) {
      <section data-testid="analysis-charts" class="animate-dialog" style="animation-delay: 0.3s">
        <h2 class="text-xl font-bold text-slate-950 dark:text-white">Visualizations</h2>
        <div class="mt-4 grid gap-4 lg:grid-cols-3">
          @if (missingChartPoints().length) { <app-analysis-chart title="Missing values" description="Largest missing-value counts in this scope." [points]="missingChartPoints()" /> }
          @if (typeChartPoints().length) { <app-analysis-chart title="Detected data types" description="Column distribution from saved analysis." [points]="typeChartPoints()" /> }
          @if (duplicateChartPoints().length) { <app-analysis-chart title="Duplicate rows" description="Datasets with reported duplicate rows." [points]="duplicateChartPoints()" /> }
        </div>
      </section>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalysisVisualizationsComponent {
  analyses = input.required<DatasetAnalysisResponse[]>();
  datasets = input.required<DatasetResponse[]>();
  projectScope = input.required<boolean>();

  private datasetName(datasetId: number, fallback: string): string {
    return this.datasets().find((dataset) => dataset.id === datasetId)?.tableName ?? fallback;
  }

  readonly missingChartPoints = computed<AnalysisChartPoint[]>(() => {
    if (this.projectScope()) {
      return this.analyses()
        .map((analysis) => ({ label: this.datasetName(analysis.datasetId, analysis.tableName), value: analysis.analysisResult.missingValuesCount }))
        .filter((point) => point.value > 0)
        .sort((left, right) => right.value - left.value)
        .slice(0, 10);
    }
    const analysis = this.analyses()[0];
    return (analysis?.analysisResult.columns ?? [])
      .map((column) => ({ label: column.columnName, value: column.missingValuesCount }))
      .filter((point) => point.value > 0)
      .sort((left, right) => right.value - left.value)
      .slice(0, 10);
  });

  readonly typeChartPoints = computed<AnalysisChartPoint[]>(() => {
    const totals = new Map<string, number>();
    for (const analysis of this.analyses()) {
      for (const item of analysis.analysisResult.columnTypeDistribution) {
        totals.set(item.dataType, (totals.get(item.dataType) ?? 0) + item.count);
      }
    }
    return [...totals.entries()].map(([label, value]) => ({ label, value })).sort((left, right) => right.value - left.value);
  });

  readonly duplicateChartPoints = computed<AnalysisChartPoint[]>(() => this.analyses()
    .map((analysis) => ({ label: this.datasetName(analysis.datasetId, analysis.tableName), value: analysis.analysisResult.duplicateRowsCount }))
    .filter((point) => point.value > 0)
    .sort((left, right) => right.value - left.value));
}
