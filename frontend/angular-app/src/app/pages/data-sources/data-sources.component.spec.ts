import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatasetResponse, ExcelWorkbookPreview } from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { WorkflowStateService } from '../../services/workflow-state.service';
import { DataSourcesComponent } from './data-sources.component';

const imported: DatasetResponse = {
  id: 7, projectId: 10, tableName: 'book_Customers', sourceType: 'excel', sourceName: 'book.xlsx · Customers',
  rowCount: 2, columnCount: 2, missingValuesCount: 1, duplicateRowsCount: 0, status: 'Imported', createdAt: '2026-01-01T00:00:00Z',
};
const detected: ExcelWorkbookPreview = {
  fileName: 'book.xlsx', worksheets: ['Customers', 'Orders'], selectedWorksheet: null,
  rowCount: 0, columnCount: 0, columns: [], rows: [],
};
const preview: ExcelWorkbookPreview = {
  fileName: 'book.xlsx', worksheets: ['Customers', 'Orders'], selectedWorksheet: 'Customers',
  rowCount: 2, columnCount: 2, columns: ['id', 'name'], rows: [{ id: '1', name: 'Ahmed' }, { id: '2', name: null }],
};

describe('DataSourcesComponent Excel import', () => {
  let fixture: ComponentFixture<DataSourcesComponent>;
  let component: DataSourcesComponent;
  let api: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    api = {
      getProject: vi.fn(() => of({ id: 10, userId: 1, name: 'Imports', description: '', createdAt: '2026-01-01T00:00:00Z' })),
      getProjectDatasets: vi.fn().mockReturnValueOnce(of([])).mockReturnValue(of([imported])),
      getDatasetPreview: vi.fn(() => of({ datasetId: 7, tableName: 'book_Customers', columns: ['id', 'name'], rows: preview.rows })),
      getDatasetAnalysis: vi.fn(() => of({})),
      previewExcel: vi.fn((form: FormData) => of(form.get('worksheetName') ? preview : detected)),
      uploadDataset: vi.fn(() => of(imported)),
      replaceDataset: vi.fn(),
      deleteDataset: vi.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [DataSourcesComponent],
      providers: [
        provideRouter([]),
        { provide: ForgeApiService, useValue: api },
        { provide: WorkflowStateService, useValue: { setProjectId: vi.fn(), setProject: vi.fn(), setDataset: vi.fn(), clearDataset: vi.fn() } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ projectId: '10' }), queryParamMap: convertToParamMap({}) } } },
      ],
    }).compileComponents();
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(DataSourcesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders Excel, selects a worksheet, previews rows, imports, and refreshes the dataset list', async () => {
    component.openUpload();
    fixture.detectChanges();
    const excelOption = fixture.nativeElement.querySelector('[data-testid="excel-source-option"]') as HTMLButtonElement;
    expect(excelOption).toBeTruthy();
    excelOption.click();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('[data-testid="dataset-file-input"]') as HTMLInputElement;
    const file = new File(['xlsx bytes'], 'book.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(api['previewExcel']).toHaveBeenCalledTimes(1);

    const selector = fixture.nativeElement.querySelector('[data-testid="worksheet-selector"]') as HTMLSelectElement;
    expect(selector).toBeTruthy();
    selector.value = 'Customers';
    selector.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="excel-preview"]').textContent).toContain('Ahmed');

    (fixture.nativeElement.querySelector('[data-testid="import-dataset-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(api['uploadDataset']).toHaveBeenCalledWith(10, expect.any(FormData));
    const form = api['uploadDataset'].mock.calls[0][1] as FormData;
    expect(form.get('sourceType')).toBe('excel');
    expect(form.get('worksheetName')).toBe('Customers');
    expect(api['getProjectDatasets']).toHaveBeenCalledTimes(2);
    expect(component.datasets()).toEqual([imported]);
    expect(component.uploadSuccess()).toContain('imported successfully');
  });
});
