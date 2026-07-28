import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { DialogFocusTrapDirective } from './dialog-focus-trap.directive';

@Component({
  standalone: true,
  imports: [DialogFocusTrapDirective],
  template: `
    <section id="dialog" tabindex="-1" [appDialogFocusTrap]="trapEnabled">
      <button id="first" [disabled]="controlsDisabled">First</button>
      <button id="last" [disabled]="controlsDisabled">Last</button>
      @if (showInheritedDisabled) {
        <fieldset disabled><button id="inherited">Inherited disabled</button></fieldset>
      }
    </section>
  `,
})
class FocusTrapHostComponent {
  trapEnabled = true;
  controlsDisabled = false;
  showInheritedDisabled = false;
}

describe('DialogFocusTrapDirective', () => {
  it('cycles Tab from the last action back to the first action', async () => {
    const fixture = TestBed.createComponent(FocusTrapHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const first = fixture.nativeElement.querySelector('#first') as HTMLButtonElement;
    const last = fixture.nativeElement.querySelector('#last') as HTMLButtonElement;

    last.focus();
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));

    expect(document.activeElement).toBe(first);
  });

  it('cycles Shift+Tab from the first action back to the last action', async () => {
    const fixture = TestBed.createComponent(FocusTrapHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const first = fixture.nativeElement.querySelector('#first') as HTMLButtonElement;
    const last = fixture.nativeElement.querySelector('#last') as HTMLButtonElement;

    first.focus();
    first.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }));

    expect(document.activeElement).toBe(last);
  });

  it('does not cycle focus when the trap is disabled', async () => {
    const fixture = TestBed.createComponent(FocusTrapHostComponent);
    fixture.componentInstance.trapEnabled = false;
    fixture.detectChanges();
    await fixture.whenStable();
    const first = fixture.nativeElement.querySelector('#first') as HTMLButtonElement;
    const last = fixture.nativeElement.querySelector('#last') as HTMLButtonElement;

    last.focus();
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));

    expect(document.activeElement).toBe(last);
    expect(document.activeElement).not.toBe(first);
  });

  it('moves focus from the dialog container to an action in either tab direction', async () => {
    const fixture = TestBed.createComponent(FocusTrapHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const dialog = fixture.nativeElement.querySelector('#dialog') as HTMLElement;
    const first = fixture.nativeElement.querySelector('#first') as HTMLButtonElement;
    const last = fixture.nativeElement.querySelector('#last') as HTMLButtonElement;

    dialog.focus();
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(first);

    dialog.focus();
    dialog.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }));
    expect(document.activeElement).toBe(last);
  });

  it('recovers focus to the dialog host when every action is disabled', async () => {
    const fixture = TestBed.createComponent(FocusTrapHostComponent);
    fixture.componentInstance.controlsDisabled = true;
    fixture.detectChanges();
    await fixture.whenStable();
    const dialog = fixture.nativeElement.querySelector('#dialog') as HTMLElement;
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();

    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    }));

    expect(dialog.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(dialog);
    outside.remove();
  });

  it('excludes controls disabled by an ancestor fieldset', async () => {
    const fixture = TestBed.createComponent(FocusTrapHostComponent);
    fixture.componentInstance.controlsDisabled = true;
    fixture.componentInstance.showInheritedDisabled = true;
    fixture.detectChanges();
    await fixture.whenStable();
    const dialog = fixture.nativeElement.querySelector('#dialog') as HTMLElement;
    const inherited = fixture.nativeElement.querySelector('#inherited') as HTMLButtonElement;
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();

    expect(inherited.hasAttribute('disabled')).toBe(false);
    expect(inherited.matches(':disabled')).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    }));

    expect(document.activeElement).toBe(dialog);
    outside.remove();
  });
});
