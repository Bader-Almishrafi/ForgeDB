import { ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, HostListener, inject, signal, viewChild } from '@angular/core';
import { NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { ThemeService } from '../services/theme.service';
import { WorkflowStateService } from '../services/workflow-state.service';
import { AppNotification } from '../shared/home.models';
import { NotificationDropdownComponent } from '../shared/notification-dropdown/notification-dropdown.component';

interface NavItem {
  label: string;
  route: () => string | null;
  icon: string;
  exact: boolean;
  unavailableReason?: string;
}

interface BreadcrumbItem {
  label: string;
  route?: string;
}

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NgClass, FormsModule, NotificationDropdownComponent],
  templateUrl: './app-shell.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShellComponent {
  private readonly destroyRef = inject(DestroyRef);
  readonly profileTrigger = viewChild<ElementRef<HTMLButtonElement>>('profileTrigger');
  readonly sidebarOpen = signal(false);
  readonly profileOpen = signal(false);
  readonly currentUrl = signal(this.router.url);
  readonly user = this.auth.user;
  readonly projectId = this.workflow.projectId;
  readonly projectName = this.workflow.projectName;
  readonly datasetId = this.workflow.datasetId;
  readonly theme = this.themeService.theme;
  readonly notifications = signal<AppNotification[]>([]);
  headerSearch = '';

  readonly displayName = computed(() => {
    const current = this.user();
    return current ? `${current.firstName} ${current.lastName}`.trim() : 'ForgeDB user';
  });
  readonly breadcrumbs = computed<BreadcrumbItem[]>(() => this.createBreadcrumbs(this.currentUrl()));
  readonly pageTitle = computed(() => this.breadcrumbs().at(-1)?.label ?? 'Home');
  readonly backRoute = computed(() => this.createBackRoute(this.currentUrl()));

  readonly navItems: NavItem[] = [
    { label: 'Home', route: () => '/home', exact: true, icon: 'M3 11.5 12 4l9 7.5M5.5 10v10h13V10M9 20v-6h6v6' },
    { label: 'Projects', route: () => '/projects', exact: true, icon: 'M3.5 7.5h6l2-2h9v14h-17v-12Z' },
    { label: 'Dashboard', route: () => this.datasetId() ? `/datasets/${this.datasetId()}/dashboard` : null, exact: true, icon: 'M4 19V5m0 14h16M8 16v-5m4 5V8m4 8V6' },
    { label: 'Data Sources', route: () => this.projectId() ? `/projects/${this.projectId()}/datasets` : null, exact: false, icon: 'M4 6h16v5H4V6Zm0 7h16v5H4v-5Zm3-4h.01M7 16h.01' },
    { label: 'Analysis', route: () => this.datasetId() ? `/datasets/${this.datasetId()}/profile` : null, exact: false, icon: 'M4 19V9m5 10V5m5 14v-7m5 7V3' },
    { label: 'Data Cleaning', route: () => null, exact: true, unavailableReason: 'No data cleaning route is available', icon: 'm4 20 5-5m0 0 8-8 2 2-8 8m-2-2-4-4m9-6 2-2' },
    { label: 'Schema', route: () => this.projectId() ? `/projects/${this.projectId()}/schema-designer` : null, exact: false, icon: 'M4 5h6v6H4V5Zm10 0h6v6h-6V5ZM4 15h6v4H4v-4Zm10 0h6v4h-6v-4Z' },
    { label: 'Relationships', route: () => this.projectId() ? `/projects/${this.projectId()}/relationships` : null, exact: false, icon: 'M5 5h5v5H5V5Zm9 9h5v5h-5v-5Zm-4-6h3a4 4 0 0 1 4 4v2' },
    { label: 'Deployment', route: () => null, exact: true, unavailableReason: 'No deployment route is available', icon: 'M12 3v12m0 0 4-4m-4 4-4-4M5 17v4h14v-4' },
    { label: 'Settings', route: () => null, exact: true, unavailableReason: 'No settings route is available', icon: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0-5v2m0 13v2m8.5-8.5h-2m-13 0h-2m15-6.5-1.5 1.5m-9 9-1.5 1.5m12 0L17 16m-9-9L6.5 5.5' },
  ];

  constructor(
    readonly router: Router,
    private readonly auth: AuthService,
    private readonly workflow: WorkflowStateService,
    private readonly themeService: ThemeService,
    private readonly host: ElementRef<HTMLElement>,
  ) {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((event) => {
        this.currentUrl.set(event.urlAfterRedirects);
        this.sidebarOpen.set(false);
      });
  }

  toggleSidebar(): void {
    this.sidebarOpen.update((value) => !value);
  }

  closeSidebar(): void {
    this.sidebarOpen.set(false);
  }

  toggleProfile(): void {
    this.profileOpen.update((value) => !value);
  }

  toggleTheme(): void {
    this.themeService.toggle();
  }

  submitSearch(): void {
    const search = this.headerSearch.trim();
    if (!search) {
      return;
    }
    this.router.navigate(['/projects'], { queryParams: { search } });
    this.headerSearch = '';
  }

  logout(): void {
    this.profileOpen.set(false);
    this.auth.logout();
    this.workflow.clearAll();
    this.router.navigate(['/']);
  }

  initials(): string {
    const current = this.user();
    if (!current) {
      return 'FD';
    }
    return `${current.firstName[0] ?? ''}${current.lastName[0] ?? ''}`.toUpperCase() || 'FD';
  }

  @HostListener('document:keydown.escape')
  closeMenusOnEscape(): void {
    if (this.profileOpen()) {
      this.profileOpen.set(false);
      this.profileTrigger()?.nativeElement.focus();
    }
    this.sidebarOpen.set(false);
  }

  @HostListener('document:click', ['$event'])
  closeProfileOnOutsideClick(event: MouseEvent): void {
    const target = event.target as Node;
    const profileMenu = this.host.nativeElement.querySelector('[data-profile-menu]');
    if (this.profileOpen() && profileMenu && !profileMenu.contains(target)) {
      this.profileOpen.set(false);
    }
  }

  private createBreadcrumbs(url: string): BreadcrumbItem[] {
    const path = url.split('?')[0];
    if (path === '/home') {
      return [{ label: 'Home' }];
    }
    if (path === '/projects') {
      return [{ label: 'Projects' }];
    }
    if (path === '/projects/new') {
      return [
        { label: 'Home', route: '/home' },
        { label: 'Projects', route: '/projects' },
        { label: 'Create New Project' },
      ];
    }

    const projectMatch = path.match(/^\/projects\/(\d+)\/(.+)$/);
    if (projectMatch) {
      const projectId = projectMatch[1];
      const section = projectMatch[2];
      const labels: Record<string, string> = {
        overview: 'Overview', datasets: 'Data Sources', upload: 'Upload Data', relationships: 'Relationships',
        'schema-designer': 'Schema', 'er-diagram': 'ER Diagram', exports: 'Exports',
      };
      return [
        { label: 'Projects', route: '/projects' },
        { label: this.projectName() || `Project ${projectId}`, route: `/projects/${projectId}/overview` },
        { label: labels[section] ?? 'Workspace' },
      ];
    }

    const datasetMatch = path.match(/^\/datasets\/(\d+)\/(.+)$/);
    if (datasetMatch) {
      const labels: Record<string, string> = {
        preview: 'Preview', explorer: 'Explorer', analyze: 'Analyze', dashboard: 'Dashboard', profile: 'Analysis',
      };
      return [
        { label: 'Projects', route: '/projects' },
        { label: this.projectName() || 'Current Project', route: this.projectId() ? `/projects/${this.projectId()}/overview` : '/projects' },
        { label: labels[datasetMatch[2]] ?? 'Dataset' },
      ];
    }
    return [{ label: 'Workspace' }];
  }

  private createBackRoute(url: string): string | null {
    const path = url.split('?')[0];
    if (path === '/home' || path === '/projects') {
      return null;
    }
    if (path === '/projects/new') {
      return '/projects';
    }
    const projectMatch = path.match(/^\/projects\/(\d+)\/(.+)$/);
    if (projectMatch) {
      return projectMatch[2] === 'overview' ? '/projects' : `/projects/${projectMatch[1]}/overview`;
    }
    if (path.startsWith('/datasets/')) {
      return this.projectId() ? `/projects/${this.projectId()}/datasets` : '/projects';
    }
    return '/home';
  }
}
