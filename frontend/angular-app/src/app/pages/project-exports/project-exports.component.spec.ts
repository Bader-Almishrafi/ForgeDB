import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileDownloadService } from '../../services/file-download.service';
import { ForgeApiService } from '../../services/forge-api.service';
import { ProjectExportPackage } from '../../services/api.models';
import { WorkflowStateService } from '../../services/workflow-state.service';
import { ProjectExportsComponent } from './project-exports.component';

const exportPackage: ProjectExportPackage = {
  projectId: 10,
  projectName: 'Presentation',
  status: 'Database Package Ready',
  generatedAt: '2026-07-15T00:00:00Z',
  sql: 'CREATE TABLE customers (customer_id INTEGER PRIMARY KEY);',
  dbml: 'Table customers { customer_id integer [pk] }',
  jsonSchema: '{"title":"Presentation"}',
  relationshipReportJson: '{"relationships":[]}',
  dataQualityReportJson: '{"datasets":[]}',
};

describe('ProjectExportsComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProjectExportsComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ projectId: '10' }) } } },
        { provide: ForgeApiService, useValue: { getProjectExportPackage: vi.fn(() => of(exportPackage)) } },
        { provide: WorkflowStateService, useValue: { setProjectId: vi.fn() } },
        { provide: FileDownloadService, useValue: { downloadText: vi.fn() } },
      ],
    }).compileComponents();
  });

  it('allows long SQL previews to shrink within a mobile grid track', () => {
    const fixture = TestBed.createComponent(ProjectExportsComponent);
    fixture.detectChanges();

    const preview = fixture.nativeElement.querySelector('pre.code-preview') as HTMLElement;
    const previewPanel = preview.closest('article');
    const workspaceGrid = previewPanel?.parentElement;
    const metricGrid = fixture.nativeElement.querySelector('.metric-card')?.parentElement as HTMLElement;
    const metricCards = [...fixture.nativeElement.querySelectorAll('.metric-card')] as HTMLElement[];

    expect(metricGrid.classList.contains('grid-cols-1')).toBe(true);
    expect(metricCards.every(card => card.classList.contains('min-w-0'))).toBe(true);
    expect(preview.classList.contains('w-full')).toBe(true);
    expect(preview.classList.contains('max-w-full')).toBe(true);
    expect(previewPanel?.classList.contains('min-w-0')).toBe(true);
    expect(workspaceGrid?.classList.contains('min-w-0')).toBe(true);
  });
});
