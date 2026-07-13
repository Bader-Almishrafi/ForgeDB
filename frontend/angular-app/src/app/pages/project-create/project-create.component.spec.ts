import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExcelWorkbookPreview } from '../../services/api.models';
import { AuthService } from '../../services/auth.service';
import { ForgeApiService } from '../../services/forge-api.service';
import { WorkflowStateService } from '../../services/workflow-state.service';
import { ProjectCreateComponent } from './project-create.component';

const sheetsOnly: ExcelWorkbookPreview = {
  fileName: 'multi-sheet.xlsx', worksheets: ['Customers', 'Orders'], selectedWorksheet: null,
  rowCount: 0, columnCount: 0, columns: [], rows: [],
};
const customersPreview: ExcelWorkbookPreview = {
  fileName: 'multi-sheet.xlsx', worksheets: ['Customers', 'Orders'], selectedWorksheet: 'Customers',
  rowCount: 2, columnCount: 2, columns: ['id', 'name'], rows: [{ id: '1', name: 'Ahmed' }, { id: '2', name: null }],
};

describe('ProjectCreateComponent Excel import', () => {
  let fixture: ComponentFixture<ProjectCreateComponent>;
  let component: ProjectCreateComponent;
  let api: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    api = {
      previewExcel: vi.fn((form: FormData) => of(form.get('worksheetName') ? customersPreview : sheetsOnly)),
      createProject: vi.fn(() => of({ id: 10, userId: 1, name: 'Excel project', description: null, createdAt: '2026-01-01T00:00:00Z' })),
      uploadDataset: vi.fn(() => of({
        id: 20, projectId: 10, tableName: 'multi_sheet_Customers', sourceType: 'excel', sourceName: 'multi-sheet.xlsx · Customers',
        rowCount: 2, columnCount: 2, missingValuesCount: 1, duplicateRowsCount: 0, status: 'Imported', createdAt: '2026-01-01T00:00:00Z',
      })),
    };
    await TestBed.configureTestingModule({
      imports: [ProjectCreateComponent],
      providers: [
        provideRouter([]),
        { provide: ForgeApiService, useValue: api },
        { provide: AuthService, useValue: { userId: vi.fn(() => 1) } },
        { provide: WorkflowStateService, useValue: { setProject: vi.fn(), setDataset: vi.fn() } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ProjectCreateComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders the Excel option, detects sheets, previews the selection, and sends the real import request', async () => {
    component.currentStep.set(2);
    fixture.detectChanges();
    const option = fixture.nativeElement.querySelector('[data-testid="create-excel-option"]') as HTMLElement;
    expect(option).toBeTruthy();
    (option.querySelector('input') as HTMLInputElement).dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('[data-testid="project-excel-input"]') as HTMLInputElement;
    const file = new File(['xlsx bytes'], 'multi-sheet.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(api['previewExcel']).toHaveBeenCalledTimes(1);

    const selector = fixture.nativeElement.querySelector('[data-testid="project-worksheet-selector"]') as HTMLSelectElement;
    expect(Array.from(selector.options).map(item => item.value)).toEqual(['', 'Customers', 'Orders']);
    selector.value = 'Customers';
    selector.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(api['previewExcel']).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.querySelector('[data-testid="project-excel-preview"]').textContent).toContain('Ahmed');
    expect(fixture.nativeElement.querySelector('[data-testid="project-excel-preview"]').textContent).toContain('Not available');

    component.projectForm.setValue({ name: 'Excel project', description: '' });
    component.currentStep.set(3);
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    component.createProject();

    expect(api['createProject']).toHaveBeenCalled();
    expect(api['uploadDataset']).toHaveBeenCalledWith(10, expect.any(FormData));
    const form = api['uploadDataset'].mock.calls[0][1] as FormData;
    expect(form.get('sourceType')).toBe('excel');
    expect(form.get('worksheetName')).toBe('Customers');
    expect(form.get('file')).toBe(file);
  });
});
