import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../services/auth.service';
import { LoginComponent } from './login.component';

describe('LoginComponent', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let auth: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    auth = {
      login: vi.fn(() => of(undefined)),
      requestPasswordReset: vi.fn(() => of({ message: 'If the account exists, reset instructions were created.', developmentToken: 'dev-token' })),
      resetPassword: vi.fn(() => of(undefined)),
    };
    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [provideRouter([]), { provide: AuthService, useValue: auth }],
    }).compileComponents();
    fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('redirects a successful login to Home', () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture.componentInstance.email = 'mona@example.com';
    fixture.componentInstance.password = 'password1';
    fixture.componentInstance.onLogin();
    expect(auth['login']).toHaveBeenCalledWith({ email: 'mona@example.com', password: 'password1' });
    expect(navigate).toHaveBeenCalledWith(['/home']);
  });

  it('requests a backend reset and exposes a development token only from the response', () => {
    fixture.componentInstance.showResetRequest();
    fixture.componentInstance.resetEmail = 'mona@example.com';
    fixture.componentInstance.onRequestPasswordReset();
    expect(auth['requestPasswordReset']).toHaveBeenCalledWith({ email: 'mona@example.com' });
    expect(fixture.componentInstance.view).toBe('reset-password');
    expect(fixture.componentInstance.hasDevelopmentResetToken).toBe(true);
    expect(fixture.componentInstance.resetToken).toBe('dev-token');
  });

  it('validates reset password length and confirmation before calling the API', () => {
    fixture.componentInstance.resetEmail = 'mona@example.com';
    fixture.componentInstance.resetToken = 'token';
    fixture.componentInstance.newPassword = 'short';
    fixture.componentInstance.confirmNewPassword = 'different';
    fixture.componentInstance.onResetPassword();
    expect(fixture.componentInstance.errorMessage).toContain('at least 8');
    expect(auth['resetPassword']).not.toHaveBeenCalled();

    fixture.componentInstance.newPassword = 'password1';
    fixture.componentInstance.confirmNewPassword = 'password2';
    fixture.componentInstance.onResetPassword();
    expect(fixture.componentInstance.errorMessage).toContain('do not match');
    expect(auth['resetPassword']).not.toHaveBeenCalled();
  });
});
