import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiJsonPreview, DatasetResponse, ExcelWorkbookPreview } from '../../../services/api.models';
import { ForgeApiService } from '../../../services/forge-api.service';
import { MAX_IMPORT_FILE_BYTES } from '../../../shared/utils/file-import.utils';
import { ImportDatasetDialogComponent } from './import-dataset-dialog.component';

const importedDataset = (id: number, fileName: string): DatasetResponse => ({
  id,
  projectId: 10,
  tableName: fileName.replace(/\.csv$/i, '').replace(/-/g, '_'),
  sourceType: 'csv',
  sourceName: fileName,
  rowCount: 1,
  columnCount: 2,
  missingValuesCount: 0,
  duplicateRowsCount: 0,
  status: 'Imported',
  createdAt: '2026-07-20T09:00:00Z',
});

describe('ImportDatasetDialogComponent CSV batches', () => {
  let fixture: ComponentFixture<ImportDatasetDialogComponent>;
  let component: ImportDatasetDialogComponent;
  let uploadDataset: ReturnType<typeof vi.fn>;
  let previewApi: ReturnType<typeof vi.fn>;
  let previewExcel: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    uploadDataset = vi.fn();
    previewApi = vi.fn();
    previewExcel = vi.fn();

    await TestBed.configureTestingModule({
      imports: [ImportDatasetDialogComponent],
      providers: [
        {
          provide: ForgeApiService,
          useValue: {
            uploadDataset,
            previewExcel,
            testApiConnection: vi.fn(),
            previewApi,
            importApi: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ImportDatasetDialogComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('projectId', 10);
    fixture.componentRef.setInput('projectName', 'Batch import');
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('initialSource', 'csv');
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('emits one ordered batch and closes only after every CSV succeeds', () => {
    const customers = new File(['id,name\n1,Ada'], 'customers.csv', { type: 'text/csv' });
    const orders = new File(['id,total\n1,42'], 'orders.csv', { type: 'text/csv' });
    const customerDataset = importedDataset(21, customers.name);
    const orderDataset = importedDataset(22, orders.name);
    uploadDataset
      .mockReturnValueOnce(of(customerDataset))
      .mockReturnValueOnce(of(orderDataset));
    const imported = vi.spyOn(component.imported, 'emit');
    const closed = vi.spyOn(component.closeDialog, 'emit');

    chooseFiles([customers, orders]);
    component.importData();

    expect(uploadDataset).toHaveBeenCalledTimes(2);
    expect(uploadDataset.mock.calls.map(([, form]) => (form as FormData).get('file')))
      .toEqual([customers, orders]);
    expect(imported).toHaveBeenCalledTimes(1);
    expect(imported).toHaveBeenCalledWith([customerDataset, orderDataset]);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(component.importFiles()).toEqual([]);
    expect(component.importError()).toBe('');
  });

  it('emits successful imports once, retains failed files, and keeps the dialog open', () => {
    const customers = new File(['id,name\n1,Ada'], 'customers.csv', { type: 'text/csv' });
    const broken = new File(['not,a,valid,dataset'], 'broken.csv', { type: 'text/csv' });
    const customerDataset = importedDataset(21, customers.name);
    uploadDataset
      .mockReturnValueOnce(of(customerDataset))
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({
        status: 400,
        error: { message: 'CSV headers are invalid.' },
      })));
    const imported = vi.spyOn(component.imported, 'emit');
    const closed = vi.spyOn(component.closeDialog, 'emit');

    chooseFiles([customers, broken]);
    component.importData();
    fixture.detectChanges();

    expect(uploadDataset).toHaveBeenCalledTimes(2);
    expect(imported).toHaveBeenCalledTimes(1);
    expect(imported).toHaveBeenCalledWith([customerDataset]);
    expect(closed).not.toHaveBeenCalled();
    expect(component.importFiles()).toEqual([broken]);
    expect(component.importError()).toContain('Imported 1 of 2 files');
    expect(component.importError()).toContain('broken.csv');
    expect(component.importError()).toContain('CSV headers are invalid.');
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('broken.csv');
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('CSV headers are invalid.');
    expect(fixture.nativeElement.querySelector('[data-testid="import-data-dialog"]')).not.toBeNull();
  });

  it('announces the current file and total throughout a sequential CSV batch', () => {
    const customers = new File(['id,name\n1,Ada'], 'customers.csv', { type: 'text/csv' });
    const orders = new File(['id,total\n1,42'], 'orders.csv', { type: 'text/csv' });
    const first = new Subject<DatasetResponse>();
    const second = new Subject<DatasetResponse>();
    uploadDataset
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);

    chooseFiles([customers, orders]);
    component.importData();
    fixture.detectChanges();

    let progress = fixture.nativeElement.querySelector('[data-testid="csv-import-progress"]') as HTMLElement;
    expect(progress.getAttribute('role')).toBe('status');
    expect(progress.getAttribute('aria-live')).toBe('polite');
    expect(progress.textContent).toContain('Importing file 1 of 2');
    expect(progress.textContent).toContain('customers.csv');

    first.next(importedDataset(21, customers.name));
    first.complete();
    fixture.detectChanges();

    progress = fixture.nativeElement.querySelector('[data-testid="csv-import-progress"]') as HTMLElement;
    expect(progress.textContent).toContain('Importing file 2 of 2');
    expect(progress.textContent).toContain('orders.csv');

    second.next(importedDataset(22, orders.name));
    second.complete();
    fixture.detectChanges();

    expect(component.csvImportProgress()).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="csv-import-progress"]')).toBeNull();
  });

  it('keeps one case-insensitive file name and reports oversized and duplicate selections', () => {
    const selected = new File(['id\n1'], 'customers.csv', { type: 'text/csv' });
    chooseFiles([selected]);
    const duplicate = new File(['id\n2'], 'CUSTOMERS.csv', { type: 'text/csv' });
    const oversized = new File([new Uint8Array(MAX_IMPORT_FILE_BYTES + 1)], 'oversized.csv', { type: 'text/csv' });
    const input = fixture.nativeElement.querySelector('[data-testid="dataset-file-input"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: [duplicate, oversized] });

    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(component.importFiles()).toEqual([selected]);
    expect(component.importError()).toContain('1 invalid, empty, or oversized file skipped');
    expect(component.importError()).toContain('1 duplicate file name skipped');
    expect(uploadDataset).not.toHaveBeenCalled();
  });

  it('does not accept an API preview produced for inputs that have since changed', () => {
    const pending = new Subject<ApiJsonPreview>();
    previewApi.mockReturnValue(pending);
    component.selectImportSource('api');
    component.updateApiUrl('https://api.example.com/first');

    component.previewApiData();
    component.updateApiUrl('https://api.example.com/second');
    pending.next({
      url: 'https://api.example.com/first',
      arrayPath: null,
      rowCount: 1,
      columnCount: 1,
      columns: ['id'],
      rows: [{ id: 1 }],
    });
    pending.complete();

    expect(component.apiPreview()).toBeNull();
    expect(component.canImport()).toBe(false);
  });

  it('locks file editing and ignores a preview for a replaced Excel file', () => {
    const pending = new Subject<ExcelWorkbookPreview>();
    previewExcel.mockReturnValue(pending);
    component.selectImportSource('excel');
    fixture.detectChanges();
    const first = new File(['first'], 'first.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const second = new File(['second'], 'second.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const input = fixture.nativeElement.querySelector('[data-testid="dataset-file-input"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: [first] });

    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(input.disabled).toBe(true);
    component.importFiles.set([second]);
    pending.next({
      fileName: first.name,
      worksheets: ['Sheet1'],
      selectedWorksheet: 'Sheet1',
      rowCount: 1,
      columnCount: 1,
      columns: ['id'],
      rows: [{ id: 1 }],
    });
    pending.complete();

    expect(component.excelPreview()).toBeNull();
  });

  function chooseFiles(files: File[]): void {
    const input = fixture.nativeElement.querySelector('[data-testid="dataset-file-input"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: files });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(component.importFiles()).toEqual(files);
  }
});
