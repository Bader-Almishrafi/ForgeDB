import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { ApiErrorBody, ProjectResponse } from '../../services/api.models';
import { AuthService } from '../../services/auth.service';
import { ForgeApiService } from '../../services/forge-api.service';
import { WorkflowStateService } from '../../services/workflow-state.service';
import { ProjectCardComponent } from '../../shared/project-card/project-card.component';

type ProjectSort = 'modified' | 'created' | 'name';

@Component({
  selector: 'app-projects',
  standalone: true,
  imports: [FormsModule, RouterLink, ProjectCardComponent],
  templateUrl: './projects.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectsComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  readonly projects = signal<ProjectResponse[]>([]);
  readonly loading = signal(false);
  readonly loadError = signal('');
  readonly searchQuery = signal('');
  readonly sortBy = signal<ProjectSort>('modified');

  readonly filteredProjects = computed(() => {
    const query = this.searchQuery().trim().toLocaleLowerCase();
    const matching = query
      ? this.projects().filter((project) => project.name.toLocaleLowerCase().includes(query))
      : [...this.projects()];
    return matching.sort((left, right) => this.compareProjects(left, right));
  });

  constructor(
    private readonly api: ForgeApiService,
    private readonly auth: AuthService,
    private readonly workflow: WorkflowStateService,
    private readonly router: Router,
    private readonly route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => this.searchQuery.set(params.get('search') ?? ''));
    this.loadProjects();
  }

  loadProjects(): void {
    const userId = this.auth.userId();
    if (userId === null) {
      return;
    }

    this.loadError.set('');
    this.loading.set(true);
    this.api.getUserProjects(userId)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (projects) => this.projects.set(projects),
        error: (error: { error?: ApiErrorBody }) => {
          this.loadError.set(error.error?.message ?? 'Unable to load projects. Please try again.');
        },
      });
  }

  updateSearch(value: string): void {
    this.searchQuery.set(value);
  }

  clearSearch(): void {
    this.searchQuery.set('');
  }

  updateSort(value: string): void {
    if (value === 'modified' || value === 'created' || value === 'name') {
      this.sortBy.set(value);
    }
  }

  openProject(project: ProjectResponse): void {
    this.workflow.setProject(project);
    this.router.navigate(['/projects', project.id, 'overview']);
  }

  onProjectUpdated(updated: ProjectResponse): void {
    this.projects.update((projects) => projects.map((project) => project.id === updated.id ? updated : project));
  }

  onProjectDeleted(projectId: number): void {
    this.projects.update((projects) => projects.filter((project) => project.id !== projectId));
  }

  private compareProjects(left: ProjectResponse, right: ProjectResponse): number {
    if (this.sortBy() === 'name') {
      return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
    }
    const leftDate = this.sortBy() === 'created' ? left.createdAt : left.updatedAt || left.createdAt;
    const rightDate = this.sortBy() === 'created' ? right.createdAt : right.updatedAt || right.createdAt;
    return this.timestamp(rightDate) - this.timestamp(leftDate);
  }

  private timestamp(value: string): number {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
}
