import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { ApiErrorBody, ProjectResponse } from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { ProjectCardComponent } from '../../shared/project-card/project-card.component';

type ProjectSort = 'modified' | 'created' | 'name';

@Component({
  selector: 'app-projects',
  standalone: true,
  imports: [FormsModule, RouterLink, ProjectCardComponent],
  templateUrl: './projects.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
// Owns the authenticated user's project collection and coordinates search, sorting,
// card events, workflow selection, and navigation to an individual project.
export class ProjectsComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  readonly projects = signal<ProjectResponse[]>([]);
  readonly loading = signal(false);
  readonly loadError = signal('');
  readonly searchQuery = signal('');
  readonly sortBy = signal<ProjectSort>('modified');

  // This computed signal reruns whenever projects, searchQuery, or sortBy changes, producing
  // a presentation-only copy so filtering and sorting never mutate the source collection.
  readonly filteredProjects = computed(() => {
    const query = this.searchQuery().trim().toLocaleLowerCase();
    const matching = query
      ? this.projects().filter((project) => project.name.toLocaleLowerCase().includes(query))
      : [...this.projects()];
    return matching.sort((left, right) => this.compareProjects(left, right));
  });

  constructor(
    private readonly api: ForgeApiService,
    private readonly router: Router,
    private readonly route: ActivatedRoute,
  ) {}

  // Synchronizes the header search query with this page and starts the initial authenticated load.
  // takeUntilDestroyed releases the query-parameter subscription with the component.
  ngOnInit(): void {
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => this.searchQuery.set(params.get('search') ?? ''));
    this.loadProjects();
  }

  // Loads only the signed-in user's projects and uses finalize to clear the loading state on
  // either success or error.
  loadProjects(): void {
    this.loadError.set('');
    this.loading.set(true);
    this.api.getProjects()
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (projects) => this.projects.set(projects),
        error: (error: { error?: ApiErrorBody }) => {
          this.loadError.set(error.error?.message ?? 'Unable to load projects. Please try again.');
        },
      });
  }

  // Updates the search signal; filteredProjects reacts automatically.
  updateSearch(value: string): void {
    this.searchQuery.set(value);
  }

  // Restores the unfiltered project collection without another API request.
  clearSearch(): void {
    this.searchQuery.set('');
  }

  // Accepts only supported sort keys before updating the computed list dependency.
  updateSort(value: string): void {
    if (value === 'modified' || value === 'created' || value === 'name') {
      this.sortBy.set(value);
    }
  }

  openProject(project: ProjectResponse): void {
    void this.router.navigateByUrl(project.recommendedRoute || `/projects/${project.id}/data`);
  }

  // Replaces the edited response locally after a card emits it, avoiding a full list reload.
  onProjectUpdated(updated: ProjectResponse): void {
    this.projects.update((projects) => projects.map((project) => project.id === updated.id ? updated : project));
  }

  // Removes the deleted ID locally after the card confirms backend deletion.
  onProjectDeleted(projectId: number): void {
    this.projects.update((projects) => projects.filter((project) => project.id !== projectId));
  }

  // Applies name ordering or newest-first date ordering. Modified sorting falls back to creation
  // time for projects that have never been edited.
  private compareProjects(left: ProjectResponse, right: ProjectResponse): number {
    if (this.sortBy() === 'name') {
      return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
    }
    const leftDate = this.sortBy() === 'created' ? left.createdAt : left.updatedAt || left.createdAt;
    const rightDate = this.sortBy() === 'created' ? right.createdAt : right.updatedAt || right.createdAt;
    return this.timestamp(rightDate) - this.timestamp(leftDate);
  }

  // Converts API date strings into sortable numbers and treats malformed dates as the oldest.
  private timestamp(value: string): number {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
}
