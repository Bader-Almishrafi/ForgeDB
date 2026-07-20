import { DatePipe, DecimalPipe, NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  LucideArrowLeft,
  LucideBadgeCheck,
  LucideChartNoAxesCombined,
  LucideChartPie,
  LucideCheckCircle2,
  LucideCircleAlert,
  LucideClock3,
  LucideColumns3,
  LucideCopy,
  LucideDatabase,
  LucideLayers3,
  LucidePlay,
  LucideRefreshCw,
  LucideSearch,
  LucideShieldCheck,
  LucideTable2,
  LucideTriangleAlert,
  LucideWandSparkles,
} from '@lucide/angular';
import type { EChartsCoreOption } from 'echarts/core';
import { catchError, finalize, firstValueFrom, forkJoin, from, map, mergeMap, of, toArray } from 'rxjs';
import {
  ColumnAnalysis,
  DatasetAnalysisResponse,
  DatasetResponse,
  ProjectResponse,
  ValueFrequency,
} from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { queryParameter, routeParameter } from '../../services/route-context';
import { ThemeService } from '../../services/theme.service';
import { AnalysisChartComponent } from './analysis-chart.component';

type AnalysisScope = 'project' | number;
type AnalysisTab = 'overview' | 'columns' | 'quality' | 'visualizations' | 'issues';
type ColumnSort = 'missing-desc' | 'issues-desc' | 'name-asc';
type IssueStateFilter = 'all' | 'with-issues' | 'without-missing';
type ComparisonMetric = 'rows' | 'columns' | 'missing' | 'duplicates';
type ComparisonOrder = 'desc' | 'asc';
type ComparisonOrientation = 'horizontal' | 'vertical';

interface AnalysisLoadResult {
  dataset: DatasetResponse;
  analysis: DatasetAnalysisResponse | null;
  error: string;
}

interface AnalysisFailure {
  datasetId: number;
  datasetName: string;
  message: string;
}

interface AnalysisIssue {
  key: string;
  datasetId: number;
  datasetName: string;
  type: 'Missing values' | 'Duplicate rows';
  column: string | null;
  count: number;
  percentage: number | null;
  description: string;
}

interface AnalysisColumnRow {
  key: string;
  datasetId: number;
  datasetName: string;
  sourceName: string;
  column: ColumnAnalysis;
  missingPercentage: number | null;
  nonNullCount: number;
  cardinality: number | null;
  issueCount: number;
}

interface TypeCount {
  type: string;
  count: number;
}

interface ScopeSummary {
  totalDatasets: number;
  analyzedDatasets: number;
  notAnalyzedDatasets: number;
  totalRows: number;
  totalColumns: number;
  analyzedRows: number;
  analyzedCells: number;
  missingValues: number;
  missingPercentage: number | null;
  duplicateRows: number;
  duplicatePercentage: number | null;
  issueCount: number;
  typeCounts: TypeCount[];
  numericColumns: number;
  textColumns: number;
  dateColumns: number;
  booleanColumns: number;
  lastAnalyzedAt: string | null;
}

interface ComparisonPoint {
  datasetId: number;
  label: string;
  value: number;
}

interface RenderedRecommendation {
  key: string;
  datasetName: string;
  title: string;
  chartType: string;
  reason: string;
  option: EChartsCoreOption;
  summary: string;
}

@Component({
  selector: 'app-analyze-data',
  standalone: true,
  imports: [
    AnalysisChartComponent,
    DatePipe,
    DecimalPipe,
    FormsModule,
    LucideArrowLeft,
    LucideBadgeCheck,
    LucideChartNoAxesCombined,
    LucideChartPie,
    LucideCheckCircle2,
    LucideCircleAlert,
    LucideClock3,
    LucideColumns3,
    LucideCopy,
    LucideDatabase,
    LucideLayers3,
    LucidePlay,
    LucideRefreshCw,
    LucideSearch,
    LucideShieldCheck,
    LucideTable2,
    LucideTriangleAlert,
    LucideWandSparkles,
    NgClass,
    RouterLink,
  ],
  templateUrl: './analyze-data.component.html',
  styleUrl: './analyze-data.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyzeDataComponent implements OnInit {
  private readonly api = inject(ForgeApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly themeService = inject(ThemeService);
  private loadVersion = 0;

  readonly project = signal<ProjectResponse | null>(null);
  readonly datasets = signal<DatasetResponse[]>([]);
  readonly analyses = signal<Record<number, DatasetAnalysisResponse>>({});
  readonly scope = signal<AnalysisScope>('project');
  readonly activeTab = signal<AnalysisTab>('overview');
  readonly loading = signal(false);
  readonly resultsLoading = signal(false);
  readonly loadError = signal('');
  readonly resultLoadFailures = signal<AnalysisFailure[]>([]);
  readonly running = signal(false);
  readonly progressCurrent = signal(0);
  readonly progressTotal = signal(0);
  readonly progressDataset = signal('');
  readonly executionFailures = signal<AnalysisFailure[]>([]);
  readonly feedback = signal<{ kind: 'success' | 'warning' | 'error'; title: string; message: string } | null>(null);
  readonly datasetSearch = signal('');
  readonly columnSearch = signal('');
  readonly columnDatasetFilter = signal<number | 'all'>('all');
  readonly columnTypeFilter = signal('all');
  readonly columnIssueFilter = signal<IssueStateFilter>('all');
  readonly columnSort = signal<ColumnSort>('missing-desc');
  readonly columnPage = signal(1);
  readonly selectedColumnKey = signal<string | null>(null);
  readonly issueSearch = signal('');
  readonly issueDatasetFilter = signal<number | 'all'>('all');
  readonly issueTypeFilter = signal<'all' | AnalysisIssue['type']>('all');
  readonly issuePage = signal(1);
  readonly comparisonMetric = signal<ComparisonMetric>('rows');
  readonly comparisonOrder = signal<ComparisonOrder>('desc');
  readonly comparisonLimit = signal<5 | 10 | 'all'>(5);
  readonly comparisonOrientation = signal<ComparisonOrientation>('horizontal');
  readonly theme = this.themeService.theme;

  projectId = 0;
  readonly pageSize = 25;
  readonly tabs: Array<{ id: AnalysisTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'columns', label: 'Column Analysis' },
    { id: 'quality', label: 'Data Quality' },
    { id: 'visualizations', label: 'Visualizations' },
    { id: 'issues', label: 'Issues' },
  ];

  readonly selectedDataset = computed(() => {
    const scope = this.scope();
    return typeof scope === 'number' ? this.datasets().find((dataset) => dataset.id === scope) ?? null : null;
  });

  readonly scopeDatasets = computed(() => {
    const selected = this.selectedDataset();
    return selected ? [selected] : this.datasets();
  });

  readonly scopeAnalyses = computed(() => {
    const ids = new Set(this.scopeDatasets().map((dataset) => dataset.id));
    return Object.values(this.analyses()).filter((analysis) => ids.has(analysis.datasetId));
  });

  readonly filteredDatasets = computed(() => {
    const query = this.datasetSearch().trim().toLocaleLowerCase();
    return query
      ? this.datasets().filter((dataset) => `${dataset.tableName} ${dataset.sourceName ?? ''}`.toLocaleLowerCase().includes(query))
      : this.datasets();
  });

  readonly issues = computed<AnalysisIssue[]>(() => {
    const issues: AnalysisIssue[] = [];
    for (const analysis of this.scopeAnalyses()) {
      const dataset = this.datasets().find((item) => item.id === analysis.datasetId);
      const datasetName = dataset?.tableName ?? analysis.tableName;
      const result = analysis.analysisResult;
      if (result.duplicateRowsCount > 0) {
        issues.push({
          key: `${analysis.datasetId}:duplicates`,
          datasetId: analysis.datasetId,
          datasetName,
          type: 'Duplicate rows',
          column: null,
          count: result.duplicateRowsCount,
          percentage: result.rowCount > 0 ? result.duplicateRowsCount / result.rowCount * 100 : null,
          description: `The analysis detected duplicate records in ${datasetName}.`,
        });
      }
      for (const column of result.columns) {
        if (column.missingValuesCount <= 0) continue;
        issues.push({
          key: `${analysis.datasetId}:missing:${column.columnName}`,
          datasetId: analysis.datasetId,
          datasetName,
          type: 'Missing values',
          column: column.columnName,
          count: column.missingValuesCount,
          percentage: result.rowCount > 0 ? column.missingValuesCount / result.rowCount * 100 : null,
          description: `${column.columnName} contains missing values in ${datasetName}.`,
        });
      }
    }
    return issues.sort((left, right) => right.count - left.count || left.datasetName.localeCompare(right.datasetName));
  });

  readonly summary = computed<ScopeSummary>(() => {
    const datasets = this.scopeDatasets();
    const analyses = this.scopeAnalyses();
    const totalRows = datasets.reduce((sum, dataset) => sum + dataset.rowCount, 0);
    const totalColumns = datasets.reduce((sum, dataset) => sum + dataset.columnCount, 0);
    const analyzedRows = analyses.reduce((sum, analysis) => sum + analysis.analysisResult.rowCount, 0);
    const analyzedCells = analyses.reduce((sum, analysis) => sum + analysis.analysisResult.rowCount * analysis.analysisResult.columnCount, 0);
    const missingValues = analyses.reduce((sum, analysis) => sum + analysis.analysisResult.missingValuesCount, 0);
    const duplicateRows = analyses.reduce((sum, analysis) => sum + analysis.analysisResult.duplicateRowsCount, 0);
    const typeCounts = new Map<string, number>();
    for (const analysis of analyses) {
      if (analysis.analysisResult.columns.length > 0) {
        for (const column of analysis.analysisResult.columns) {
          const type = this.normalizedType(column.detectedDataType);
          typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
        }
      } else {
        for (const distribution of analysis.analysisResult.columnTypeDistribution) {
          const type = this.normalizedType(distribution.dataType);
          typeCounts.set(type, (typeCounts.get(type) ?? 0) + distribution.count);
        }
      }
    }
    const dates = analyses.map((analysis) => analysis.analyzedAt).filter((value): value is string => Boolean(value));
    const typeEntries = Array.from(typeCounts.entries()).map(([type, count]) => ({ type, count })).sort((left, right) => right.count - left.count);
    return {
      totalDatasets: datasets.length,
      analyzedDatasets: analyses.length,
      notAnalyzedDatasets: Math.max(datasets.length - analyses.length, 0),
      totalRows,
      totalColumns,
      analyzedRows,
      analyzedCells,
      missingValues,
      missingPercentage: analyzedCells > 0 ? missingValues / analyzedCells * 100 : null,
      duplicateRows,
      duplicatePercentage: analyzedRows > 0 ? duplicateRows / analyzedRows * 100 : null,
      issueCount: this.issues().length,
      typeCounts: typeEntries,
      numericColumns: this.typeCategoryCount(typeEntries, 'numeric'),
      textColumns: this.typeCategoryCount(typeEntries, 'text'),
      dateColumns: this.typeCategoryCount(typeEntries, 'date'),
      booleanColumns: this.typeCategoryCount(typeEntries, 'boolean'),
      lastAnalyzedAt: dates.sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null,
    };
  });

  readonly columns = computed<AnalysisColumnRow[]>(() => {
    const rows: AnalysisColumnRow[] = [];
    for (const analysis of this.scopeAnalyses()) {
      const dataset = this.datasets().find((item) => item.id === analysis.datasetId);
      const rowCount = analysis.analysisResult.rowCount;
      for (const column of analysis.analysisResult.columns) {
        const nonNullCount = Math.max(rowCount - column.missingValuesCount, 0);
        rows.push({
          key: `${analysis.datasetId}:${column.columnName}`,
          datasetId: analysis.datasetId,
          datasetName: dataset?.tableName ?? analysis.tableName,
          sourceName: dataset?.sourceName ?? analysis.tableName,
          column,
          missingPercentage: rowCount > 0 ? column.missingValuesCount / rowCount * 100 : null,
          nonNullCount,
          cardinality: nonNullCount > 0 ? column.uniqueValuesCount / nonNullCount * 100 : null,
          issueCount: column.missingValuesCount > 0 ? 1 : 0,
        });
      }
    }
    return rows;
  });

  readonly columnTypes = computed(() => Array.from(new Set(this.columns().map((row) => row.column.detectedDataType))).sort());

  readonly filteredColumns = computed(() => {
    const query = this.columnSearch().trim().toLocaleLowerCase();
    const datasetFilter = this.columnDatasetFilter();
    const typeFilter = this.columnTypeFilter();
    const issueFilter = this.columnIssueFilter();
    const rows = this.columns().filter((row) => {
      if (query && !`${row.column.columnName} ${row.datasetName}`.toLocaleLowerCase().includes(query)) return false;
      if (datasetFilter !== 'all' && row.datasetId !== datasetFilter) return false;
      if (typeFilter !== 'all' && row.column.detectedDataType !== typeFilter) return false;
      if (issueFilter === 'with-issues' && row.issueCount === 0) return false;
      if (issueFilter === 'without-missing' && row.column.missingValuesCount > 0) return false;
      return true;
    });
    const sort = this.columnSort();
    return [...rows].sort((left, right) => {
      if (sort === 'name-asc') return left.column.columnName.localeCompare(right.column.columnName) || left.datasetName.localeCompare(right.datasetName);
      if (sort === 'issues-desc') return right.issueCount - left.issueCount || right.column.missingValuesCount - left.column.missingValuesCount;
      return (right.missingPercentage ?? -1) - (left.missingPercentage ?? -1) || left.column.columnName.localeCompare(right.column.columnName);
    });
  });

  readonly columnPageCount = computed(() => Math.max(Math.ceil(this.filteredColumns().length / this.pageSize), 1));
  readonly pagedColumns = computed(() => this.filteredColumns().slice((this.columnPage() - 1) * this.pageSize, this.columnPage() * this.pageSize));
  readonly selectedColumn = computed(() => this.columns().find((row) => row.key === this.selectedColumnKey()) ?? null);
  readonly impactedColumns = computed(() => this.columns()
    .filter((row) => row.column.missingValuesCount > 0)
    .sort((left, right) => right.column.missingValuesCount - left.column.missingValuesCount)
    .slice(0, 8));

  readonly filteredIssues = computed(() => {
    const query = this.issueSearch().trim().toLocaleLowerCase();
    const datasetFilter = this.issueDatasetFilter();
    const typeFilter = this.issueTypeFilter();
    return this.issues().filter((issue) => {
      if (query && !`${issue.type} ${issue.datasetName} ${issue.column ?? ''}`.toLocaleLowerCase().includes(query)) return false;
      if (datasetFilter !== 'all' && issue.datasetId !== datasetFilter) return false;
      if (typeFilter !== 'all' && issue.type !== typeFilter) return false;
      return true;
    });
  });
  readonly issuePageCount = computed(() => Math.max(Math.ceil(this.filteredIssues().length / this.pageSize), 1));
  readonly pagedIssues = computed(() => this.filteredIssues().slice((this.issuePage() - 1) * this.pageSize, this.issuePage() * this.pageSize));

  readonly comparisonPoints = computed<ComparisonPoint[]>(() => {
    const metric = this.comparisonMetric();
    const analysisMap = this.analyses();
    let points = this.scopeDatasets().flatMap((dataset) => {
      const analysis = analysisMap[dataset.id];
      if ((metric === 'missing' || metric === 'duplicates') && !analysis) return [];
      const value = metric === 'rows' ? dataset.rowCount
        : metric === 'columns' ? dataset.columnCount
          : metric === 'missing' ? analysis.analysisResult.missingValuesCount
            : analysis.analysisResult.duplicateRowsCount;
      return [{ datasetId: dataset.id, label: dataset.tableName, value }];
    });
    points = points.sort((left, right) => this.comparisonOrder() === 'desc' ? right.value - left.value : left.value - right.value);
    const limit = this.comparisonLimit();
    return limit === 'all' ? points : points.slice(0, limit);
  });
  readonly rowsBySourcePoints = computed<ComparisonPoint[]>(() => this.sortAndLimit(
    this.scopeDatasets().map((dataset) => ({ datasetId: dataset.id, label: dataset.tableName, value: dataset.rowCount })),
  ));

  readonly missingByDatasetPoints = computed<ComparisonPoint[]>(() => this.sortAndLimit(
    this.scopeAnalyses().map((analysis) => ({
      datasetId: analysis.datasetId,
      label: this.datasetName(analysis.datasetId, analysis.tableName),
      value: analysis.analysisResult.missingValuesCount,
    })),
  ));

  readonly duplicateByDatasetPoints = computed<ComparisonPoint[]>(() => this.sortAndLimit(
    this.scopeAnalyses().map((analysis) => ({
      datasetId: analysis.datasetId,
      label: this.datasetName(analysis.datasetId, analysis.tableName),
      value: analysis.analysisResult.duplicateRowsCount,
    })),
  ));

  readonly typeDistribution = computed(() => {
    const summary = this.summary();
    const categorized = [
      { name: 'Numeric', value: summary.numericColumns },
      { name: 'Text / String', value: summary.textColumns },
      { name: 'Date / Time', value: summary.dateColumns },
      { name: 'Boolean', value: summary.booleanColumns },
    ];
    const known = categorized.reduce((total, item) => total + item.value, 0);
    const all = summary.typeCounts.reduce((total, item) => total + item.count, 0);
    return [...categorized, { name: 'Other', value: Math.max(all - known, 0) }].filter((item) => item.value > 0);
  });

  readonly rowsBySourceOption = computed<EChartsCoreOption | null>(() => {
    const points = this.rowsBySourcePoints();
    return points.length > 0 ? this.buildBarOption(points, 'Rows', 'horizontal', '#2563eb') : null;
  });

  readonly columnTypeOption = computed<EChartsCoreOption | null>(() => {
    const values = this.typeDistribution();
    return values.length > 0 ? this.buildDonutOption(values) : null;
  });

  readonly missingValuesOption = computed<EChartsCoreOption | null>(() => {
    const points = this.missingByDatasetPoints();
    return points.length > 0 ? this.buildBarOption(points, 'Missing values (count)', 'vertical', '#0d9488') : null;
  });

  readonly analysisCoverageOption = computed<EChartsCoreOption | null>(() => {
    const summary = this.summary();
    if (summary.totalDatasets === 0) return null;
    const percentage = summary.analyzedDatasets / summary.totalDatasets * 100;
    const colors = this.chartColors();
    return {
      animationDuration: 450,
      aria: { enabled: true, decal: { show: false } },
      series: [{
        type: 'gauge',
        min: 0,
        max: 100,
        startAngle: 210,
        endAngle: -30,
        center: ['50%', '56%'],
        radius: '86%',
        progress: { show: true, width: 16, roundCap: true, itemStyle: { color: '#14b8a6' } },
        axisLine: { lineStyle: { width: 16, color: [[1, colors.track]] } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        pointer: { show: false },
        anchor: { show: false },
        title: { offsetCenter: [0, '35%'], color: colors.muted, fontSize: 12 },
        detail: { valueAnimation: true, offsetCenter: [0, '-3%'], color: colors.text, fontSize: 28, fontWeight: 700, formatter: '{value}%' },
        data: [{ value: Number(percentage.toFixed(1)), name: `${summary.analyzedDatasets} of ${summary.totalDatasets} datasets` }],
      }],
    };
  });

  readonly issuesByTypeOption = computed<EChartsCoreOption | null>(() => {
    const summary = this.summary();
    if (summary.analyzedDatasets === 0 || summary.missingValues + summary.duplicateRows === 0) return null;
    return this.buildBarOption([
      { datasetId: -1, label: 'Missing values', value: summary.missingValues },
      { datasetId: -2, label: 'Duplicate rows', value: summary.duplicateRows },
    ], 'Detected count', 'vertical', '#f59e0b');
  });

  readonly duplicateRowsOption = computed<EChartsCoreOption | null>(() => {
    const points = this.duplicateByDatasetPoints();
    return points.some((point) => point.value > 0) ? this.buildBarOption(points, 'Duplicate rows', 'horizontal', '#e11d48') : null;
  });

  readonly topMissingColumnsOption = computed<EChartsCoreOption | null>(() => {
    const points = this.impactedColumns().map((row, index) => ({
      datasetId: index,
      label: `${row.column.columnName} · ${row.datasetName}`,
      value: row.column.missingValuesCount,
    }));
    return points.length > 0 ? this.buildBarOption(points, 'Missing values', 'horizontal', '#f59e0b') : null;
  });

  readonly comparisonChartOption = computed<EChartsCoreOption | null>(() => {
    const points = this.comparisonPoints();
    return points.length > 0
      ? this.buildBarOption(points, this.comparisonMetricLabel(), this.comparisonOrientation(), '#6366f1')
      : null;
  });

  readonly renderedRecommendations = computed<RenderedRecommendation[]>(() => this.scopeAnalyses().flatMap((analysis) => {
    const datasetName = this.datasets().find((dataset) => dataset.id === analysis.datasetId)?.tableName ?? analysis.tableName;
    return analysis.chartRecommendations
      .filter((chart) => (chart.previewData?.length ?? 0) > 0)
      .map((chart, index) => ({
        key: `${analysis.datasetId}:${chart.title}:${index}`,
        datasetName,
        title: chart.title,
        chartType: chart.chartType,
        reason: chart.reason || chart.usefulness || 'Recommended by the dataset analysis response.',
        option: this.buildBarOption((chart.previewData ?? []).map((point, pointIndex) => ({
          datasetId: pointIndex,
          label: point.label,
          value: point.value,
        })), 'Value', 'vertical', '#0d9488'),
        summary: `${chart.title} for ${datasetName}: ${(chart.previewData ?? []).map((point) => `${point.label} ${point.value.toLocaleString()}`).join(', ')}.`,
      }));
  }));

  readonly analysisSummaryStatements = computed(() => {
    const summary = this.summary();
    const missingLeader = [...this.missingByDatasetPoints()].sort((left, right) => right.value - left.value)[0];
    const dominantType = [...this.typeDistribution()].sort((left, right) => right.value - left.value)[0];
    const highestColumn = this.impactedColumns()[0];
    return [
      `${summary.analyzedDatasets} of ${summary.totalDatasets} datasets have loaded analysis results.`,
      `${summary.notAnalyzedDatasets} dataset${summary.notAnalyzedDatasets === 1 ? '' : 's'} remain not analyzed.`,
      missingLeader ? `${missingLeader.label} has the most missing values (${missingLeader.value.toLocaleString()}).` : 'No analyzed dataset missing-value totals are available.',
      `${summary.duplicateRows.toLocaleString()} duplicate rows were detected across the current scope.`,
      dominantType ? `${dominantType.name} is the dominant detected column type (${dominantType.value.toLocaleString()} columns).` : 'No detected column types are available.',
      highestColumn ? `${highestColumn.column.columnName} in ${highestColumn.datasetName} is the most impacted column with ${highestColumn.column.missingValuesCount.toLocaleString()} missing values.` : 'No columns with missing values were returned.',
    ];
  });

  readonly rowsBySourceSummary = computed(() => this.pointSummary('Rows by data source', this.rowsBySourcePoints()));
  readonly missingValuesSummary = computed(() => this.pointSummary('Missing values by dataset', this.missingByDatasetPoints()));
  readonly duplicateRowsSummary = computed(() => this.pointSummary('Duplicate rows by dataset', this.duplicateByDatasetPoints()));
  readonly topMissingColumnsSummary = computed(() => this.impactedColumns().length > 0
    ? `Top missing columns: ${this.impactedColumns().map((row) => `${row.column.columnName} in ${row.datasetName}, ${row.column.missingValuesCount.toLocaleString()} missing`).join('; ')}.`
    : 'No columns with missing values are available.');
  readonly typeDistributionSummary = computed(() => this.typeDistribution().length > 0
    ? `Column type distribution: ${this.typeDistribution().map((item) => `${item.name} ${item.value.toLocaleString()}`).join(', ')}.`
    : 'No column type distribution is available.');
  readonly coverageSummary = computed(() => `${this.summary().analyzedDatasets} of ${this.summary().totalDatasets} datasets are analyzed, ${this.summary().totalDatasets > 0 ? (this.summary().analyzedDatasets / this.summary().totalDatasets * 100).toFixed(1) : '0'} percent coverage.`);
  readonly issuesByTypeSummary = computed(() => `${this.summary().missingValues.toLocaleString()} missing values and ${this.summary().duplicateRows.toLocaleString()} duplicate rows were detected.`);
  readonly comparisonSummary = computed(() => this.pointSummary(`${this.comparisonMetricLabel()} by data source`, this.comparisonPoints()));

  readonly highestImpactIssue = computed(() => this.issues()[0] ?? null);
  readonly datasetsNeedingAttention = computed(() => new Set(this.issues().map((issue) => issue.datasetId)).size);
  readonly isProjectScope = computed(() => this.scope() === 'project');
  readonly scopeLabel = computed(() => this.isProjectScope() ? 'All Project Data' : this.selectedDataset()?.tableName ?? 'Selected Dataset');
  readonly runButtonLabel = computed(() => {
    if (this.running()) return this.progressTotal() ? `Analyzing ${this.progressCurrent()} of ${this.progressTotal()}` : 'Preparing Analysis';
    if (this.executionFailures().length > 0 || this.resultLoadFailures().length > 0) return 'Retry Failed Analysis';
    const summary = this.summary();
    if (summary.totalDatasets > 0 && summary.analyzedDatasets === summary.totalDatasets) return this.isProjectScope() ? 'Re-run Project Analysis' : 'Re-run Analysis';
    return this.isProjectScope() ? 'Run Project Analysis' : 'Run Analysis';
  });

  ngOnInit(): void {
    this.projectId = routeParameter(this.route, 'projectId') ?? 0;
    if (this.projectId <= 0) {
      void this.router.navigate(['/projects']);
      return;
    }
    this.loadProjectWorkspace(queryParameter(this.route, 'datasetId') ?? undefined);
  }

  selectProjectScope(): void {
    if (this.projectId <= 0 || this.running()) return;
    this.scope.set('project');
    this.selectedColumnKey.set(null);
    this.resetFiltersForScope();
    void this.router.navigate(['/projects', this.projectId, 'analyze'], { queryParams: {}, replaceUrl: true });
  }

  selectDataset(dataset: DatasetResponse): void {
    if (this.running()) return;
    this.scope.set(dataset.id);
    this.selectedColumnKey.set(null);
    this.resetFiltersForScope();
    void this.router.navigate(['/projects', this.projectId, 'analyze'], { queryParams: { datasetId: dataset.id }, replaceUrl: true });
  }

  selectTab(tab: AnalysisTab): void {
    this.activeTab.set(tab);
  }

  async runAnalysis(): Promise<void> {
    if (this.running() || this.scopeDatasets().length === 0) return;
    const targets = this.analysisTargets();
    if (targets.length === 0) return;

    this.running.set(true);
    this.feedback.set(null);
    this.progressCurrent.set(0);
    this.progressTotal.set(targets.length);
    this.executionFailures.set([]);
    const successes: number[] = [];
    const failures: AnalysisFailure[] = [];

    for (let index = 0; index < targets.length; index++) {
      const dataset = targets[index];
      this.progressCurrent.set(index + 1);
      this.progressDataset.set(dataset.tableName);
      try {
        const response = await firstValueFrom(this.api.analyzeDataset(dataset.id, { analysisType: 'profile' }));
        successes.push(dataset.id);
        this.analyses.update((current) => ({ ...current, [dataset.id]: response }));
        this.datasets.update((current) => current.map((item) => item.id === dataset.id ? { ...item, status: response.status || 'Analyzed' } : item));
      } catch (error: unknown) {
        failures.push({ datasetId: dataset.id, datasetName: dataset.tableName, message: this.errorMessage(error, 'Analysis request failed.') });
      }
    }

    if (successes.length > 0) await this.reloadSuccessfulResults(successes);
    this.executionFailures.set(failures);
    this.running.set(false);
    this.progressDataset.set('');
    if (failures.length === 0) {
      this.feedback.set({ kind: 'success', title: 'Analysis completed', message: `${successes.length} dataset${successes.length === 1 ? '' : 's'} analyzed successfully.` });
    } else if (successes.length > 0) {
      this.feedback.set({ kind: 'warning', title: 'Analysis partially completed', message: `${successes.length} succeeded and ${failures.length} failed. Retry will process only failed datasets.` });
    } else {
      this.feedback.set({ kind: 'error', title: 'Analysis failed', message: `All ${failures.length} analysis requests failed. Review the dataset failures and retry.` });
    }
  }

  updateDatasetSearch(value: string): void { this.datasetSearch.set(value); }
  updateColumnSearch(value: string): void { this.columnSearch.set(value); this.columnPage.set(1); }
  updateColumnDatasetFilter(value: number | 'all'): void { this.columnDatasetFilter.set(value === 'all' ? 'all' : Number(value)); this.columnPage.set(1); }
  updateColumnTypeFilter(value: string): void { this.columnTypeFilter.set(value); this.columnPage.set(1); }
  updateColumnIssueFilter(value: IssueStateFilter): void { this.columnIssueFilter.set(value); this.columnPage.set(1); }
  updateColumnSort(value: ColumnSort): void { this.columnSort.set(value); this.columnPage.set(1); }
  updateIssueSearch(value: string): void { this.issueSearch.set(value); this.issuePage.set(1); }
  updateIssueDatasetFilter(value: number | 'all'): void { this.issueDatasetFilter.set(value === 'all' ? 'all' : Number(value)); this.issuePage.set(1); }
  updateIssueTypeFilter(value: 'all' | AnalysisIssue['type']): void { this.issueTypeFilter.set(value); this.issuePage.set(1); }
  previousColumnPage(): void { this.columnPage.update((page) => Math.max(page - 1, 1)); }
  nextColumnPage(): void { this.columnPage.update((page) => Math.min(page + 1, this.columnPageCount())); }
  previousIssuePage(): void { this.issuePage.update((page) => Math.max(page - 1, 1)); }
  nextIssuePage(): void { this.issuePage.update((page) => Math.min(page + 1, this.issuePageCount())); }
  toggleColumn(row: AnalysisColumnRow): void { this.selectedColumnKey.update((key) => key === row.key ? null : row.key); }
  updateComparisonMetric(value: ComparisonMetric): void { this.comparisonMetric.set(value); }
  updateComparisonOrder(value: ComparisonOrder): void { this.comparisonOrder.set(value); }
  updateComparisonLimit(value: 5 | 10 | 'all'): void { this.comparisonLimit.set(value === 'all' ? 'all' : Number(value) as 5 | 10); }
  updateComparisonOrientation(value: ComparisonOrientation): void { this.comparisonOrientation.set(value); }

  isDatasetAnalyzed(dataset: DatasetResponse): boolean { return Boolean(this.analyses()[dataset.id]); }
  hasDatasetIssues(dataset: DatasetResponse): boolean { return this.issues().some((issue) => issue.datasetId === dataset.id); }
  datasetDisplayName(dataset: DatasetResponse): string { return dataset.sourceName || dataset.tableName; }
  topValuePercent(values: ValueFrequency[], count: number): number { return count / Math.max(...values.map((value) => value.count), 1) * 100; }
  formatValue(value: string | null | undefined): string { return value === null || value === undefined || value === '' ? 'NULL' : value; }
  comparisonMetricLabel(): string {
    const labels: Record<ComparisonMetric, string> = { rows: 'Rows', columns: 'Columns', missing: 'Missing values', duplicates: 'Duplicate rows' };
    return labels[this.comparisonMetric()];
  }

  private sortAndLimit(points: ComparisonPoint[]): ComparisonPoint[] {
    const ordered = [...points].sort((left, right) => this.comparisonOrder() === 'desc'
      ? right.value - left.value || left.label.localeCompare(right.label)
      : left.value - right.value || left.label.localeCompare(right.label));
    const limit = this.comparisonLimit();
    return limit === 'all' ? ordered : ordered.slice(0, limit);
  }

  private datasetName(datasetId: number, fallback: string): string {
    return this.datasets().find((dataset) => dataset.id === datasetId)?.tableName ?? fallback;
  }

  private pointSummary(title: string, points: ComparisonPoint[]): string {
    if (points.length === 0) return `${title}: no values are available for the current scope.`;
    return `${title}: ${points.map((point) => `${point.label} ${point.value.toLocaleString()}`).join(', ')}.`;
  }

  private chartColors(): { text: string; muted: string; line: string; track: string; tooltip: string; tooltipBorder: string } {
    return this.theme() === 'dark'
      ? { text: '#e2e8f0', muted: '#94a3b8', line: '#334155', track: '#1e293b', tooltip: '#0f172a', tooltipBorder: '#475569' }
      : { text: '#0f172a', muted: '#64748b', line: '#e2e8f0', track: '#e2e8f0', tooltip: '#ffffff', tooltipBorder: '#cbd5e1' };
  }

  private buildBarOption(points: ComparisonPoint[], valueName: string, orientation: ComparisonOrientation, color: string): EChartsCoreOption {
    const colors = this.chartColors();
    const categories = points.map((point) => point.label);
    const values = points.map((point) => point.value);
    const categoryAxis = {
      type: 'category' as const,
      data: categories,
      axisLine: { lineStyle: { color: colors.line } },
      axisTick: { show: false },
      axisLabel: { color: colors.muted, fontSize: 11, hideOverlap: true },
    };
    const valueAxis = {
      type: 'value' as const,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: colors.muted, fontSize: 11 },
      splitLine: { lineStyle: { color: colors.line, type: 'dashed' as const } },
      minInterval: 1,
    };
    return {
      animationDuration: 450,
      aria: { enabled: true, decal: { show: false } },
      color: [color],
      grid: orientation === 'horizontal'
        ? { left: 8, right: 20, top: 20, bottom: 20, containLabel: true }
        : { left: 12, right: 12, top: 28, bottom: categories.length > 5 ? 78 : 48, containLabel: true },
      tooltip: {
        trigger: 'axis',
        backgroundColor: colors.tooltip,
        borderColor: colors.tooltipBorder,
        textStyle: { color: colors.text },
        axisPointer: { type: 'shadow' },
      },
      xAxis: orientation === 'horizontal'
        ? valueAxis
        : { ...categoryAxis, axisLabel: { ...categoryAxis.axisLabel, rotate: categories.length > 4 ? 28 : 0 } },
      yAxis: orientation === 'horizontal' ? categoryAxis : valueAxis,
      series: [{
        type: 'bar',
        name: valueName,
        data: values,
        barMaxWidth: orientation === 'horizontal' ? 24 : 42,
        itemStyle: { color, borderRadius: orientation === 'horizontal' ? [0, 6, 6, 0] : [6, 6, 0, 0] },
        emphasis: { itemStyle: { color } },
      }],
    };
  }

  private buildDonutOption(values: Array<{ name: string; value: number }>): EChartsCoreOption {
    const colors = this.chartColors();
    return {
      animationDuration: 450,
      aria: { enabled: true, decal: { show: false } },
      color: ['#2563eb', '#14b8a6', '#8b5cf6', '#f59e0b', '#94a3b8'],
      tooltip: {
        trigger: 'item',
        backgroundColor: colors.tooltip,
        borderColor: colors.tooltipBorder,
        textStyle: { color: colors.text },
      },
      legend: {
        left: 'center',
        bottom: 0,
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { color: colors.muted, fontSize: 11 },
      },
      series: [{
        name: 'Columns',
        type: 'pie',
        radius: ['48%', '72%'],
        center: ['50%', '43%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: this.theme() === 'dark' ? '#0f172a' : '#ffffff', borderWidth: 3, borderRadius: 5 },
        label: { color: colors.text, fontSize: 11, formatter: '{b}\n{c}' },
        labelLine: { lineStyle: { color: colors.line } },
        data: values,
      }],
    };
  }

  private loadProjectWorkspace(routeDatasetId?: number): void {
    const version = ++this.loadVersion;
    this.loading.set(true);
    this.loadError.set('');
    forkJoin({ project: this.api.getProject(this.projectId), datasets: this.api.getProjectDatasets(this.projectId) })
      .pipe(finalize(() => { if (version === this.loadVersion) this.loading.set(false); }))
      .subscribe({
        next: ({ project, datasets }) => {
          if (version !== this.loadVersion) return;
          this.project.set(project);
          this.datasets.set(datasets);
          const queryDatasetId = this.validId(Number(this.route.snapshot.queryParamMap.get('datasetId')));
          const requestedDatasetId = routeDatasetId ?? queryDatasetId;
          const selected = requestedDatasetId ? datasets.find((dataset) => dataset.id === requestedDatasetId) : undefined;
          if (selected) {
            this.scope.set(selected.id);
          } else {
            this.scope.set('project');
          }
          this.loadAnalysisResults(datasets, version);
        },
        error: (error: unknown) => {
          if (version === this.loadVersion) this.loadError.set(this.errorMessage(error, 'Unable to load the project analysis workspace.'));
        },
      });
  }

  private loadStandaloneDataset(datasetId: number): void {
    const version = ++this.loadVersion;
    this.loading.set(true);
    this.loadError.set('');
    this.api.getDatasetAnalysis(datasetId).pipe(finalize(() => { if (version === this.loadVersion) this.loading.set(false); })).subscribe({
      next: (analysis) => {
        if (version !== this.loadVersion) return;
        const dataset: DatasetResponse = {
          id: analysis.datasetId,
          projectId: 0,
          tableName: analysis.tableName,
          sourceType: 'Unavailable',
          sourceName: analysis.tableName,
          rowCount: analysis.analysisResult.rowCount,
          columnCount: analysis.analysisResult.columnCount,
          missingValuesCount: analysis.analysisResult.missingValuesCount,
          duplicateRowsCount: analysis.analysisResult.duplicateRowsCount,
          status: analysis.status,
          createdAt: '',
        };
        this.datasets.set([dataset]);
        this.analyses.set({ [dataset.id]: analysis });
        this.scope.set(dataset.id);
      },
      error: (error: unknown) => this.loadError.set(this.errorMessage(error, 'Unable to load saved analysis. Open this page from a project to restore full context.')),
    });
  }

  private loadAnalysisResults(datasets: DatasetResponse[], version: number): void {
    const analyzed = datasets.filter((dataset) => dataset.status.toLocaleLowerCase() === 'analyzed');
    if (analyzed.length === 0) {
      this.analyses.set({});
      this.resultLoadFailures.set([]);
      this.resultsLoading.set(false);
      return;
    }
    this.resultsLoading.set(true);
    from(analyzed).pipe(
      mergeMap((dataset) => this.api.getDatasetAnalysis(dataset.id).pipe(
        map((analysis): AnalysisLoadResult => ({ dataset, analysis, error: '' })),
        catchError((error: unknown) => of<AnalysisLoadResult>({ dataset, analysis: null, error: this.errorMessage(error, 'Saved analysis could not be loaded.') })),
      ), 4),
      toArray(),
    ).subscribe((results) => {
      if (version !== this.loadVersion) return;
      const analyses: Record<number, DatasetAnalysisResponse> = {};
      const failures: AnalysisFailure[] = [];
      for (const result of results) {
        if (result.analysis) analyses[result.dataset.id] = result.analysis;
        else failures.push({ datasetId: result.dataset.id, datasetName: result.dataset.tableName, message: result.error });
      }
      this.analyses.set(analyses);
      this.resultLoadFailures.set(failures);
      this.resultsLoading.set(false);
    });
  }

  private async reloadSuccessfulResults(datasetIds: number[]): Promise<void> {
    const results = await firstValueFrom(
      from(datasetIds).pipe(
        mergeMap((datasetId) => this.api.getDatasetAnalysis(datasetId).pipe(
          map((analysis) => ({ datasetId, analysis })),
          catchError(() => of({ datasetId, analysis: null })),
        ), 4),
        toArray(),
      ),
    );
    this.analyses.update((current) => {
      const updated = { ...current };
      for (const result of results) if (result.analysis) updated[result.datasetId] = result.analysis;
      return updated;
    });
    const successfulIds = new Set(datasetIds);
    this.resultLoadFailures.update((failures) => failures.filter((failure) => !successfulIds.has(failure.datasetId)));
  }

  private analysisTargets(): DatasetResponse[] {
    if (!this.isProjectScope()) return this.selectedDataset() ? [this.selectedDataset()!] : [];
    const failedIds = new Set([...this.executionFailures(), ...this.resultLoadFailures()].map((failure) => failure.datasetId));
    const pending = this.datasets().filter((dataset) => failedIds.has(dataset.id) || !this.analyses()[dataset.id]);
    return pending.length > 0 ? pending : this.datasets();
  }

  private resetFiltersForScope(): void {
    this.columnDatasetFilter.set('all');
    this.issueDatasetFilter.set('all');
    this.columnPage.set(1);
    this.issuePage.set(1);
  }

  private typeCategoryCount(types: TypeCount[], category: 'numeric' | 'text' | 'date' | 'boolean'): number {
    return types.filter((item) => this.typeCategory(item.type) === category).reduce((sum, item) => sum + item.count, 0);
  }

  private normalizedType(value: string): string {
    const normalized = value.trim().toLocaleLowerCase().replace(/[_\s-]+/g, ' ');
    return normalized || 'unknown';
  }

  private typeCategory(type: string): 'numeric' | 'text' | 'date' | 'boolean' | 'other' {
    if (/int|decimal|number|numeric|float|double|real/.test(type)) return 'numeric';
    if (/date|time/.test(type)) return 'date';
    if (/bool/.test(type)) return 'boolean';
    if (/string|text|char|categor/.test(type)) return 'text';
    return 'other';
  }

  private validId(value: number): number | undefined {
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && error.error && typeof error.error === 'object' && 'message' in error.error) {
      const message = (error.error as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) return message;
    }
    return fallback;
  }
}
