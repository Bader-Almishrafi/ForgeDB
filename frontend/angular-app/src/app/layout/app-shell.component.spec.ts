import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthUser } from '../services/api.models';
import { AuthService } from '../services/auth.service';
import { ProjectWorkflowContextService } from '../services/project-workflow-context.service';
import { ThemeService } from '../services/theme.service';
import { AppShellComponent } from './app-shell.component';

const user: AuthUser = {
  id: 4,
  firstName: 'Mona',
  lastName: 'Ali',
  email: 'mona@example.com',
  role: 'User',
  createdAt: '2026-01-01T00:00:00Z',
};

@Component({ standalone: true, template: '<h1>Test destination</h1>' })
class TestDestinationComponent {}

describe('AppShellComponent responsive navigation accessibility', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });

  it('keeps the closed mobile drawer hidden and inert', async () => {
    const fixture = await setup(false);
    const sidebar = fixture.nativeElement.querySelector('[data-testid="app-sidebar"]') as HTMLElement;

    expect(fixture.componentInstance.desktopNavigation()).toBe(false);
    expect(fixture.componentInstance.sidebarOpen()).toBe(false);
    expect(sidebar.getAttribute('aria-hidden')).toBe('true');
    expect(sidebar.hasAttribute('inert')).toBe(true);
    expect(sidebar.getAttribute('role')).toBeNull();
    expect(sidebar.getAttribute('aria-modal')).toBeNull();
  });

  it('focuses the mobile drawer on open and restores trigger focus with Escape', async () => {
    const fixture = await setup(false);
    const trigger = fixture.nativeElement.querySelector('[aria-label="Open navigation"]') as HTMLButtonElement;
    const sidebar = fixture.nativeElement.querySelector('[data-testid="app-sidebar"]') as HTMLElement;

    trigger.focus();
    trigger.click();
    fixture.detectChanges();
    await flushFocus();

    const closeButton = sidebar.querySelector('[aria-label="Close navigation"]') as HTMLButtonElement;
    expect(fixture.componentInstance.sidebarOpen()).toBe(true);
    expect(sidebar.hasAttribute('inert')).toBe(false);
    expect(sidebar.getAttribute('aria-hidden')).toBeNull();
    expect(sidebar.getAttribute('role')).toBe('dialog');
    expect(sidebar.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(closeButton);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    await flushFocus();

    expect(fixture.componentInstance.sidebarOpen()).toBe(false);
    expect(sidebar.hasAttribute('inert')).toBe(true);
    expect(sidebar.getAttribute('aria-hidden')).toBe('true');
    expect(document.activeElement).toBe(trigger);
  });

  it('never marks the desktop navigation inert or aria-hidden', async () => {
    const fixture = await setup(true);
    const sidebar = fixture.nativeElement.querySelector('[data-testid="app-sidebar"]') as HTMLElement;

    expect(fixture.componentInstance.desktopNavigation()).toBe(true);
    expect(fixture.componentInstance.sidebarOpen()).toBe(false);
    expect(sidebar.hasAttribute('inert')).toBe(false);
    expect(sidebar.getAttribute('aria-hidden')).toBeNull();
    expect(sidebar.getAttribute('role')).toBeNull();
    expect(sidebar.getAttribute('aria-modal')).toBeNull();
  });

  it('keeps mobile link focus valid until navigation ends, then focuses main content', async () => {
    const fixture = await setup(false);
    const component = fixture.componentInstance;
    const sidebar = fixture.nativeElement.querySelector('[data-testid="app-sidebar"]') as HTMLElement;
    const main = fixture.nativeElement.querySelector('#main-content') as HTMLElement;
    component.currentUrl.set('/home');
    component.toggleSidebar();
    fixture.detectChanges();
    await flushFocus();
    const projectsLink = Array.from(sidebar.querySelectorAll('a'))
      .find((link) => link.textContent?.includes('Projects')) as HTMLAnchorElement;
    projectsLink.focus();

    component.prepareNavigation('/projects');
    fixture.detectChanges();

    expect(component.sidebarOpen()).toBe(true);
    expect(sidebar.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(projectsLink);

    await TestBed.inject(Router).navigateByUrl('/projects');
    fixture.detectChanges();
    await flushFocus();

    expect(component.sidebarOpen()).toBe(false);
    expect(sidebar.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(main);
  });

  it('keeps a focused mobile account link mounted until its navigation ends', async () => {
    const fixture = await setup(false);
    const component = fixture.componentInstance;
    const main = fixture.nativeElement.querySelector('#main-content') as HTMLElement;
    component.currentUrl.set('/home');
    component.toggleSidebar();
    component.userMenuOpen.set(true);
    fixture.detectChanges();
    const accountLink = fixture.nativeElement.querySelector('#account-menu a') as HTMLAnchorElement;
    accountLink.focus();

    component.prepareNavigation('/change-password');
    fixture.detectChanges();

    expect(component.sidebarOpen()).toBe(true);
    expect(component.userMenuOpen()).toBe(true);
    expect(document.activeElement).toBe(accountLink);

    await TestBed.inject(Router).navigateByUrl('/change-password');
    fixture.detectChanges();
    await flushFocus();

    expect(component.sidebarOpen()).toBe(false);
    expect(component.userMenuOpen()).toBe(false);
    expect(document.activeElement).toBe(main);
  });

  it('clears project workflow context when the authenticated session ends', async () => {
    const fixture = await setup(true);
    const context = TestBed.inject(ProjectWorkflowContextService) as unknown as { clear: ReturnType<typeof vi.fn> };

    fixture.componentInstance.logout();

    expect(context.clear).toHaveBeenCalled();
  });

  async function setup(desktop: boolean): Promise<ComponentFixture<AppShellComponent>> {
    const mediaQuery = {
      matches: desktop,
      media: '(min-width: 1024px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    } as unknown as MediaQueryList;
    vi.stubGlobal('matchMedia', vi.fn(() => mediaQuery));

    await TestBed.configureTestingModule({
      imports: [AppShellComponent],
      providers: [
        provideRouter([
          { path: 'home', component: TestDestinationComponent },
          { path: 'projects', component: TestDestinationComponent },
          { path: 'change-password', component: TestDestinationComponent },
        ]),
        {
          provide: AuthService,
          useValue: {
            user: signal(user).asReadonly(),
            logout: vi.fn(),
          },
        },
        {
          provide: ThemeService,
          useValue: {
            theme: signal<'light' | 'dark'>('light').asReadonly(),
            toggle: vi.fn(),
          },
        },
        {
          provide: ProjectWorkflowContextService,
          useValue: { clear: vi.fn() },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();
    return fixture;
  }

  async function flushFocus(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
});
