import { CanDeactivateFn } from '@angular/router';
import { Observable } from 'rxjs';

export interface UnsavedChangesAware {
  canDeactivate(): boolean | Observable<boolean>;
}

export const unsavedChangesGuard: CanDeactivateFn<UnsavedChangesAware> = (component) => component.canDeactivate();
