import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, finalize, forkJoin, of } from 'rxjs';
import {
  ApiErrorBody,
  DeploymentPreview,
  DeploymentResponse,
  ProjectExportPackage,
  ProjectWorkflow,
} from '../../services/api.models';
import { DesignApiService } from '../../services/design-api.service';
import { FileDownloadService } from '../../services/file-download.service';
import { ForgeApiService } from '../../services/forge-api.service';
import { ProjectWorkflowContextService } from '../../services/project-workflow-context.service';
import { routeParameter } from '../../services/route-context';

type ExportArtifactName = 'schema.sql' | 'schema.json' | 'relationship-report.json' | 'data-quality-report.json';
type DeploymentFileName = 'schema.sql' | 'seed.sql' | 'deploy.sql';

interface ExportArtifact {
  name: ExportArtifactName;
  description: string;
  mimeType: string;
}

@Component({
  selector: 'app-export-deploy',
  standalone: true,
  imports: [DatePipe, DecimalPipe, RouterLink],
  templateUrl: './export-deploy.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExportDeployComponent implements OnInit {
  readonly workflow = computed(() => this.workflowContext.workflow());
  readonly workflowError = computed(() => this.workflowContext.error());
  readonly exportPackage = signal<ProjectExportPackage | null>(null);
  readonly deploymentPreview = signal<DeploymentPreview | null>(null);
  readonly history = signal<DeploymentResponse[]>([]);
  readonly latestDeployment = signal<DeploymentResponse | null>(null);
  readonly selectedDeployment = signal<DeploymentResponse | null>(null);
  readonly loading = signal(false);
  readonly deploying = signal(false);
  readonly confirmingDeploy = signal(false);
  readonly redeploymentAcknowledged = signal(false);
  readonly sqlExpanded = signal(false);
  readonly copiedSql = signal(false);
  readonly downloadingFile = signal<string | null>(null);
  readonly errorMessage = signal('');

  readonly artifacts: ExportArtifact[] = [
    { name: 'schema.sql', description: 'Validated PostgreSQL schema definition.', mimeType: 'application/sql;charset=utf-8' },
    { name: 'schema.json', description: 'Structured representation of the validated schema.', mimeType: 'application/json;charset=utf-8' },
    { name: 'relationship-report.json', description: 'Persisted relationships and suggestion audit.', mimeType: 'application/json;charset=utf-8' },
    { name: 'data-quality-report.json', description: 'Quality metrics for the exact active source versions.', mimeType: 'application/json;charset=utf-8' },
  ];

  projectId = 0;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly api: ForgeApiService,
    private readonly designApi: DesignApiService,
    private readonly fileDownload: FileDownloadService,
    readonly workflowContext: ProjectWorkflowContextService,
  ) {}

  ngOnInit(): void {
    this.projectId = routeParameter(this.route, 'projectId') ?? 0;
    if (this.projectId <= 0) {
      this.router.navigate(['/projects']);
      return;
    }
    this.loadPage(true);
  }

  refresh(): void {
    this.loadPage(true);
  }

  readinessLabel(): string {
    const workflow = this.workflow();
    if (!workflow?.canExport) return 'Export blocked';
    return workflow.canDeploy ? 'Ready to deploy' : 'Export ready';
  }

  firstBlockingReason(): string {
    return this.workflow()?.blockingReasons[0] ?? 'The project is not ready for this action.';
  }

  artifactAvailable(name: ExportArtifactName): boolean {
    return this.exportPackage()?.availableArtifactNames.includes(name) ?? false;
  }

  downloadArtifact(artifact: ExportArtifact): void {
    const packageData = this.exportPackage();
    if (!packageData || !this.artifactAvailable(artifact.name)) return;
    const content = this.artifactContent(packageData, artifact.name);
    this.fileDownload.downloadText(artifact.name, content, artifact.mimeType);
  }

  copySql(): void {
    const sql = this.exportPackage()?.sql;
    if (!sql) return;
    navigator.clipboard.writeText(sql)
      .then(() => {
        this.copiedSql.set(true);
        window.setTimeout(() => this.copiedSql.set(false), 2000);
      })
      .catch(() => this.errorMessage.set('Unable to copy SQL in this browser.'));
  }

  refreshSql(): void {
    const workflow = this.workflow();
    if (!workflow?.canExport || this.loading()) return;
    this.errorMessage.set('');
    this.api.getProjectExportPackage(this.projectId).subscribe({
      next: (packageData) => this.exportPackage.set(packageData),
      error: (error: unknown) => this.errorMessage.set(this.errorText(error, 'Unable to refresh the export artifacts.')),
    });
  }

  openConfirmation(): void {
    if (!this.workflow()?.canDeploy || !this.deploymentPreview() || this.deploying()) return;
    this.redeploymentAcknowledged.set(false);
    this.confirmingDeploy.set(true);
  }

  closeConfirmation(): void {
    if (this.deploying()) return;
    this.confirmingDeploy.set(false);
  }

  confirmDeployment(): void {
    const preview = this.deploymentPreview();
    if (!preview || !this.workflow()?.canDeploy || this.deploying()) return;
    if (preview.isRedeployment && !this.redeploymentAcknowledged()) return;

    this.deploying.set(true);
    this.errorMessage.set('');
    this.designApi.deployProject(this.projectId, preview.designRevision)
      .pipe(finalize(() => this.deploying.set(false)))
      .subscribe({
        next: (deployment) => {
          this.confirmingDeploy.set(false);
          this.latestDeployment.set(deployment);
          this.selectedDeployment.set(deployment);
          this.loadPage(true);
        },
        error: (error: unknown) => {
          this.confirmingDeploy.set(false);
          const body = this.errorBody(error);
          const message = body?.code === 'deployment_in_progress'
            ? 'Another deployment is already running. Wait for it to finish, then refresh.'
            : body?.code === 'active_version_changed'
              ? 'The active data changed before deployment started. Regenerate and validate the schema.'
              : body?.currentRevision != null
                ? 'The schema changed elsewhere. Refresh and review the latest validated revision.'
                : this.errorText(error, 'Unable to deploy this project.');
          this.loadPage(true, message);
        },
      });
  }

  selectDeployment(deployment: DeploymentResponse): void {
    this.selectedDeployment.set(deployment);
  }

  downloadDeploymentFile(fileName: DeploymentFileName): void {
    const deployment = this.selectedDeployment();
    if (!deployment || !this.deploymentFileAvailable(deployment, fileName) || this.downloadingFile()) return;

    this.errorMessage.set('');
    this.downloadingFile.set(fileName);
    this.designApi.downloadDeploymentSql(this.projectId, deployment.deploymentId, fileName)
      .pipe(finalize(() => this.downloadingFile.set(null)))
      .subscribe({
        next: (content) => this.fileDownload.downloadText(fileName, content, 'application/sql;charset=utf-8'),
        error: (error: unknown) => this.errorMessage.set(this.errorText(error, `Unable to download ${fileName}.`)),
      });
  }

  deploymentFileAvailable(deployment: DeploymentResponse, fileName: DeploymentFileName): boolean {
    if (fileName === 'schema.sql') return deployment.schemaSqlAvailable;
    if (fileName === 'seed.sql') return deployment.seedSqlAvailable;
    return deployment.deploySqlAvailable;
  }

  isSuccessful(deployment: DeploymentResponse): boolean {
    return deployment.status === 'Completed' || deployment.status === 'Succeeded';
  }

  rowCountEntries(deployment: DeploymentResponse): Array<{ table: string; count: number }> {
    return Object.entries(deployment.insertedRowCounts).map(([table, count]) => ({ table, count }));
  }

  private loadPage(forceWorkflow: boolean, preservedMessage = ''): void {
    this.loading.set(true);
    this.errorMessage.set(preservedMessage);
    this.exportPackage.set(null);
    this.deploymentPreview.set(null);
    this.history.set([]);

    this.workflowContext.load(this.projectId, forceWorkflow).subscribe((workflow) => {
      if (!workflow) {
        this.loading.set(false);
        return;
      }
      this.loadResources(workflow, preservedMessage);
    });
  }

  private loadResources(workflow: ProjectWorkflow, preservedMessage: string): void {
    forkJoin({
      history: this.designApi.getDeploymentHistory(this.projectId).pipe(
        catchError((error: unknown) => {
          this.errorMessage.set(this.errorText(error, 'Unable to load deployment history.'));
          return of([] as DeploymentResponse[]);
        }),
      ),
      packageData: workflow.canExport
        ? this.api.getProjectExportPackage(this.projectId).pipe(
            catchError((error: unknown) => {
              this.errorMessage.set(this.errorText(error, 'Unable to load export artifacts.'));
              return of(null);
            }),
          )
        : of(null),
      preview: workflow.canDeploy
        ? this.designApi.getDeploymentPreview(this.projectId).pipe(
            catchError((error: unknown) => {
              this.errorMessage.set(this.errorText(error, 'Unable to load the deployment preview.'));
              return of(null);
            }),
          )
        : of(null),
    }).pipe(finalize(() => this.loading.set(false))).subscribe(({ history, packageData, preview }) => {
      this.history.set(history);
      this.latestDeployment.set(history[0] ?? this.latestDeployment());
      const selectedId = this.selectedDeployment()?.deploymentId;
      this.selectedDeployment.set(history.find(item => item.deploymentId === selectedId) ?? history[0] ?? this.selectedDeployment());
      this.exportPackage.set(packageData);
      this.deploymentPreview.set(preview);
      if (preservedMessage) this.errorMessage.set(preservedMessage);
    });
  }

  private artifactContent(packageData: ProjectExportPackage, name: ExportArtifactName): string {
    if (name === 'schema.sql') return packageData.sql;
    if (name === 'schema.json') return packageData.jsonSchema;
    if (name === 'relationship-report.json') return packageData.relationshipReportJson;
    return packageData.dataQualityReportJson;
  }

  private errorBody(error: unknown): ApiErrorBody | null {
    const body = (error as { error?: unknown } | null)?.error;
    return body && typeof body === 'object' ? body as ApiErrorBody : null;
  }

  private errorText(error: unknown, fallback: string): string {
    return this.errorBody(error)?.message?.trim() || fallback;
  }
}
