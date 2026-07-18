import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { ApiErrorBody } from '../../services/api.models';
import { AuthService } from '../../services/auth.service';

type LoginView = 'sign-in' | 'request-reset' | 'reset-password';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent {
  view: LoginView = 'sign-in';
  email = '';
  password = '';
  resetEmail = '';
  resetToken = '';
  newPassword = '';
  confirmNewPassword = '';
  resetRequestMessage = '';
  hasDevelopmentResetToken = false;
  successMessage = '';
  isLoading = false;
  errorMessage = '';

  constructor(private readonly authService: AuthService, private readonly router: Router) {}

  onLogin(): void {
    this.errorMessage = '';
    this.successMessage = '';
    this.isLoading = true;

    this.authService.login({
      email: this.email,
      password: this.password,
    }).pipe(finalize(() => this.isLoading = false))
      .subscribe({
        next: () => this.router.navigate(['/home']),
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to sign in. Check the backend and try again.';
        },
      });
  }

  showResetRequest(): void {
    this.resetEmail = this.email.trim();
    this.view = 'request-reset';
    this.clearMessages();
  }

  onRequestPasswordReset(): void {
    this.errorMessage = '';
    this.resetRequestMessage = '';
    this.isLoading = true;

    // The request response is generic; account existence is never confirmed by the UI.
    this.authService.requestPasswordReset({ email: this.resetEmail })
      .pipe(finalize(() => this.isLoading = false))
      .subscribe({
        next: (response) => {
          this.resetRequestMessage = response.message;
          // Development returns a local token, while Production omits this field entirely.
          this.hasDevelopmentResetToken = Boolean(response.developmentToken);
          this.resetToken = response.developmentToken ?? '';
          this.view = 'reset-password';
        },
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to request a password reset. Please try again.';
        },
      });
  }

  onResetPassword(): void {
    this.errorMessage = '';

    if (this.newPassword.length < 8) {
      this.errorMessage = 'New password must be at least 8 characters.';
      return;
    }

    if (this.newPassword !== this.confirmNewPassword) {
      this.errorMessage = 'New passwords do not match.';
      return;
    }

    this.isLoading = true;
    this.authService.resetPassword({
      email: this.resetEmail,
      token: this.resetToken,
      newPassword: this.newPassword,
    }).pipe(finalize(() => this.isLoading = false))
      .subscribe({
        next: () => {
          this.email = this.resetEmail;
          this.password = '';
          this.resetToken = '';
          this.newPassword = '';
          this.confirmNewPassword = '';
          this.resetRequestMessage = '';
          this.hasDevelopmentResetToken = false;
          this.errorMessage = '';
          this.successMessage = 'Your password has been reset. Sign in with your new password.';
          this.view = 'sign-in';
        },
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to reset the password. Please try again.';
        },
      });
  }

  backToSignIn(): void {
    this.view = 'sign-in';
    this.resetToken = '';
    this.newPassword = '';
    this.confirmNewPassword = '';
    this.resetRequestMessage = '';
    this.hasDevelopmentResetToken = false;
    this.clearMessages();
  }

  backToResetRequest(): void {
    this.view = 'request-reset';
    this.resetToken = '';
    this.newPassword = '';
    this.confirmNewPassword = '';
    this.resetRequestMessage = '';
    this.hasDevelopmentResetToken = false;
    this.clearMessages();
  }

  private clearMessages(): void {
    this.errorMessage = '';
    this.successMessage = '';
  }
}
