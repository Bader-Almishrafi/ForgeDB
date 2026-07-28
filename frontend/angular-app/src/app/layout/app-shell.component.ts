import { NgClass } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  HostListener,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { ProjectWorkflowContextService } from '../services/project-workflow-context.service';
import { ThemeService } from '../services/theme.service';
import { DialogFocusTrapDirective } from '../shared/dialog-focus-trap.directive';

interface ShellNavItem {
  label: string;
  route: string;
  icon: string;
  match: 'home' | 'projects' | 'create';
}

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [NgClass, RouterLink, RouterOutlet, DialogFocusTrapDirective],
  templateUrl: './app-shell.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShellComponent {
  private readonly auth = inject(AuthService);
  private readonly workflowContext = inject(ProjectWorkflowContextService);
  private readonly router = inject(Router);
  private readonly themeService = inject(ThemeService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly accountArea = viewChild<ElementRef<HTMLElement>>('accountArea');
  private readonly accountTrigger = viewChild<ElementRef<HTMLButtonElement>>('accountTrigger');
  private readonly firstAccountAction = viewChild<ElementRef<HTMLAnchorElement>>('firstAccountAction');
  private readonly navigationTrigger = viewChild<ElementRef<HTMLButtonElement>>('navigationTrigger');
  private readonly sidebarClose = viewChild<ElementRef<HTMLButtonElement>>('sidebarClose');
  private readonly mainContent = viewChild<ElementRef<HTMLElement>>('mainContent');
  private focusMainAfterNavigation = false;
  private readonly navigationMediaQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(min-width: 1024px)')
    : null;

  readonly sidebarOpen = signal(false);
  readonly desktopNavigation = signal(this.navigationMediaQuery?.matches ?? true);
  readonly userMenuOpen = signal(false);
  readonly currentUrl = signal(this.router.url);
  readonly user = this.auth.user;
  readonly theme = this.themeService.theme;

  readonly currentPath = computed(() => this.currentUrl().split('?')[0].replace(/\/$/, '') || '/');
  readonly displayName = computed(() => {
    const current = this.user();
    return current ? `${current.firstName} ${current.lastName}`.trim() : 'ForgeDB user';
  });
  readonly initials = computed(() => {
    const current = this.user();
    return current ? `${current.firstName[0] ?? ''}${current.lastName[0] ?? ''}`.toUpperCase() : 'FD';
  });
  readonly pageTitle = computed(() => {
    const path = this.currentPath();
    if (path === '/home') return 'Home';
    if (path === '/projects/new') return 'Create project';
    if (path === '/change-password') return 'Change password';
    if (/^\/projects\/\d+(\/|$)/.test(path)) return 'Project workflow';
    return 'Projects';
  });
  readonly themeActionLabel = computed(() => this.theme() === 'dark' ? 'Use light theme' : 'Use dark theme');

  readonly workspaceItems: readonly ShellNavItem[] = [
    { label: 'Home', route: '/home', match: 'home', icon: 'M3.5 11 12 4l8.5 7M5.5 9.5V20h5v-6h3v6h5V9.5' },
    { label: 'Projects', route: '/projects', match: 'projects', icon: 'M3.5 7.5h6l2-2h9v14h-17v-12Z' },
    { label: 'Create project', route: '/projects/new', match: 'create', icon: 'M12 5v14M5 12h14' },
  ];
  private readonly navigationMediaListener = (event: MediaQueryListEvent): void => {
    this.desktopNavigation.set(event.matches);
    if (event.matches) this.closeNavigation();
  };

  constructor() {
    this.navigationMediaQuery?.addEventListener('change', this.navigationMediaListener);
    this.destroyRef.onDestroy(() => {
      this.navigationMediaQuery?.removeEventListener('change', this.navigationMediaListener);
      this.workflowContext.clear();
    });

    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((event) => {
        this.currentUrl.set(event.urlAfterRedirects);
        const shouldFocusMain = this.focusMainAfterNavigation;
        this.focusMainAfterNavigation = false;
        this.closeNavigation();
        if (shouldFocusMain) setTimeout(() => this.mainContent()?.nativeElement.focus());
      });
  }

  isNavItemActive(item: ShellNavItem): boolean {
    const path = this.currentPath();
    if (item.match === 'home') return path === '/home';
    if (item.match === 'create') return path === '/projects/new';
    return path === '/projects' || (/^\/projects\/\d+(\/|$)/.test(path));
  }

  toggleSidebar(): void {
    if (this.sidebarOpen()) {
      this.closeNavigation(true);
      return;
    }

    this.sidebarOpen.set(true);
    this.userMenuOpen.set(false);
    setTimeout(() => this.sidebarClose()?.nativeElement.focus());
  }

  closeNavigation(restoreFocus = false): void {
    const wasOpen = this.sidebarOpen();
    this.sidebarOpen.set(false);
    this.userMenuOpen.set(false);
    if (restoreFocus && wasOpen) {
      setTimeout(() => this.navigationTrigger()?.nativeElement.focus());
    }
  }

  prepareNavigation(targetRoute: string): void {
    if (!this.desktopNavigation() && this.sidebarOpen()) {
      if (this.currentPath() !== targetRoute) {
        this.focusMainAfterNavigation = true;
        return;
      }

      this.closeNavigation();
      setTimeout(() => this.mainContent()?.nativeElement.focus());
      return;
    }

    this.closeNavigation();
  }

  toggleUserMenu(): void {
    if (this.userMenuOpen()) {
      this.closeUserMenu(true);
      return;
    }
    this.userMenuOpen.set(true);
    setTimeout(() => this.firstAccountAction()?.nativeElement.focus());
  }

  toggleTheme(): void {
    this.themeService.toggle();
  }

  logout(): void {
    this.workflowContext.clear();
    this.auth.logout();
    void this.router.navigate(['/']);
  }

  @HostListener('document:keydown.escape')
  closeOnEscape(): void {
    if (this.userMenuOpen()) {
      this.closeUserMenu(true);
      return;
    }
    this.closeNavigation(true);
  }

  @HostListener('document:click', ['$event'])
  closeAccountMenuOnOutsideClick(event: MouseEvent): void {
    const target = event.target;
    if (this.userMenuOpen() && target instanceof Node && !this.accountArea()?.nativeElement.contains(target)) {
      this.closeUserMenu(false);
    }
  }

  private closeUserMenu(restoreFocus: boolean): void {
    this.userMenuOpen.set(false);
    if (restoreFocus) setTimeout(() => this.accountTrigger()?.nativeElement.focus());
  }
}
