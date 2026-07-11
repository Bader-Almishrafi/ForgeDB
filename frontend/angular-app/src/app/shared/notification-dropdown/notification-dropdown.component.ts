import { ChangeDetectionStrategy, Component, computed, ElementRef, HostListener, input, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { AppNotification } from '../home.models';

@Component({
  selector: 'app-notification-dropdown',
  standalone: true,
  templateUrl: './notification-dropdown.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationDropdownComponent {
  readonly notifications = input<AppNotification[]>([]);
  readonly open = signal(false);
  readonly unreadCount = computed(() => this.notifications().filter((notification) => !notification.read).length);
  readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');

  constructor(
    private readonly host: ElementRef<HTMLElement>,
    private readonly router: Router,
  ) {}

  toggle(): void {
    this.open.update((value) => !value);
  }

  openNotification(notification: AppNotification): void {
    if (!notification.route) {
      return;
    }

    this.open.set(false);
    this.router.navigateByUrl(notification.route);
  }

  @HostListener('document:click', ['$event'])
  closeOnOutsideClick(event: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  closeOnEscape(): void {
    if (this.open()) {
      this.open.set(false);
      this.trigger()?.nativeElement.focus();
    }
  }
}
