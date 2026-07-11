import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { ApiErrorBody } from '../../services/api.models';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent {
  email = '';
  password = '';
  forgotEmail = '';
  showForgotPasswordState = false;
  isLoading = false;
  errorMessage = '';

  constructor(private authService: AuthService, private router: Router) {}

  onLogin(): void {
    this.errorMessage = '';
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

  onResetPassword(): void {
    this.errorMessage = 'Password reset is not part of the local MVP flow.';
  }
}
