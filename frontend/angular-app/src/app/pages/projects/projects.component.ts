import { CommonModule, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { ApiErrorBody, ProjectResponse } from '../../services/api.models';
import { AuthService } from '../../services/auth.service';
import { ForgeApiService } from '../../services/forge-api.service';
import { WorkflowStateService } from '../../services/workflow-state.service';

@Component({
  selector: 'app-projects',
  standalone: true,
  imports: [CommonModule, DatePipe, FormsModule],
  templateUrl: './projects.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectsComponent implements OnInit {
  readonly projects = signal<ProjectResponse[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);

  projectName = '';
  projectDescription = '';
  errorMessage = '';
  successMessage = '';

  constructor(
    private api: ForgeApiService,
    private authService: AuthService,
    private workflow: WorkflowStateService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.loadProjects();
  }

  loadProjects(): void {
    const userId = this.requireUserId();
    if (userId === null) {
      return;
    }

    this.errorMessage = '';
    this.loading.set(true);

    this.api.getUserProjects(userId)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (projects) => this.projects.set(projects),
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to load projects.';
        },
      });
  }

  createProject(): void {
    const userId = this.requireUserId();
    if (userId === null) {
      return;
    }

    this.errorMessage = '';
    this.successMessage = '';
    this.saving.set(true);

    this.api.createProject({
      userId,
      name: this.projectName,
      description: this.projectDescription || null,
    }).pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: (project) => {
          this.projectName = '';
          this.projectDescription = '';
          this.successMessage = 'Project created.';
          this.workflow.setProject(project);
          this.projects.update((projects) => [project, ...projects]);
          this.router.navigate(['/projects', project.id, 'overview']);
        },
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to create project.';
        },
      });
  }

  openWorkspace(project: ProjectResponse): void {
    this.workflow.setProject(project);
    this.router.navigate(['/projects', project.id, 'overview']);
  }

  readonly confirmDeleteId = signal<number | null>(null);
  readonly deleting = signal(false);

  confirmDelete(project: ProjectResponse): void {
    this.confirmDeleteId.set(project.id);
  }

  cancelDelete(): void {
    this.confirmDeleteId.set(null);
  }

  deleteProject(project: ProjectResponse): void {
    this.deleting.set(true);
    this.errorMessage = '';

    this.api.deleteProject(project.id)
      .pipe(finalize(() => {
        this.deleting.set(false);
        this.confirmDeleteId.set(null);
      }))
      .subscribe({
        next: () => {
          this.projects.update((list) => list.filter((p) => p.id !== project.id));
          this.successMessage = `Project "${project.name}" deleted.`;
          this.workflow.clearAll();
          setTimeout(() => { this.successMessage = ''; }, 3000);
        },
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to delete project.';
        },
      });
  }

  private requireUserId(): number | null {
    const userId = this.authService.userId();
    if (userId === null) {
      this.router.navigate(['/login']);
      return null;
    }

    return userId;
  }
}
