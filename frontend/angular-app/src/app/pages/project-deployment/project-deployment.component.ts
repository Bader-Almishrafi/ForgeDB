import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize, forkJoin } from 'rxjs';
import { ApiErrorBody, DeploymentResponse, DesignModelResponse } from '../../services/api.models';
import { DesignApiService } from '../../services/design-api.service';
import { FileDownloadService } from '../../services/file-download.service';
import { routeParameter } from '../../services/route-context';

@Component({
  selector: 'app-project-deployment',
  standalone: true,
  imports: [DatePipe, DecimalPipe, RouterLink],
  templateUrl: './project-deployment.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectDeploymentComponent implements OnInit {
  readonly design = signal<DesignModelResponse | null>(null);
  readonly sqlPreview = signal('');
  readonly latestDeployment = signal<DeploymentResponse | null>(null);
  readonly history = signal<DeploymentResponse[]>([]);
  readonly loading = signal(false);
  readonly deploying = signal(false);
  readonly confirmingDeploy = signal(false);
  readonly copied = signal(false);
  readonly downloadingFile = signal<string | null>(null);

  projectId = 0;
  errorMessage = '';

  constructor(
    private designApi: DesignApiService,
    private route: ActivatedRoute,
    private router: Router,
    private fileDownload: FileDownloadService,
  ) {}

  ngOnInit(): void {
    this.projectId = routeParameter(this.route, 'projectId') ?? 0;
    if (this.projectId <= 0) {
      this.router.navigate(['/projects']);
      return;
    }

    this.load();
  }

  load(): void {
    this.errorMessage = '';
    this.loading.set(true);

    forkJoin({
      design: this.designApi.getDesign(this.projectId),
      sql: this.designApi.getSchemaSql(this.projectId),
      history: this.designApi.getDeploymentHistory(this.projectId),
    }).pipe(finalize(() => this.loading.set(false))).subscribe({
      next: ({ design, sql, history }) => {
        this.design.set(design);
        this.sqlPreview.set(sql.sql);
        this.history.set(history);
        this.latestDeployment.set(history[0] ?? null);
      },
      error: (error: { error?: ApiErrorBody }) => {
        this.errorMessage = error.error?.message ?? 'Unable to load the design for deployment. Generate a schema first.';
      },
    });
  }

  errorIssueCount(): number {
    return this.design()?.validationIssues.filter((issue) => issue.severity === 'error').length ?? 0;
  }

  canDeploy(): boolean {
    const design = this.design();
    return !!design && design.tables.length > 0 && this.errorIssueCount() === 0;
  }

  confirmDeploy(): void {
    if (!this.canDeploy()) return;
    this.confirmingDeploy.set(true);
  }

  cancelDeploy(): void {
    this.confirmingDeploy.set(false);
  }

  deploy(): void {
    const design = this.design();
    if (!design || this.deploying()) return;

    this.deploying.set(true);
    this.errorMessage = '';
    this.designApi.deployProject(this.projectId, design.revision)
      .pipe(finalize(() => this.deploying.set(false)))
      .subscribe({
        next: (deployment) => {
          this.confirmingDeploy.set(false);
          this.latestDeployment.set(deployment);
          this.history.update((items) => [deployment, ...items]);
        },
        error: (error: unknown) => {
          this.confirmingDeploy.set(false);
          if (this.designApi.isRevisionConflict(error)) {
            this.errorMessage = 'The schema design changed elsewhere since this page loaded. Refreshing...';
            this.load();
            return;
          }
          this.errorMessage = this.errorText(error, 'Unable to deploy this project.');
        },
      });
  }

  copySql(): void {
    navigator.clipboard.writeText(this.sqlPreview())
      .then(() => {
        this.copied.set(true);
        window.setTimeout(() => this.copied.set(false), 2000);
      })
      .catch(() => {
        this.errorMessage = 'Unable to copy in this browser.';
      });
  }

  downloadSql(): void {
    this.fileDownload.downloadText(`${this.design()?.projectId ?? 'project'}-deployment.sql`, this.sqlPreview(), 'text/plain');
  }

  downloadDeploymentFile(fileName: 'schema.sql' | 'seed.sql' | 'deploy.sql'): void {
    const deployment = this.latestDeployment();
    if (!deployment || this.downloadingFile()) return;

    this.errorMessage = '';
    this.downloadingFile.set(fileName);
    this.designApi.downloadDeploymentSql(this.projectId, deployment.deploymentId, fileName)
      .pipe(finalize(() => this.downloadingFile.set(null)))
      .subscribe({
        next: (content) => this.fileDownload.downloadText(fileName, content, 'application/sql;charset=utf-8'),
        error: (error: unknown) => {
          this.errorMessage = this.errorText(error, `Unable to download ${fileName}.`);
        },
      });
  }

  rowCountEntries(deployment: DeploymentResponse): Array<{ table: string; count: number }> {
    return Object.entries(deployment.insertedRowCounts).map(([table, count]) => ({ table, count }));
  }

  private errorText(error: unknown, fallback: string): string {
    const body = (error as { error?: ApiErrorBody } | null)?.error;
    return (body?.message as string | undefined) ?? fallback;
  }
}
