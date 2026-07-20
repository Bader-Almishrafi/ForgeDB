import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectResponse } from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { ProjectCardComponent } from './project-card.component';

const project: ProjectResponse = {
  id: 4,
  name: 'Orders',
  description: 'Order imports',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-07-01T00:00:00Z',
  workflowState: 'NeedsAnalysis',
  currentStep: 'Analyze',
  recommendedRoute: '/projects/4/analyze',
  datasetsCount: 3,
};

describe('ProjectCardComponent', () => {
  let fixture: ComponentFixture<ProjectCardComponent>;
  let component: ProjectCardComponent;
  let updateProject: ReturnType<typeof vi.fn>;
  let deleteProject: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    updateProject = vi.fn(() => of({ ...project, name: 'Updated orders' }));
    deleteProject = vi.fn(() => of(undefined));
    await TestBed.configureTestingModule({
      imports: [ProjectCardComponent],
      providers: [{ provide: ForgeApiService, useValue: { updateProject, deleteProject } }],
    }).compileComponents();
    fixture = TestBed.createComponent(ProjectCardComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('project', project);
    fixture.detectChanges();
  });

  it('shows useful project information and explicit actions', () => {
    expect(fixture.nativeElement.textContent).toContain('Orders');
    expect(fixture.nativeElement.textContent).toContain('Analyze');
    expect(fixture.nativeElement.textContent).toContain('3');
    expect(fixture.nativeElement.textContent).toContain('Open');
    expect(fixture.nativeElement.textContent).toContain('Edit');
    expect(fixture.nativeElement.textContent).toContain('Delete');
  });

  it('edits name and description through the authenticated project API', () => {
    const emitted = vi.fn();
    component.projectUpdated.subscribe(emitted);
    component.startEdit();
    component.editName = '  Updated orders  ';
    component.editDescription = '  New description  ';
    component.saveEdit();

    expect(updateProject).toHaveBeenCalledWith(4, { name: 'Updated orders', description: 'New description' });
    expect(emitted).toHaveBeenCalledWith(expect.objectContaining({ name: 'Updated orders' }));
  });

  it('deletes only after explicit confirmation', () => {
    const emitted = vi.fn();
    component.projectDeleted.subscribe(emitted);
    expect(deleteProject).not.toHaveBeenCalled();

    component.confirmDelete();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="delete-project-confirmation"]')).toBeTruthy();
    component.deleteProject();

    expect(deleteProject).toHaveBeenCalledWith(4);
    expect(emitted).toHaveBeenCalledWith(4);
  });
});
