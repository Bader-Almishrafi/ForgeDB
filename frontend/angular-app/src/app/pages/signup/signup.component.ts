import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';

@Component({
	selector: 'app-signup',
	imports: [RouterLink, FormsModule],
	templateUrl: './signup.component.html',
	styleUrl: './signup.component.css',
})
export class SignupComponent {
	fullName: string = '';
	email: string = '';
	password: string = '';
	confirmPassword: string = '';


	onRegister() {
		if (this.password !== this.confirmPassword) {
			alert('Error: Passwords do not match!');
			return;
		}

		console.log('Registration Data:', {
			name: this.fullName,
			email: this.email,
			password: this.password
		});

		alert('Registration successful! (Check Console)');
	}

}
