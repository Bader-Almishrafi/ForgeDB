import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, OnInit, signal, viewChild } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { ApiErrorBody, ProjectResponse } from '../../services/api.models';
import { AuthService } from '../../services/auth.service';
import { ForgeApiService } from '../../services/forge-api.service';
import { ProjectWorkflowContextService } from '../../services/project-workflow-context.service';
import { ProjectCardComponent } from '../../shared/project-card/project-card.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink, ProjectCardComponent],
  templateUrl: './home.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeComponent implements OnInit {
  private readonly api = inject(ForgeApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly workflowContext = inject(ProjectWorkflowContextService);
  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private readonly pageHeading = viewChild<ElementRef<HTMLHeadingElement>>('pageHeading');

  readonly projects = signal<ProjectResponse[]>([]);
  readonly loading = signal(false);
  readonly loadError = signal('');
  readonly user = this.auth.user;

  readonly greetingName = computed(() => this.user()?.firstName.trim() || 'there');
  readonly recentProjects = computed(() => [...this.projects()]
    .sort((left, right) => this.timestamp(right.updatedAt || right.createdAt)
      - this.timestamp(left.updatedAt || left.createdAt))
    .slice(0, 4));

  ngOnInit(): void {
    this.titleService.setTitle('Workspace - ForgeDB');
    this.metaService.updateTag({ name: 'description', content: 'Manage your ForgeDB data projects.' });
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
    setTimeout(() => this.pageHeading()?.nativeElement.focus());
  }

  private timestamp(value: string): number {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
}
