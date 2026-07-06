import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { ApiErrorBody } from '../../services/api.models';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-signup',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './signup.component.html',
  styleUrl: './signup.component.css',
})
export class SignupComponent {
  fullName = '';
  email = '';
  password = '';
  confirmPassword = '';
  isLoading = false;
  errorMessage = '';

  constructor(private authService: AuthService, private router: Router) {}

  onRegister(): void {
    this.errorMessage = '';

    if (this.password !== this.confirmPassword) {
      this.errorMessage = 'Passwords do not match.';
      return;
    }

    const [firstName, ...lastNameParts] = this.fullName.trim().split(/\s+/);
    const lastName = lastNameParts.join(' ') || '-';
    this.isLoading = true;

    this.authService.register({
      firstName,
      lastName,
      email: this.email,
      password: this.password,
    }).pipe(finalize(() => this.isLoading = false))
      .subscribe({
        next: () => this.router.navigate(['/projects']),
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to register. Check the backend and try again.';
        },
      });
  }
}
