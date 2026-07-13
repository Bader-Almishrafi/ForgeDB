import { ChangeDetectionStrategy, Component, computed, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { ApiErrorBody, ProjectResponse } from '../../services/api.models';
import { AuthService } from '../../services/auth.service';
import { ForgeApiService } from '../../services/forge-api.service';
import { WorkflowStateService } from '../../services/workflow-state.service';
import { RecentActivity } from '../../shared/home.models';
import { ProjectCardComponent } from '../../shared/project-card/project-card.component';

type ProjectSort = 'modified' | 'created' | 'name';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [FormsModule, RouterLink, ProjectCardComponent],
  templateUrl: './home.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeComponent implements OnInit {
  readonly projects = signal<ProjectResponse[]>([]);
  readonly loading = signal(false);
  readonly loadError = signal('');
  readonly searchQuery = signal('');
  readonly sortBy = signal<ProjectSort>('modified');
  readonly user = this.auth.user;
  readonly recentActivities = signal<RecentActivity[]>([]);

  readonly greetingName = computed(() => this.user()?.firstName.trim() || '');
  readonly filteredProjects = computed(() => {
    const query = this.searchQuery().trim().toLocaleLowerCase();
    const matching = query
      ? this.projects().filter((project) => project.name.toLocaleLowerCase().includes(query))
      : [...this.projects()];

    return matching.sort((left, right) => this.compareProjects(left, right)).slice(0, 4);
  });
  readonly hasNoSearchResults = computed(() =>
    !this.loading() && !this.loadError() && this.projects().length > 0 && this.filteredProjects().length === 0,
  );

  constructor(
    private readonly api: ForgeApiService,
    private readonly auth: AuthService,
    private readonly workflow: WorkflowStateService,
    private readonly router: Router,
  ) {}

  ngOnInit(): void {
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
    return this.toTimestamp(rightDate) - this.toTimestamp(leftDate);
  }

  private toTimestamp(value: string): number {
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }
}
