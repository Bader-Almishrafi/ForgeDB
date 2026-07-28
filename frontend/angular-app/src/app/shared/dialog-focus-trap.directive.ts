import { booleanAttribute, Directive, ElementRef, HostBinding, HostListener, inject, input } from '@angular/core';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

@Directive({
  selector: '[appDialogFocusTrap]',
  standalone: true,
})
export class DialogFocusTrapDirective {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly appDialogFocusTrap = input(true, { transform: booleanAttribute });
  @HostBinding('attr.tabindex') readonly hostTabIndex = '-1';

  @HostListener('document:keydown', ['$event'])
  keepTabFocusInside(event: KeyboardEvent): void {
    if (!this.appDialogFocusTrap() || event.key !== 'Tab') return;

    const focusable = Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      .filter((element) => !element.hidden
        && !element.matches(':disabled')
        && element.getAttribute('aria-hidden') !== 'true'
        && !element.closest('[inert]'));
    if (!focusable.length) {
      event.preventDefault();
      this.host.nativeElement.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === this.host.nativeElement || !this.host.nativeElement.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || active === this.host.nativeElement || !this.host.nativeElement.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }
}
