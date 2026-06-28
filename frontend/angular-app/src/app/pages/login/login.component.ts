import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

@Component({
	selector: 'app-login',
	standalone: true,
	imports: [FormsModule, RouterLink],
	templateUrl: './login.component.html',
	styleUrl: './login.component.css',
})
export class LoginComponent {
	email: string = '';
	password: string = '';
	forgotEmail: string = '';

	showForgotPasswordState: boolean = false;


	onLogin() {
		// Handle login logic here
		console.log('Email:', this.email);
		console.log('Password:', this.password);

	}
	onResetPassword() {
		console.log('Reset Link Sent to:', this.forgotEmail);
		alert('Reset link sent to your email!');
	}
}
