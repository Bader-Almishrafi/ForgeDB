import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ChartRecommendation, DatasetAnalysisResponse, DatasetResponse } from '../../../services/api.models';

interface AnalysisRecommendation {
  key: string;
  datasetName: string;
  recommendation: ChartRecommendation;
}

@Component({
  selector: 'app-analysis-recommendations',
  standalone: true,
  template: `
    @if (recommendations().length) {
      <section class="workspace-panel p-5 sm:p-6 animate-dialog" data-testid="analysis-recommendations" style="animation-delay: 0.4s">
        <h2 class="text-xl font-bold text-slate-950 dark:text-white">Recommendations</h2>
        <ul class="mt-4 grid gap-3 md:grid-cols-2">
          @for (item of recommendations(); track item.key) {
            <li class="rounded-xl bg-slate-50 p-4 dark:bg-slate-900/50">
              <p class="text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">{{ item.datasetName }}</p>
              <h3 class="mt-1 font-semibold">{{ item.recommendation.title }}</h3>
              @if (item.recommendation.reason || item.recommendation.usefulness) {
                <p class="mt-2 text-sm text-slate-600 dark:text-slate-400">{{ item.recommendation.reason || item.recommendation.usefulness }}</p>
              }
            </li>
          }
        </ul>
      </section>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalysisRecommendationsComponent {
  analyses = input.required<DatasetAnalysisResponse[]>();
  datasets = input.required<DatasetResponse[]>();

  private datasetName(datasetId: number, fallback: string): string {
    return this.datasets().find((dataset) => dataset.id === datasetId)?.tableName ?? fallback;
  }

  readonly recommendations = computed<AnalysisRecommendation[]>(() => this.analyses().flatMap((analysis) =>
    analysis.chartRecommendations.map((recommendation, index) => ({
      key: `${analysis.datasetId}:${index}:${recommendation.title}`,
      datasetName: this.datasetName(analysis.datasetId, analysis.tableName),
      recommendation,
    }))).slice(0, 8));
}
