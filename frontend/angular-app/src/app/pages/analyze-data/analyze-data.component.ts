import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { AnalysisScope, AnalyzeDataService } from './services/analyze-data.service';
import { routeParameter } from '../../services/route-context';
import { AnalysisSummaryComponent } from './components/analysis-summary.component';
import { AnalysisIssuesComponent } from './components/analysis-issues.component';
import { AnalysisColumnsComponent } from './components/analysis-columns.component';
import { AnalysisVisualizationsComponent } from './components/analysis-visualizations.component';
import { AnalysisRecommendationsComponent } from './components/analysis-recommendations.component';

type AnalysisSection = 'summary' | 'issues' | 'columns' | 'visualizations' | 'recommendations';

@Component({
  selector: 'app-analyze-data',
  standalone: true,
  providers: [AnalyzeDataService],
  imports: [
    FormsModule, 
    RouterLink,
    AnalysisSummaryComponent,
    AnalysisIssuesComponent,
    AnalysisColumnsComponent,
    AnalysisVisualizationsComponent,
    AnalysisRecommendationsComponent
  ],
  templateUrl: './analyze-data.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyzeDataComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  
  readonly service = inject(AnalyzeDataService);
  readonly activeSection = signal<AnalysisSection>('summary');
  readonly sections: ReadonlyArray<{ id: AnalysisSection; label: string }> = [
    { id: 'summary', label: 'Summary' },
    { id: 'issues', label: 'Issues' },
    { id: 'columns', label: 'Columns' },
    { id: 'visualizations', label: 'Visualizations' },
    { id: 'recommendations', label: 'Recommendations' },
  ];

  ngOnInit(): void {
    this.titleService.setTitle('Analysis - ForgeDB');
    this.metaService.updateTag({ name: 'description', content: 'Profile dataset quality and review analysis results.' });
    const projectId = routeParameter(this.route, 'projectId') ?? 0;
    if (!projectId || projectId <= 0) {
      void this.router.navigate(['/projects']);
      return;
    }
    
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const datasetIdRaw = params.get('datasetId');
      const datasetId = datasetIdRaw ? Number(datasetIdRaw) : null;
      if (this.service.datasets().length) {
        this.service.applyRouteScope(datasetId);
      } else {
        this.service.loadWorkspace(projectId, datasetId);
      }
    });
  }

  changeScope(value: AnalysisScope): void {
    this.service.setScope(value);
    this.updateDatasetQuery(value === 'project' ? null : Number(value), false);
  }

  openDataset(datasetId: number): void {
    this.changeScope(datasetId);
  }

  runAnalysis(): void {
    this.service.runAnalysis();
  }

  showSection(section: AnalysisSection): void {
    this.activeSection.set(section);
  }

  continueToClean(): void {
    if (!this.service.canContinueToClean()) return;
    const datasetId = this.service.selectedDataset()?.id;
    void this.router.navigate(['/projects', this.service.projectId, 'clean'], { queryParams: datasetId ? { datasetId } : {} });
  }

  backToDataQuery(): { datasetId: number } | Record<string, never> {
    const datasetId = this.service.selectedDataset()?.id;
    return datasetId ? { datasetId } : {};
  }

  private updateDatasetQuery(datasetId: number | null, replaceUrl: boolean): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { datasetId },
      queryParamsHandling: 'merge',
      replaceUrl,
    });
  }
}
