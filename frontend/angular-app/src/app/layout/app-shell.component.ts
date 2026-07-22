import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, HostListener, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { ThemeService } from '../services/theme.service';

interface ShellNavItem {
  label: string;
  route: string;
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

  readonly sidebarOpen = signal(false);
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
    if (path === '/home') return 'Home';
    if (path === '/projects/new') return 'Create Project';
    if (path === '/change-password') return 'Change Password';
    return 'Projects';
  });

  readonly workspaceItems: readonly ShellNavItem[] = [
    { label: 'Home', route: '/home', icon: 'M3.5 11 12 4l8.5 7M5.5 9.5V20h5v-6h3v6h5V9.5' },
    { label: 'Projects', route: '/projects', icon: 'M3.5 7.5h6l2-2h9v14h-17v-12Z' },
    { label: 'Create Project', route: '/projects/new', icon: 'M12 5v14M5 12h14' },
  ];

  constructor() {
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
    this.sidebarOpen.update((open) => !open);
  }

  closeSidebar(): void {
    this.sidebarOpen.set(false);
  }

  toggleCollapsed(): void {
    this.sidebarCollapsed.update((collapsed) => !collapsed);
  }

  toggleTheme(): void {
    this.themeService.toggle();
  }

  logout(): void {
    this.auth.logout();
    void this.router.navigate(['/']);
  }

  readonly initials = computed(() => {
    const current = this.user();
    return current ? `${current.firstName[0] ?? ''}${current.lastName[0] ?? ''}`.toUpperCase() : 'FD';
  });

  @HostListener('document:keydown.escape')
  closeSidebarOnEscape(): void {
    this.sidebarOpen.set(false);
  }
}
