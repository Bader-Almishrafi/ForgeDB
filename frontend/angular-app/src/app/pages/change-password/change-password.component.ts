import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { ApiErrorBody } from '../../services/api.models';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-change-password',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './change-password.component.html',
  styleUrl: './change-password.component.css',
})
export class ChangePasswordComponent {
  currentPassword = '';
  newPassword = '';
  confirmPassword = '';

  isLoading = false;
  errorMessage = '';

  constructor(
    private readonly authService: AuthService,
    private readonly router: Router,
  ) {}

  onSubmit(): void {
    this.errorMessage = '';

    if (this.newPassword !== this.confirmPassword) {
      this.errorMessage = 'New passwords do not match.';
      return;
    }

    if (this.currentPassword === this.newPassword) {
      this.errorMessage =
        'New password must be different from the current password.';
      return;
    }

    this.isLoading = true;

    // The API derives the user from the interceptor-supplied JWT; no user ID is sent by this form.
    this.authService.changePassword({
      currentPassword: this.currentPassword,
      newPassword: this.newPassword,
    })
      .pipe(
        finalize(() => {
          this.isLoading = false;
        }),
      )
      .subscribe({
        next: () => {
          // A password change invalidates the local session and requires a fresh sign-in.
          this.authService.logout();
          void this.router.navigate(['/login']);
        },
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage =
            error.error?.message ??
            'Unable to change the password. Please try again.';
        },
      });
  }
}
