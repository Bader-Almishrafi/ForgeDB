import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { ThemeService } from '../services/theme.service';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterLink, RouterOutlet],
  templateUrl: './app-shell.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShellComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly themeService = inject(ThemeService);
  readonly accountOpen = signal(false);
  readonly user = this.auth.user;
  readonly theme = this.themeService.theme;

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
}
