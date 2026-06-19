import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { NgClass } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

interface NavItem {
  label: string;
  route: string;
  icon: string;
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

  readonly navItems: NavItem[] = [
    { label: 'Dashboard', route: '/dashboard', icon: 'M3 10.75 12 3l9 7.75V21a.75.75 0 0 1-.75.75h-5.5v-6.5h-5.5v6.5h-5.5A.75.75 0 0 1 3 21V10.75Z' },
    { label: 'Projects', route: '/projects', icon: 'M3.75 6.75h5.19l1.06 1.5h10.25v9.75a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5V6.75Z' },
    { label: 'Data Sources', route: '/data-sources', icon: 'M12 3c4.56 0 8.25 1.34 8.25 3S16.56 9 12 9 3.75 7.66 3.75 6 7.44 3 12 3Zm-8.25 8.25C3.75 12.91 7.44 14.25 12 14.25s8.25-1.34 8.25-3M3.75 16.5c0 1.66 3.69 3 8.25 3s8.25-1.34 8.25-3' },
    { label: 'Analyses', route: '/analysis', icon: 'M4.5 19.5V12m5 7.5V8m5 11.5V4m5 15.5V10' },
    { label: 'Schemas', route: '/schema-review', icon: 'M4.5 5.25h15v13.5h-15V5.25Zm0 4.5h15M9 5.25v13.5' },
    { label: 'Relationships', route: '/relationships', icon: 'M6.75 6.75a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm15 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-7.5 10.5a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0ZM6.3 8.2l4.25 6.1m7.15-6.1-4.25 6.1' },
    { label: 'Deployments', route: '/deployment', icon: 'M12 2.75 20.25 7.5v9L12 21.25 3.75 16.5v-9L12 2.75Zm0 0v9m8.25-4.75L12 11.75 3.75 7' },
    { label: 'SQL Scripts', route: '/sql-scripts', icon: 'M8.25 8.25 4.5 12l3.75 3.75M15.75 8.25 19.5 12l-3.75 3.75M13.5 5.25 10.5 18.75' },
    { label: 'Settings', route: '/settings', icon: 'M12 8.25A3.75 3.75 0 1 0 12 15.75 3.75 3.75 0 0 0 12 8.25Zm0-5.5.83 2.2a7.6 7.6 0 0 1 1.7.7l2.14-.97 2.65 2.65-.97 2.14c.3.55.54 1.12.7 1.7l2.2.83v3.75l-2.2.83a7.6 7.6 0 0 1-.7 1.7l.97 2.14-2.65 2.65-2.14-.97a7.6 7.6 0 0 1-1.7.7l-.83 2.2H8.25l-.83-2.2a7.6 7.6 0 0 1-1.7-.7l-2.14.97L.93 19.42l.97-2.14a7.6 7.6 0 0 1-.7-1.7L-1 14.75V11l2.2-.83c.16-.58.4-1.15.7-1.7L.93 6.33l2.65-2.65 2.14.97a7.6 7.6 0 0 1 1.7-.7l.83-2.2H12Z' },
  ];

  toggleSidebar(): void {
    this.sidebarOpen.update((value) => !value);
  }

  closeSidebar(): void {
    this.sidebarOpen.set(false);
  }
}
