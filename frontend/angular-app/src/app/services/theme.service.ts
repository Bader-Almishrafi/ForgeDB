import { DOCUMENT } from '@angular/common';
import { computed, inject, Injectable, signal } from '@angular/core';

export type ThemePreference = 'light' | 'dark';

const themeKey = 'forgedb.theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly themeSignal = signal<ThemePreference>(this.readPreference());

  readonly theme = this.themeSignal.asReadonly();
  readonly isDark = computed(() => this.themeSignal() === 'dark');

  constructor() {
    this.applyTheme(this.themeSignal());
  }

  toggle(): void {
    this.setTheme(this.isDark() ? 'light' : 'dark');
  }

  setTheme(theme: ThemePreference): void {
    localStorage.setItem(themeKey, theme);
    this.themeSignal.set(theme);
    this.applyTheme(theme);
  }

  private readPreference(): ThemePreference {
    return localStorage.getItem(themeKey) === 'dark' ? 'dark' : 'light';
  }

  private applyTheme(theme: ThemePreference): void {
    const root = this.document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme;
  }
}
