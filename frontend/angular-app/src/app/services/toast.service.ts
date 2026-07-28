import { Injectable, signal } from '@angular/core';

export interface ToastNotification {
  id: number;
  type: 'success' | 'error' | 'warning';
  message: string;
}

@Injectable({
  providedIn: 'root',
})
export class ToastService {
  readonly toasts = signal<ToastNotification[]>([]);
  private nextId = 1;

  showSuccess(message: string, durationMs = 4000): void {
    const id = this.nextId++;
    this.toasts.update((list) => [...list, { id, type: 'success', message }]);
    if (durationMs > 0) {
      window.setTimeout(() => this.dismiss(id), durationMs);
    }
  }

  showError(message: string): void {
    const id = this.nextId++;
    // Error messages remain visible until explicitly dismissed by the user (Best Practice UX)
    this.toasts.update((list) => [...list, { id, type: 'error', message }]);
  }

  showWarning(message: string, durationMs = 6000): void {
    const id = this.nextId++;
    this.toasts.update((list) => [...list, { id, type: 'warning', message }]);
    if (durationMs > 0) {
      window.setTimeout(() => this.dismiss(id), durationMs);
    }
  }

  dismiss(id: number): void {
    this.toasts.update((list) => list.filter((toast) => toast.id !== id));
  }

  clear(): void {
    this.toasts.set([]);
  }
}
