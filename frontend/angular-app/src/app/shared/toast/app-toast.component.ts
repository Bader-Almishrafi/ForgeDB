import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService, ToastNotification } from '../../services/toast.service';

@Component({
  selector: 'app-toast',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pointer-events-none fixed top-4 right-4 z-[9999] flex w-full max-w-sm flex-col gap-3 sm:top-6 sm:right-6">
      @for (toast of toastService.toasts(); track toast.id) {
        <div
          class="pointer-events-auto flex items-start gap-3 rounded-2xl border p-4 shadow-xl transition-all duration-300 ease-out animate-in fade-in slide-in-from-top-3 backdrop-blur-md"
          [class.border-emerald-200]="toast.type === 'success'"
          [class.bg-emerald-50/95]="toast.type === 'success'"
          [class.text-emerald-900]="toast.type === 'success'"
          [class.dark:border-emerald-800/50]="toast.type === 'success'"
          [class.dark:bg-emerald-950/90]="toast.type === 'success'"
          [class.dark:text-emerald-200]="toast.type === 'success'"

          [class.border-rose-200]="toast.type === 'error'"
          [class.bg-rose-50/95]="toast.type === 'error'"
          [class.text-rose-900]="toast.type === 'error'"
          [class.dark:border-rose-800/50]="toast.type === 'error'"
          [class.dark:bg-rose-950/90]="toast.type === 'error'"
          [class.dark:text-rose-200]="toast.type === 'error'"

          [class.border-amber-200]="toast.type === 'warning'"
          [class.bg-amber-50/95]="toast.type === 'warning'"
          [class.text-amber-900]="toast.type === 'warning'"
          [class.dark:border-amber-800/50]="toast.type === 'warning'"
          [class.dark:bg-amber-950/90]="toast.type === 'warning'"
          [class.dark:text-amber-200]="toast.type === 'warning'"
          role="alert">
          
          <div class="mt-0.5 shrink-0">
            @if (toast.type === 'success') {
              <svg class="size-5 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            } @else if (toast.type === 'error') {
              <svg class="size-5 text-rose-600 dark:text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            } @else {
              <svg class="size-5 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          </div>

          <div class="flex-1 text-sm font-semibold leading-relaxed">
            {{ toast.message }}
          </div>

          <button
            type="button"
            (click)="toastService.dismiss(toast.id)"
            class="shrink-0 rounded-lg p-1 transition opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 focus:outline-none"
            [attr.aria-label]="'Dismiss notification'">
            <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      }
    </div>
  `,
})
export class AppToastComponent {
  readonly toastService = inject(ToastService);
}
