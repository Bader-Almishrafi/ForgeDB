import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, ParamMap, provideRouter, Router } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatasetResponse, ExcelWorkbookPreview, ProjectResponse, ProjectWorkflow } from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { ProjectWorkflowContextService } from '../../services/project-workflow-context.service';
import { DataSourcesComponent } from './data-sources.component';

const project: ProjectResponse = {
  id: 10, name: 'Imports', description: 'Project datasets', createdAt: '2026-01-01T00:00:00Z', updatedAt: null,
  workflowState: 'NeedsAnalysis', currentStep: 'Data', recommendedRoute: '/projects/10/data', datasetsCount: 0,
};
const firstDataset: DatasetResponse = {
  id: 7, projectId: 10, tableName: 'customers', sourceType: 'csv', sourceName: 'customers.csv',
  rowCount: 2, columnCount: 2, missingValuesCount: 0, duplicateRowsCount: 0, status: 'Imported', createdAt: '2026-01-01T00:00:00Z',
};
const secondDataset: DatasetResponse = {
  id: 8, projectId: 10, tableName: 'orders', sourceType: 'api', sourceName: 'https://api.example.com/orders',
  rowCount: 3, columnCount: 3, missingValuesCount: 0, duplicateRowsCount: 0, status: 'Analyzed', createdAt: '2026-01-02T00:00:00Z',
};
const csvImported: DatasetResponse = { ...firstDataset, id: 9, tableName: 'new_customers', sourceName: 'new-customers.csv' };
const excelImported: DatasetResponse = { ...firstDataset, id: 11, tableName: 'book_Customers', sourceType: 'excel', sourceName: 'book.xlsx · Customers' };
const apiImported: DatasetResponse = { ...secondDataset, id: 12, tableName: 'remote_orders' };
const workbookSheets: ExcelWorkbookPreview = {
  fileName: 'book.xlsx', worksheets: ['Customers', 'Orders'], selectedWorksheet: null,
  rowCount: 0, columnCount: 0, columns: [], rows: [],
};
const workbookPreview: ExcelWorkbookPreview = {
  fileName: 'book.xlsx', worksheets: ['Customers', 'Orders'], selectedWorksheet: 'Customers',
  rowCount: 2, columnCount: 2, columns: ['id', 'name'], rows: [{ id: 1, name: 'Ahmed' }, { id: 2, name: null }],
};
const remotePreview = {
  url: 'https://api.example.com/orders', arrayPath: 'result.items', rowCount: 2, columnCount: 2,
  columns: ['id', 'total'], rows: [{ id: 1, total: 20 }, { id: 2, total: null }],
};

function workflow(datasets: DatasetResponse[], options: { canAnalyze?: boolean; version?: number; analyzed?: boolean; projectName?: string } = {}): ProjectWorkflow {
  return {
    projectId: 10,
    projectName: options.projectName ?? 'Imports',
    workflowState: datasets.length ? 'NeedsAnalysis' : 'NoData',
    currentStep: datasets.length ? 'Analyze' : 'Data',
    nextStep: datasets.length ? 'Clean' : 'Analyze',
    recommendedRoute: datasets.length ? '/projects/10/analyze' : '/projects/10/data',
    canImport: true,
    canAnalyze: options.canAnalyze ?? datasets.length > 0,
    canClean: false,
    canBuildSchema: false,
    canExport: false,
    canDeploy: false,
    blockerCodes: datasets.length ? ['analysis_required'] : ['dataset_required'],
    blockingReasons: datasets.length ? ['Analysis is required.'] : ['Import a dataset.'],
    datasets: datasets.map((dataset) => ({
      datasetId: dataset.id,
      datasetName: dataset.tableName,
      activeVersionId: dataset.id * 10,
      activeVersionNumber: options.version ?? 1,
      rowCount: dataset.rowCount,
      columnCount: dataset.columnCount,
      hasCurrentAnalysis: options.analyzed ?? false,
      requiresAnalysis: !(options.analyzed ?? false),
      isQualityConfirmed: false,
    })),
    schemaStatus: 'None',
    latestDeploymentStatus: null,
  };
}

interface SetupResult {
  fixture: ComponentFixture<DataSourcesComponent>;
  component: DataSourcesComponent;
  api: Record<string, ReturnType<typeof vi.fn>>;
  router: Router;
  context: ProjectWorkflowContextService;
  setWorkflow: (value: ProjectWorkflow) => void;
}

async function setup(
  initialDatasets: DatasetResponse[] = [],
  queryDatasetId: string | null = null,
  initialWorkflow = workflow(initialDatasets),
): Promise<SetupResult> {
  let datasets = [...initialDatasets];
  let currentWorkflow = initialWorkflow;
  const query = new BehaviorSubject<ParamMap>(convertToParamMap(queryDatasetId ? { datasetId: queryDatasetId } : {}));
  const route = {
    snapshot: { paramMap: convertToParamMap({ projectId: '10' }), queryParamMap: query.value },
    queryParamMap: query.asObservable(),
  };
  const api: Record<string, ReturnType<typeof vi.fn>> = {
    getProject: vi.fn(() => of(project)),
    getProjectWorkflow: vi.fn(() => of(currentWorkflow)),
    getProjectDatasets: vi.fn(() => of([...datasets])),
    getDatasetPreview: vi.fn((datasetId: number) => of({
      datasetId,
      tableName: datasets.find((dataset) => dataset.id === datasetId)?.tableName ?? 'dataset',
      columns: ['id', 'name'],
      rows: [{ id: 1, name: 'Ahmed' }],
    })),
    previewExcel: vi.fn((form: FormData) => of(form.get('worksheetName') ? workbookPreview : workbookSheets)),
    uploadDataset: vi.fn((_projectId: number, form: FormData) => {
      const imported = form.get('sourceType') === 'excel' ? excelImported : csvImported;
      datasets = [...datasets, imported];
      currentWorkflow = workflow(datasets);
      return of(imported);
    }),
    testApiConnection: vi.fn(() => of({ success: true, url: remotePreview.url, statusCode: 200, contentType: 'application/json', responseBytes: 128, recordCount: 2, message: 'Connected' })),
    previewApi: vi.fn(() => of(remotePreview)),
    importApi: vi.fn(() => {
      datasets = [...datasets, apiImported];
      currentWorkflow = workflow(datasets);
      return of(apiImported);
    }),
    replaceDataset: vi.fn((datasetId: number) => {
      const updated = { ...datasets.find((dataset) => dataset.id === datasetId)!, sourceName: 'replacement.csv', status: 'Imported' };
      datasets = datasets.map((dataset) => dataset.id === datasetId ? updated : dataset);
      currentWorkflow = workflow(datasets, { version: 2 });
      return of(updated);
    }),
    deleteDataset: vi.fn((datasetId: number) => {
      datasets = datasets.filter((dataset) => dataset.id !== datasetId);
      currentWorkflow = workflow(datasets);
      return of(undefined);
    }),
    updateProject: vi.fn((_projectId: number, request: { name: string; description: string | null }) => {
      currentWorkflow = { ...currentWorkflow, projectName: request.name };
      return of({ ...project, ...request });
    }),
  };

  await TestBed.configureTestingModule({
    imports: [DataSourcesComponent],
    providers: [
      provideRouter([]),
      { provide: ForgeApiService, useValue: api },
      { provide: ActivatedRoute, useValue: route },
    ],
  }).compileComponents();
  const router = TestBed.inject(Router);
  vi.spyOn(router, 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(DataSourcesComponent);
  fixture.detectChanges();
  return {
    fixture,
    component: fixture.componentInstance,
    api,
    router,
    context: TestBed.inject(ProjectWorkflowContextService),
    setWorkflow: (value) => { currentWorkflow = value; },
  };
}

afterEach(() => TestBed.resetTestingModule());

describe('DataSourcesComponent', () => {
  it('shows CSV, Excel, and API cards before revealing a source form', async () => {
    const { fixture, component } = await setup();
    component.openImport();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="csv-source-option"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="excel-source-option"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="api-source-option"]')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Supported: non-empty .csv file');
    expect(fixture.nativeElement.querySelector('[data-testid="dataset-file-input"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="api-import-form"]')).toBeNull();
  });

  it('reveals only the form for the selected import source', async () => {
    const { fixture, component } = await setup();
    component.openImport();
    component.selectImportSource('excel');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="excel-import-form"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="csv-import-form"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="api-import-form"]')).toBeNull();

    component.selectImportSource('api');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="api-import-form"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="dataset-file-input"]')).toBeNull();
  });

  it('shows the empty project import state', async () => {
    const { fixture } = await setup();
    expect(fixture.nativeElement.querySelector('[data-testid="data-empty-state"]')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Import CSV');
    expect(fixture.nativeElement.textContent).toContain('Import Excel');
    expect(fixture.nativeElement.textContent).toContain('Import API');
  });

  it('imports one non-empty CSV and selects it in the query parameter', async () => {
    const { fixture, component, api, router } = await setup();
    component.openImport('csv');
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('[data-testid="dataset-file-input"]') as HTMLInputElement;
    const file = new File(['id,name\n1,Ahmed'], 'new-customers.csv', { type: 'text/csv' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('[data-testid="import-dataset-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const form = api['uploadDataset'].mock.calls[0][1] as FormData;
    expect(form.get('sourceType')).toBe('csv');
    expect(form.get('file')).toBe(file);
    expect(component.selectedDatasetId()).toBe(9);
    expect(router.navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { datasetId: 9 } }));
    expect(api['getProjectWorkflow']).toHaveBeenCalledTimes(2);
  });

  it('loads worksheets, previews the selected sheet, and imports Excel', async () => {
    const { fixture, component, api } = await setup();
    component.openImport('excel');
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('[data-testid="dataset-file-input"]') as HTMLInputElement;
    const file = new File(['xlsx'], 'book.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    const selector = fixture.nativeElement.querySelector('[data-testid="worksheet-selector"]') as HTMLSelectElement;
    selector.value = 'Customers';
    selector.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="excel-preview"]').textContent).toContain('Ahmed');
    (fixture.nativeElement.querySelector('[data-testid="import-dataset-button"]') as HTMLButtonElement).click();
    const form = api['uploadDataset'].mock.calls[0][1] as FormData;
    expect(form.get('sourceType')).toBe('excel');
    expect(form.get('worksheetName')).toBe('Customers');
    expect(component.selectedDatasetId()).toBe(11);
  });

  it('tests, previews, and imports API data', async () => {
    const { fixture, component, api } = await setup();
    component.openImport('api');
    component.updateApiUrl(remotePreview.url);
    component.updateApiArrayPath('result.items');
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('[data-testid="test-api-connection-button"]') as HTMLButtonElement).click();
    (fixture.nativeElement.querySelector('[data-testid="preview-api-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(api['testApiConnection']).toHaveBeenCalledWith({ apiUrl: remotePreview.url, arrayPath: 'result.items' });
    expect(api['previewApi']).toHaveBeenCalledWith({ apiUrl: remotePreview.url, arrayPath: 'result.items' });
    expect(fixture.nativeElement.querySelector('[data-testid="api-preview"]').textContent).toContain('Not available');
    (fixture.nativeElement.querySelector('[data-testid="import-dataset-button"]') as HTMLButtonElement).click();
    expect(api['importApi']).toHaveBeenCalledWith(10, { apiUrl: remotePreview.url, arrayPath: 'result.items' });
    expect(component.selectedDatasetId()).toBe(12);
    expect(api['getProjectWorkflow']).toHaveBeenCalledTimes(2);
  });

  it('selects a deep-linked dataset through datasetId', async () => {
    const { component, api } = await setup([firstDataset, secondDataset], '8');
    expect(component.selectedDatasetId()).toBe(8);
    expect(api['getDatasetPreview']).toHaveBeenCalledWith(8);
  });

  it('recovers an invalid datasetId to the deterministic first dataset with one notice', async () => {
    const { fixture, component, router } = await setup([secondDataset, firstDataset], '999');
    expect(component.selectedDatasetId()).toBe(7);
    expect(component.selectionNotice()).toContain('not in this project');
    expect(fixture.nativeElement.textContent.match(/not in this project/g)).toHaveLength(1);
    expect(router.navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { datasetId: 7 }, replaceUrl: true }));
  });

  it('shows active-version metadata, backend analysis state, and active preview rows', async () => {
    const { fixture } = await setup([firstDataset], '7', workflow([firstDataset], { version: 3, analyzed: true }));
    expect(fixture.nativeElement.querySelector('[data-testid="active-version-number"]').textContent).toContain('v3');
    expect(fixture.nativeElement.querySelector('[data-testid="dataset-analysis-status"]').textContent).toContain('Analyzed');
    expect(fixture.nativeElement.querySelector('[data-testid="dataset-preview"]').textContent).toContain('Ahmed');
  });

  it('replaces the source, keeps the dataset selected, and refreshes workflow state', async () => {
    const { fixture, component, api } = await setup([firstDataset], '7');
    component.openReplace();
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('[data-testid="replace-file-input"]') as HTMLInputElement;
    const file = new File(['id\n2'], 'replacement.csv', { type: 'text/csv' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('[data-testid="confirm-replace-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(api['replaceDataset']).toHaveBeenCalledWith(7, expect.any(FormData));
    expect(component.selectedDatasetId()).toBe(7);
    expect(component.successMessage()).toContain('previous versions remain in history');
    expect(component.selectedWorkflowDataset()?.activeVersionNumber).toBe(2);
    expect(api['getProjectWorkflow']).toHaveBeenCalledTimes(2);
  });

  it('deletes the selection, selects the next valid dataset, and refreshes workflow state', async () => {
    const { fixture, component, api, router } = await setup([firstDataset, secondDataset], '7');
    component.requestDelete();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('[data-testid="confirm-delete-dataset"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(api['deleteDataset']).toHaveBeenCalledWith(7);
    expect(component.selectedDatasetId()).toBe(8);
    expect(router.navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { datasetId: 8 } }));
    expect(api['getProjectWorkflow']).toHaveBeenCalledTimes(2);
  });

  it('refreshes workflow context after editing the project name', async () => {
    const { component, api, context } = await setup([firstDataset]);
    component.openProjectEdit();
    component.editName.set('Renamed imports');
    component.editDescription.set('Updated description');
    component.saveProject();

    expect(api['updateProject']).toHaveBeenCalledWith(10, { name: 'Renamed imports', description: 'Updated description' });
    expect(api['getProjectWorkflow']).toHaveBeenCalledTimes(2);
    expect(context.workflow()?.projectName).toBe('Renamed imports');
  });

  it('uses workflow permission for Continue to Analyze and preserves datasetId', async () => {
    const blocked = workflow([firstDataset], { canAnalyze: false });
    const { fixture, component, router, context, setWorkflow } = await setup([firstDataset], '7', blocked);
    let button = fixture.nativeElement.querySelector('[data-testid="continue-to-analyze"]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    setWorkflow(workflow([firstDataset], { canAnalyze: true }));
    context.load(10, true).subscribe();
    fixture.detectChanges();
    button = fixture.nativeElement.querySelector('[data-testid="continue-to-analyze"]') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    button.click();
    expect(router.navigate).toHaveBeenCalledWith(['/projects', 10, 'analyze'], { queryParams: { datasetId: 7 } });
  });

  it('contains no quality or analysis workspace and never requests analysis results', async () => {
    const { fixture, api } = await setup([firstDataset]);
    expect('getDatasetAnalysis' in api).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('Quality');
    expect(fixture.nativeElement.textContent).not.toContain('Overview');
    expect(fixture.nativeElement.querySelector('[role="tablist"]')).toBeNull();
  });
});
