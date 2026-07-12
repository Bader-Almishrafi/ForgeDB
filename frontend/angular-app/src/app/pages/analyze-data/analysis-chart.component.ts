import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { BarChart, GaugeChart, PieChart } from 'echarts/charts';
import {
  AriaComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import type { EChartsCoreOption } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { NgxEchartsDirective, provideEchartsCore } from 'ngx-echarts';

echarts.use([
  AriaComponent,
  BarChart,
  CanvasRenderer,
  GaugeChart,
  GridComponent,
  LegendComponent,
  PieChart,
  TooltipComponent,
]);

@Component({
  selector: 'app-analysis-chart',
  standalone: true,
  imports: [NgxEchartsDirective],
  providers: [provideEchartsCore({ echarts })],
  templateUrl: './analysis-chart.component.html',
  styleUrl: './analysis-chart.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalysisChartComponent {
  readonly title = input.required<string>();
  readonly description = input('');
  readonly scope = input('');
  readonly option = input<EChartsCoreOption | null>(null);
  readonly loading = input(false);
  readonly emptyMessage = input('No chart data is available for the current scope.');
  readonly accessibleSummary = input('');
  readonly height = input<'standard' | 'compact'>('standard');

  readonly chartClass = computed(() => this.height() === 'compact' ? 'analysis-chart analysis-chart--compact' : 'analysis-chart');
}
