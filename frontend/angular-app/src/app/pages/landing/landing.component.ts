import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './landing.html',
  styleUrl: './landing.css',
})
export class LandingComponent {
  private readonly themeService = inject(ThemeService);
  readonly darkMode = this.themeService.isDark;

  toggleDarkMode(): void {
    this.themeService.toggle();
  }
}
