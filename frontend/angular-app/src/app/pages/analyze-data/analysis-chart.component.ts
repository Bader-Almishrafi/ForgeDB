import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export interface AnalysisChartPoint {
  label: string;
  value: number;
}

@Component({
  selector: 'app-analysis-chart',
  standalone: true,
  templateUrl: './analysis-chart.component.html',
  styleUrl: './analysis-chart.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalysisChartComponent {
  readonly title = input.required<string>();
  readonly description = input('');
  readonly points = input<AnalysisChartPoint[]>([]);
  readonly emptyMessage = input('No chart data is available for the current scope.');
  readonly maxValue = computed(() => Math.max(0, ...this.points().map((point) => point.value)));

  barWidth(value: number): number {
    const max = this.maxValue();
    return max > 0 ? Math.max(2, (value / max) * 100) : 0;
  }
}
