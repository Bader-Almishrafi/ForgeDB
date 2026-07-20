import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectResponse } from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { ProjectCreateComponent } from './project-create.component';

const createdProject: ProjectResponse = {
  id: 10,
  name: 'Customer data',
  description: 'Imported later',
  createdAt: '2026-07-20T00:00:00Z',
  updatedAt: null,
  workflowState: 'NoData',
  currentStep: 'Data',
  recommendedRoute: '/projects/10/data',
  datasetsCount: 0,
};

describe('ProjectCreateComponent', () => {
  let fixture: ComponentFixture<ProjectCreateComponent>;
  let component: ProjectCreateComponent;
  let createProject: ReturnType<typeof vi.fn>;
  let router: Router;

  beforeEach(async () => {
    createProject = vi.fn(() => of(createdProject));
    await TestBed.configureTestingModule({
      imports: [ProjectCreateComponent],
      providers: [
        provideRouter([]),
        { provide: ForgeApiService, useValue: { createProject } },
      ],
    }).compileComponents();
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(ProjectCreateComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders only the simple name and description form', () => {
    expect(fixture.nativeElement.querySelector('[data-testid="project-name"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="project-description"]')).toBeTruthy();
    expect(fixture.nativeElement.textContent).not.toContain('Review');
    expect(fixture.nativeElement.textContent).not.toContain('CSV');
    expect(fixture.nativeElement.textContent).not.toContain('Excel');
    expect(fixture.nativeElement.textContent).not.toContain('API URL');
    expect(fixture.nativeElement.querySelectorAll('input[type="file"]')).toHaveLength(0);
  });

  it('rejects a whitespace-only project name', () => {
    component.projectForm.setValue({ name: '   ', description: '' });
    component.createProject();
    fixture.detectChanges();

    expect(createProject).not.toHaveBeenCalled();
    expect(component.projectForm.controls.name.hasError('whitespace')).toBe(true);
  });

  it('creates an empty project and navigates directly to Data', () => {
    component.projectForm.setValue({ name: '  Customer data  ', description: '  Imported later  ' });
    component.createProject();

    expect(createProject).toHaveBeenCalledWith({ name: 'Customer data', description: 'Imported later' });
    expect(router.navigate).toHaveBeenCalledWith(['/projects', 10, 'data']);
  });

  it('prevents duplicate submissions while creation is in progress', () => {
    const pending = new Subject<ProjectResponse>();
    createProject.mockReturnValue(pending);
    component.projectForm.setValue({ name: 'One request', description: '' });

    component.createProject();
    component.createProject();

    expect(createProject).toHaveBeenCalledTimes(1);
    expect(component.submitting()).toBe(true);
    pending.next(createdProject);
    pending.complete();
  });

  it('protects only dirty project detail changes', () => {
    expect(component.canDeactivate()).toBe(true);
    component.projectForm.controls.description.setValue('Unsaved');
    component.projectForm.markAsDirty();
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    expect(component.canDeactivate()).toBe(false);
    expect(window.confirm).toHaveBeenCalledOnce();
  });

  it('shows the backend error message', () => {
    createProject.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 400, error: { message: 'Project name already exists.' } })));
    component.projectForm.setValue({ name: 'Duplicate', description: '' });
    component.createProject();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Project name already exists.');
  });
});
