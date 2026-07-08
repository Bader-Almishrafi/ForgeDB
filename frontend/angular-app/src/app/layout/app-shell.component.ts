import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { NgClass } from '@angular/common';
import { Params, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { WorkflowStateService } from '../services/workflow-state.service';

interface NavItem {
  label: string;
  route: () => string | null;
  icon: string;
  enabled: () => boolean;
  queryParams?: () => Params | null;
}

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NgClass],
  templateUrl: './app-shell.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShellComponent {
  readonly sidebarOpen = signal(false);
  readonly dropdownOpen = signal(false);
  readonly user = this.authService.user;
  readonly isLoggedIn = this.authService.isLoggedIn;
  readonly projectId = this.workflow.projectId;
  readonly projectName = this.workflow.projectName;
  readonly datasetId = this.workflow.datasetId;
  readonly datasetName = this.workflow.datasetName;
  readonly datasetStatus = this.workflow.datasetStatus;

  readonly navItems: NavItem[] = [
    { label: 'Overview', route: () => this.projectId() ? `/projects/${this.projectId()}/overview` : null, enabled: () => this.projectId() !== null, icon: 'M4 13h6V4H4v9Zm10 7h6V4h-6v16ZM4 20h6v-5H4v5Z' },
    { label: 'Datasets', route: () => this.projectId() ? `/projects/${this.projectId()}/datasets` : null, enabled: () => this.projectId() !== null, icon: 'M4 6h16M4 12h16M4 18h16' },
    { label: 'Explorer', route: () => this.datasetId() ? `/datasets/${this.datasetId()}/explorer` : null, enabled: () => this.datasetId() !== null, icon: 'M4 5h16v14H4zM4 10h16M10 5v14' },
    { label: 'Profile', route: () => this.datasetId() ? `/datasets/${this.datasetId()}/profile` : null, enabled: () => this.datasetId() !== null, icon: 'M4 19V5m0 14h16M8 16v-5m4 5V8m4 8v-7' },
    { label: 'Relationships', route: () => this.projectId() ? `/projects/${this.projectId()}/relationships` : null, enabled: () => this.projectId() !== null, icon: 'M7 7h4v4H7zM13 13h4v4h-4zM11 9h3a3 3 0 0 1 3 3v1' },
    { label: 'Schema Designer', route: () => this.projectId() ? `/projects/${this.projectId()}/schema-designer` : null, enabled: () => this.projectId() !== null, icon: 'M5 5h6v6H5zM13 5h6v6h-6zM5 13h6v6H5zM13 13h6v6h-6z' },
    { label: 'ER Diagram', route: () => this.projectId() ? `/projects/${this.projectId()}/er-diagram` : null, enabled: () => this.projectId() !== null, icon: 'M6 7h5v4H6zM13 13h5v4h-5zM11 9h2a3 3 0 0 1 3 3v1' },
    { label: 'Exports', route: () => this.projectId() ? `/projects/${this.projectId()}/exports` : null, enabled: () => this.projectId() !== null, icon: 'M12 3v10m0 0 4-4m-4 4-4-4M5 17h14v4H5z' },
  ];

  constructor(
    public router: Router,
    private authService: AuthService,
    private workflow: WorkflowStateService,
  ) {}

  toggleDropdown(): void {
    this.dropdownOpen.update((value) => !value);
  }

  logout(): void {
    this.dropdownOpen.set(false);
    this.authService.logout();
    this.workflow.clearAll();
    this.router.navigate(['/']);
  }

  initials(): string {
    const currentUser = this.user();
    if (!currentUser) {
      return 'FD';
    }

    return `${currentUser.firstName[0] ?? ''}${currentUser.lastName[0] ?? ''}`.toUpperCase();
  }

  toggleSidebar(): void {
    this.sidebarOpen.update((value) => !value);
  }

  closeSidebar(): void {
    this.sidebarOpen.set(false);
  }
}
