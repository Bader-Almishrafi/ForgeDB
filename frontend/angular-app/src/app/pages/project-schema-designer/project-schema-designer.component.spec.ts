import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DesignModelResponse, ProjectWorkflow } from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { ProjectWorkflowContextService } from '../../services/project-workflow-context.service';
import { ToastService } from '../../services/toast.service';
import { ProjectSchemaDesignerComponent } from './project-schema-designer.component';
import { DesignApiService } from './services/design-api.service';
import { ProjectSchemaDesignerService } from './services/project-schema-designer.service';

const workflow = (): ProjectWorkflow => ({
  projectId: 10,
  projectName: 'Orders',
  workflowState: 'SchemaDesign',
  currentStep: 'Schema Design',
  nextStep: 'Export and Deploy',
  recommendedRoute: '/projects/10/schema',
  canImport: true,
  canAnalyze: true,
  canClean: true,
  canBuildSchema: true,
  canExport: false,
  canDeploy: false,
  blockerCodes: ['schema_invalid'],
  blockingReasons: ['Validate the schema before continuing.'],
  datasets: [{
    datasetId: 2,
    datasetName: 'orders',
    activeVersionId: 12,
    activeVersionNumber: 2,
    rowCount: 25,
    columnCount: 2,
    hasCurrentAnalysis: true,
    requiresAnalysis: false,
    isQualityConfirmed: true,
  }],
  schemaStatus: 'Invalid',
  latestDeploymentStatus: null,
});

const design = (): DesignModelResponse => ({
  id: 20,
  projectId: 10,
  revision: 4,
  status: 'Invalid',
  isStale: false,
  canContinue: false,
  generatedAt: '2026-07-20T09:00:00Z',
  validatedAt: '2026-07-20T09:05:00Z',
  sourceVersions: { 2: 12 },
  layout: null,
  createdAt: '2026-07-20T09:00:00Z',
  updatedAt: '2026-07-20T09:05:00Z',
  tables: [{
    id: 1,
    name: 'orders',
    sourceDatasetId: 2,
    sourceDatasetVersionId: 12,
    sourceName: 'orders',
    rowCount: 25,
    origin: 'generated',
    columns: [{
      id: 11,
      name: 'customer_id',
      sqlType: 'INTEGER',
      isNullable: false,
      isPrimaryKey: false,
      isUnique: false,
      ordinal: 0,
      sourceColumnName: 'customer_id',
      origin: 'generated',
      defaultValue: null,
      isAutoIncrement: false,
    }],
  }],
  relationships: [],
  validationIssues: [
    {
      code: 'missing_reference',
      severity: 'error',
      message: 'Customer ID must reference a unique target.',
      tableId: 1,
      columnId: 11,
    },
    {
      code: 'naming_review',
      severity: 'warning',
      message: 'Review this generated name.',
      tableId: 1,
    },
  ],
});

function contextStub(workflowSignal = signal<ProjectWorkflow | null>(workflow())) {
  return {
    workflow: workflowSignal,
    error: signal(null),
    load: vi.fn(() => of(workflowSignal())),
    setDatasetFromQuery: vi.fn(),
  };
}

function apiStubs(model = design()) {
  return {
    schemaApi: {
      getSchema: vi.fn(() => of(model)),
      getSchemaSql: vi.fn(() => of({ revision: model.revision, sql: 'CREATE TABLE orders ();' })),
    },
    forgeApi: {
      getDatasetVersions: vi.fn(() => of([])),
    },
  };
}

describe('ProjectSchemaDesignerService', () => {
  let context: ReturnType<typeof contextStub>;
  let schemaApi: ReturnType<typeof apiStubs>['schemaApi'];

  beforeEach(() => {
    context = contextStub();
    schemaApi = apiStubs().schemaApi;
    TestBed.configureTestingModule({
      providers: [
        ProjectSchemaDesignerService,
        { provide: DesignApiService, useValue: schemaApi },
        { provide: ForgeApiService, useValue: apiStubs().forgeApi },
        { provide: ProjectWorkflowContextService, useValue: context },
        { provide: ToastService, useValue: { showSuccess: vi.fn(), showError: vi.fn() } },
      ],
    });
  });

  it('blocks Save changes while a dirty draft has client-side validation errors', () => {
    const service = TestBed.inject(ProjectSchemaDesignerService);
    const model = design();
    service.design.set({ ...model, validationIssues: [] });
    service.tableNames.set({ 1: 'orders' });
    service.columnDrafts.set({
      11: {
        name: 'customer_id',
        sqlType: 'INTEGER',
        isNullable: false,
        isPrimaryKey: false,
        isUnique: false,
        defaultValue: null,
        isAutoIncrement: false,
      },
    });

    service.updateTableName(1, 'bad table name');

    expect(service.dirty()).toBe(true);
    expect(service.hasDraftErrors()).toBe(true);
    expect(service.draftIssues()[0].location).toBe('bad table name');
    expect(service.canSave()).toBe(false);

    service.updateTableName(1, 'renamed_orders');

    expect(service.hasDraftErrors()).toBe(false);
    expect(service.canSave()).toBe(true);
  });

  it('keeps valid dataset deep links and clears dataset IDs outside the loaded project', () => {
    const service = TestBed.inject(ProjectSchemaDesignerService);

    service.init(10, 2);
    expect(service.datasetId()).toBe(2);
    expect(context.setDatasetFromQuery).toHaveBeenLastCalledWith(2);

    service.init(10, 999);
    expect(service.datasetId()).toBeNull();
    expect(context.setDatasetFromQuery).toHaveBeenLastCalledWith(null);
  });
});

describe('ProjectSchemaDesignerComponent', () => {
  beforeEach(async () => {
    const context = contextStub();
    const stubs = apiStubs();
    await TestBed.configureTestingModule({
      imports: [ProjectSchemaDesignerComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            parent: null,
            snapshot: {
              paramMap: convertToParamMap({ projectId: '10' }),
              queryParamMap: convertToParamMap({ datasetId: '2' }),
            },
          },
        },
        { provide: DesignApiService, useValue: stubs.schemaApi },
        { provide: ForgeApiService, useValue: stubs.forgeApi },
        { provide: ProjectWorkflowContextService, useValue: context },
        { provide: ToastService, useValue: { showSuccess: vi.fn(), showError: vi.fn() } },
      ],
    }).compileComponents();
  });

  it('provides four focused sections and renders validation issues with their locations', () => {
    const fixture = TestBed.createComponent(ProjectSchemaDesignerComponent);
    fixture.detectChanges();
    fixture.componentInstance.activeTab.set('validation');
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const validation = element.querySelector('[data-testid="schema-validation"]');

    expect(element.querySelectorAll('[role="tab"]').length).toBe(4);
    expect(validation).not.toBeNull();
    expect(validation?.textContent).toContain('Customer ID must reference a unique target.');
    expect(validation?.textContent).toContain('orders / customer_id');
    expect(validation?.textContent).toContain('Review this generated name.');

    (validation?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.activeTab()).toBe('tables');
    expect(fixture.componentInstance.service.selectedTableId()).toBe(1);
  });
});
