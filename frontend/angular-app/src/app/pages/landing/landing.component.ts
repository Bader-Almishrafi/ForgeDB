import { Component, effect, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './landing.html',
  styleUrl: './landing.css',
})
export class LandingComponent {
  darkMode = signal<boolean>(false);

  constructor() {
    const saved = localStorage.getItem('darkMode');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (saved) {
      this.darkMode.set(saved === 'true');
    } else if (prefersDark) {
      this.darkMode.set(true);
    }
    
    effect(() => {
      const isDark = this.darkMode();
      localStorage.setItem('darkMode', String(isDark));
      if (isDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    });
  }

  toggleDarkMode(): void {
    this.darkMode.update((v) => !v);
  }
}
