import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { ApiErrorBody, ProjectResponse } from '../../services/api.models';
import { AuthService } from '../../services/auth.service';
import { ForgeApiService } from '../../services/forge-api.service';
import { ProjectWorkflowContextService } from '../../services/project-workflow-context.service';
import { ProjectCardComponent } from '../../shared/project-card/project-card.component';

type ProjectSort = 'modified' | 'created' | 'name';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink, ProjectCardComponent],
  templateUrl: './home.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeComponent implements OnInit {
  private readonly api = inject(ForgeApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly workflowContext = inject(ProjectWorkflowContextService);

  readonly projects = signal<ProjectResponse[]>([]);
  readonly loading = signal(false);
  readonly loadError = signal('');
  readonly searchQuery = signal('');
  readonly sortBy = signal<ProjectSort>('modified');
  readonly user = this.auth.user;

  readonly greetingName = computed(() => this.user()?.firstName.trim() || 'there');
  readonly recentProjects = computed(() => {
    const query = this.searchQuery().trim().toLocaleLowerCase();
    const matching = query
      ? this.projects().filter((project) => `${project.name} ${project.description ?? ''}`.toLocaleLowerCase().includes(query))
      : [...this.projects()];
    return matching.sort((left, right) => this.compareProjects(left, right)).slice(0, 4);
  });
  readonly recentActivity = computed(() => this.projects()
    .filter((project) => Boolean(project.updatedAt && project.updatedAt !== project.createdAt))
    .sort((left, right) => this.timestamp(right.updatedAt ?? right.createdAt) - this.timestamp(left.updatedAt ?? left.createdAt))
    .slice(0, 4));
  readonly hasNoSearchResults = computed(() => !this.loading()
    && !this.loadError()
    && this.projects().length > 0
    && this.recentProjects().length === 0);

  ngOnInit(): void {
    this.loadProjects();
  }

  loadProjects(): void {
    this.loadError.set('');
    this.loading.set(true);
    this.api.getProjects().pipe(finalize(() => this.loading.set(false))).subscribe({
      next: (projects) => this.projects.set(projects),
      error: (error: { error?: ApiErrorBody }) => this.loadError.set(
        error.error?.message ?? 'Unable to load your projects. Please try again.',
      ),
    });
  }

  updateSearch(value: string): void {
    this.searchQuery.set(value);
  }

  clearSearch(): void {
    this.searchQuery.set('');
  }

  updateSort(value: string): void {
    if (value === 'modified' || value === 'created' || value === 'name') this.sortBy.set(value);
  }

  openProject(project: ProjectResponse): void {
    void this.router.navigateByUrl(project.recommendedRoute || `/projects/${project.id}/data`);
  }

  onProjectUpdated(updated: ProjectResponse): void {
    this.projects.update((projects) => projects.map((project) => project.id === updated.id ? updated : project));
    if (this.workflowContext.projectId() === updated.id) this.workflowContext.load(updated.id, true).subscribe();
  }

  onProjectDeleted(projectId: number): void {
    this.projects.update((projects) => projects.filter((project) => project.id !== projectId));
    if (this.workflowContext.projectId() === projectId) this.workflowContext.clear();
  }

  private compareProjects(left: ProjectResponse, right: ProjectResponse): number {
    if (this.sortBy() === 'name') return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
    const leftDate = this.sortBy() === 'created' ? left.createdAt : left.updatedAt || left.createdAt;
    const rightDate = this.sortBy() === 'created' ? right.createdAt : right.updatedAt || right.createdAt;
    return this.timestamp(rightDate) - this.timestamp(leftDate);
  }

  private timestamp(value: string): number {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
}
