import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DeploymentPreview,
  DeploymentResponse,
  ProjectExportPackage,
  ProjectWorkflow,
} from '../../services/api.models';
import { DesignApiService } from '../project-schema-designer/services/design-api.service';
import { FileDownloadService } from '../../services/file-download.service';
import { ForgeApiService } from '../../services/forge-api.service';
import { ProjectWorkflowContextService } from '../../services/project-workflow-context.service';
import { ExportDeployComponent } from './export-deploy.component';

const readyWorkflow = (): ProjectWorkflow => ({
  projectId: 10,
  projectName: 'Sales Warehouse',
  workflowState: 'ReadyToDeploy',
  currentStep: 'Export & Deploy',
  nextStep: null,
  recommendedRoute: '/projects/10/export-deploy',
  canImport: true,
  canAnalyze: true,
  canClean: true,
  canBuildSchema: true,
  canExport: true,
  canDeploy: true,
  blockerCodes: [],
  blockingReasons: [],
  datasets: [],
  schemaStatus: 'Valid',
  latestDeploymentStatus: null,
});

const exportPackage: ProjectExportPackage = {
  projectId: 10,
  projectName: 'Ignored package name',
  designRevision: 7,
  schemaStatus: 'Valid',
  status: 'Database Package Ready',
  generatedAt: '2026-07-20T09:00:00Z',
  sourceDatasetVersions: [
    { datasetId: 2, datasetName: 'customers', versionId: 12, versionNumber: 2, versionKind: 'Cleaned' },
  ],
  availableArtifactNames: ['schema.sql', 'schema.json', 'relationship-report.json', 'data-quality-report.json'],
  sql: 'CREATE TABLE customers (id INTEGER PRIMARY KEY);',
  dbml: 'compatibility-only',
  jsonSchema: '{"tables":[]}',
  relationshipReportJson: '{"persistedRelationships":[],"suggestionAudit":[]}',
  dataQualityReportJson: '{"datasets":[]}',
};

const preview = (isRedeployment = false): DeploymentPreview => ({
  schemaName: 'forgedb_project_10',
  designRevision: 7,
  tablesCount: 2,
  relationshipsCount: 1,
  totalRowsPlanned: 125,
  sourceVersionCount: 1,
  isRedeployment,
});

const completedDeployment = (status: string = 'Completed'): DeploymentResponse => ({
  deploymentId: 91,
  id: 91,
  projectId: 10,
  designRevision: 7,
  schemaName: 'forgedb_project_10',
  status,
  generatedSql: '',
  errorMessage: status === 'Failed' ? 'Deployment failed safely. The transaction rolled back.' : null,
  createdTables: ['customers', 'orders'],
  insertedRowCounts: { customers: 100, orders: 25 },
  tablesCreated: status === 'Failed' ? 0 : 2,
  rowsSeeded: status === 'Failed' ? 0 : 125,
  totalRowsInserted: status === 'Failed' ? 0 : 125,
  relationshipsCreated: status === 'Failed' ? 0 : 1,
  failedRows: status === 'Failed' ? 125 : 0,
  schemaSqlAvailable: true,
  seedSqlAvailable: true,
  deploySqlAvailable: true,
  startedAt: '2026-07-20T09:30:00Z',
  completedAt: '2026-07-20T09:31:00Z',
});

describe('ExportDeployComponent', () => {
  const workflowSignal = signal<ProjectWorkflow | null>(readyWorkflow());
  const workflowErrorSignal = signal(null);
  const loadWorkflow = vi.fn(() => of(workflowSignal()));
  const getExportPackage = vi.fn(() => of(exportPackage));
  const getDeploymentPreview = vi.fn(() => of(preview()));
  const getDeploymentHistory = vi.fn(() => of([] as DeploymentResponse[]));
  const deployProject = vi.fn(() => of(completedDeployment()));
  const downloadDeploymentSql = vi.fn(() => of('SELECT 1;'));
  const downloadText = vi.fn();

  beforeEach(async () => {
    workflowSignal.set(readyWorkflow());
    loadWorkflow.mockClear();
    getExportPackage.mockClear();
    getDeploymentPreview.mockClear();
    getDeploymentHistory.mockClear();
    deployProject.mockClear();
    downloadDeploymentSql.mockClear();
    downloadText.mockClear();
    getExportPackage.mockReturnValue(of(exportPackage));
    getDeploymentPreview.mockReturnValue(of(preview()));
    getDeploymentHistory.mockReturnValue(of([]));
    deployProject.mockReturnValue(of(completedDeployment()));

    await TestBed.configureTestingModule({
      imports: [ExportDeployComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ projectId: '10' }) } } },
        { provide: ForgeApiService, useValue: { getProjectExportPackage: getExportPackage } },
        {
          provide: DesignApiService,
          useValue: { getDeploymentPreview, getDeploymentHistory, deployProject, downloadDeploymentSql },
        },
        { provide: FileDownloadService, useValue: { downloadText } },
        {
          provide: ProjectWorkflowContextService,
          useValue: { workflow: workflowSignal, error: workflowErrorSignal, load: loadWorkflow },
        },
      ],
    }).compileComponents();
  });

  it('uses workflow API blocking and does not request export artifacts or deployment preview', () => {
    workflowSignal.set({
      ...readyWorkflow(),
      canExport: false,
      canDeploy: false,
      blockerCodes: ['schema_stale'],
      blockingReasons: ['The schema references dataset versions that are no longer active.'],
    });

    const fixture = TestBed.createComponent(ExportDeployComponent);
    fixture.detectChanges();

    expect(getExportPackage).not.toHaveBeenCalled();
    expect(getDeploymentPreview).not.toHaveBeenCalled();
    expect(getDeploymentHistory).toHaveBeenCalledWith(10);
    expect(fixture.nativeElement.textContent).toContain('The schema references dataset versions that are no longer active.');
    expect(fixture.nativeElement.querySelector('[data-testid="export-blocked"]')).not.toBeNull();
  });

  it('allows exports but disables deployment using the first backend blocker', () => {
    workflowSignal.set({
      ...readyWorkflow(),
      canDeploy: false,
      blockerCodes: ['deployment_in_progress'],
      blockingReasons: ['A deployment is already running for this project.'],
    });

    const fixture = TestBed.createComponent(ExportDeployComponent);
    fixture.detectChanges();

    expect(getExportPackage).toHaveBeenCalledWith(10);
    expect(getDeploymentPreview).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="deployment-blocker"]').textContent)
      .toContain('A deployment is already running for this project.');
    expect((fixture.nativeElement.querySelector('button.btn-primary') as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders the focused artifacts, backend SQL, deployment preview, and no preview tabs', () => {
    const fixture = TestBed.createComponent(ExportDeployComponent);
    fixture.detectChanges();
    fixture.componentInstance.sqlExpanded.set(true);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Sales Warehouse');
    expect(text).toContain('schema.sql');
    expect(text).toContain('schema.json');
    expect(text).toContain('relationship-report.json');
    expect(text).toContain('data-quality-report.json');
    expect(text).toContain(exportPackage.sql);
    expect(text).toContain('forgedb_project_10');
    expect(text).toContain('125');
    expect(fixture.nativeElement.querySelectorAll('[role="tab"]').length).toBe(0);
    expect(text).not.toContain('compatibility-only');
  });

  it('downloads export artifacts and only backend-reported deployment files', () => {
    getDeploymentHistory.mockReturnValue(of([completedDeployment()]));
    const fixture = TestBed.createComponent(ExportDeployComponent);
    fixture.detectChanges();

    fixture.componentInstance.downloadArtifact(fixture.componentInstance.artifacts[1]);
    fixture.componentInstance.downloadDeploymentFile('seed.sql');

    expect(getExportPackage).toHaveBeenCalledWith(10);
    expect(downloadText).toHaveBeenCalledWith('schema.json', exportPackage.jsonSchema, 'application/json;charset=utf-8');
    expect(downloadDeploymentSql).toHaveBeenCalledWith(10, 91, 'seed.sql');
    expect(downloadText).toHaveBeenCalledWith('seed.sql', 'SELECT 1;', 'application/sql;charset=utf-8');
  });

  it('shows first-deployment confirmation and prevents duplicate submissions', () => {
    const pending = new Subject<DeploymentResponse>();
    deployProject.mockReturnValueOnce(pending);
    const fixture = TestBed.createComponent(ExportDeployComponent);
    fixture.detectChanges();

    fixture.componentInstance.openConfirmation();
    fixture.componentInstance.confirmDeployment();
    fixture.componentInstance.confirmDeployment();

    expect(fixture.componentInstance.confirmingDeploy()).toBe(true);
    expect(deployProject).toHaveBeenCalledTimes(1);
    expect(deployProject).toHaveBeenCalledWith(10, 7);
    pending.next(completedDeployment());
    pending.complete();
    expect(loadWorkflow).toHaveBeenLastCalledWith(10, true);
  });

  it('requires explicit acknowledgement before redeployment', () => {
    getDeploymentPreview.mockReturnValue(of(preview(true)));
    const fixture = TestBed.createComponent(ExportDeployComponent);
    fixture.detectChanges();

    fixture.componentInstance.openConfirmation();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Redeploying will replace the project-dedicated PostgreSQL schema');
    fixture.componentInstance.confirmDeployment();
    expect(deployProject).not.toHaveBeenCalled();

    fixture.componentInstance.redeploymentAcknowledged.set(true);
    fixture.componentInstance.confirmDeployment();
    expect(deployProject).toHaveBeenCalledTimes(1);
  });

  it('refreshes workflow after a stored failed deployment result', () => {
    deployProject.mockReturnValueOnce(of(completedDeployment('Failed')));
    const fixture = TestBed.createComponent(ExportDeployComponent);
    fixture.detectChanges();

    fixture.componentInstance.openConfirmation();
    fixture.componentInstance.confirmDeployment();

    expect(loadWorkflow).toHaveBeenCalledTimes(2);
    expect(loadWorkflow).toHaveBeenLastCalledWith(10, true);
  });

  it('handles deployment conflicts without displaying a stale result and refreshes workflow', () => {
    deployProject.mockReturnValueOnce(throwError(() => new HttpErrorResponse({
      status: 409,
      error: { code: 'deployment_in_progress', message: 'running' },
    })));
    const fixture = TestBed.createComponent(ExportDeployComponent);
    fixture.detectChanges();

    fixture.componentInstance.openConfirmation();
    fixture.componentInstance.confirmDeployment();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Another deployment is already running');
    expect(fixture.componentInstance.latestDeployment()).toBeNull();
    expect(loadWorkflow).toHaveBeenCalledTimes(2);
  });

  it('handles a design revision conflict and asks for the latest validated revision', () => {
    deployProject.mockReturnValueOnce(throwError(() => new HttpErrorResponse({
      status: 409,
      error: { currentRevision: 8, message: 'Design revision changed.' },
    })));
    const fixture = TestBed.createComponent(ExportDeployComponent);
    fixture.detectChanges();

    fixture.componentInstance.openConfirmation();
    fixture.componentInstance.confirmDeployment();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('The schema changed elsewhere');
    expect(fixture.componentInstance.latestDeployment()).toBeNull();
    expect(loadWorkflow).toHaveBeenCalledTimes(2);
  });

  it('keeps backend history order and shows successful and rolled-back failure details', () => {
    const failed = { ...completedDeployment('Failed'), deploymentId: 92, id: 92, startedAt: '2026-07-20T10:00:00Z' };
    getDeploymentHistory.mockReturnValue(of([failed, completedDeployment()]));
    const fixture = TestBed.createComponent(ExportDeployComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.history().map(item => item.deploymentId)).toEqual([92, 91]);
    expect(fixture.componentInstance.latestDeployment()?.deploymentId).toBe(92);
    expect(fixture.nativeElement.textContent).toContain('Rolled back');
  });
});
