import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './landing.html',
  styleUrl: './landing.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingComponent implements OnInit {
  private readonly themeService = inject(ThemeService);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);

  readonly darkMode = this.themeService.isDark;

  ngOnInit(): void {
    this.title.setTitle('ForgeDB - Data-to-database workflow');
    this.meta.updateTag({ name: 'description', content: 'Import CSV, Excel, or JSON API data, analyze and clean it, design relationships, then export or deploy a validated PostgreSQL schema.' });
  }

  toggleDarkMode(): void {
    this.themeService.toggle();
  }
}
