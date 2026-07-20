import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, HostListener, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { ThemeService } from '../services/theme.service';

interface ApplicationNavItem {
  label: string;
  route: string;
  exact: boolean;
  icon: string;
}

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [NgClass, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './app-shell.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShellComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly themeService = inject(ThemeService);
  private readonly destroyRef = inject(DestroyRef);

  readonly accountOpen = signal(false);
  readonly mobileSidebarOpen = signal(false);
  readonly sidebarCollapsed = signal(false);
  readonly currentUrl = signal(this.router.url);
  readonly user = this.auth.user;
  readonly theme = this.themeService.theme;
  readonly displayName = computed(() => {
    const current = this.user();
    return current ? `${current.firstName} ${current.lastName}`.trim() : 'ForgeDB user';
  });
  readonly pageTitle = computed(() => {
    const path = this.currentUrl().split('?')[0];
    if (path === '/projects/new') return 'Create Project';
    if (path === '/change-password') return 'Change Password';
    return 'Projects';
  });

  readonly navItems: readonly ApplicationNavItem[] = [
    { label: 'Projects', route: '/projects', exact: true, icon: 'M3.5 7.5h6l2-2h9v14h-17v-12Z' },
    { label: 'Create Project', route: '/projects/new', exact: true, icon: 'M12 5v14M5 12h14' },
    { label: 'Change Password', route: '/change-password', exact: true, icon: 'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5V10Zm7 4v3' },
  ];

  constructor() {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((event) => {
        this.currentUrl.set(event.urlAfterRedirects);
        this.mobileSidebarOpen.set(false);
        this.accountOpen.set(false);
      });
  }

  toggleDesktopSidebar(): void {
    this.sidebarCollapsed.update((collapsed) => !collapsed);
  }

  toggleMobileSidebar(): void {
    this.mobileSidebarOpen.update((open) => !open);
  }

  closeMobileSidebar(): void {
    this.mobileSidebarOpen.set(false);
  }

  toggleTheme(): void {
    this.themeService.toggle();
  }

  logout(): void {
    this.accountOpen.set(false);
    this.auth.logout();
    void this.router.navigate(['/']);
  }

  initials(): string {
    const current = this.user();
    return current ? `${current.firstName[0] ?? ''}${current.lastName[0] ?? ''}`.toUpperCase() : 'FD';
  }

  @HostListener('document:keydown.escape')
  closeOverlaysOnEscape(): void {
    this.accountOpen.set(false);
    this.mobileSidebarOpen.set(false);
  }
}
