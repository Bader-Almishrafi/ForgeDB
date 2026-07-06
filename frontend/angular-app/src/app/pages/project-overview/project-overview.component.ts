import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { ApiErrorBody, ProjectOverview } from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { WorkflowStateService } from '../../services/workflow-state.service';

@Component({
  selector: 'app-project-overview',
  standalone: true,
  imports: [DatePipe, RouterLink],
  templateUrl: './project-overview.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectOverviewComponent implements OnInit {
  readonly overview = signal<ProjectOverview | null>(null);
  readonly loading = signal(false);

  projectId = 0;
  errorMessage = '';

  constructor(
    private api: ForgeApiService,
    private route: ActivatedRoute,
    private router: Router,
    private workflow: WorkflowStateService,
  ) {}

  ngOnInit(): void {
    this.projectId = Number(this.route.snapshot.paramMap.get('projectId'));
    if (!Number.isFinite(this.projectId) || this.projectId <= 0) {
      this.router.navigate(['/projects']);
      return;
    }

    this.workflow.setProjectId(this.projectId);
    this.loadOverview();
  }

  loadOverview(): void {
    this.errorMessage = '';
    this.loading.set(true);

    this.api.getProjectOverview(this.projectId)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (overview) => {
          this.overview.set(overview);
          this.workflow.setProjectId(overview.projectId, overview.projectName);
          const firstDataset = overview.recentDatasets[0];
          if (firstDataset) {
            this.workflow.setDataset(firstDataset);
          }
        },
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to load project overview.';
        },
      });
  }

  analyzedPercent(data: ProjectOverview): number {
    return Math.round((data.analyzedDatasetsCount / Math.max(data.datasetsCount, 1)) * 100);
  }
}
