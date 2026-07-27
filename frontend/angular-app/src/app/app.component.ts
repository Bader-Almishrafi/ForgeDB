import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AppToastComponent } from './shared/toast/app-toast.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, AppToastComponent],
  template: '<app-toast /><router-outlet />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {}
