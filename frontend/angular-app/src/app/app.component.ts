import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: '<router-outlet />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  constructor() {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('darkMode') === 'true') {
      document.documentElement.classList.add('dark');
    }
  }
}
