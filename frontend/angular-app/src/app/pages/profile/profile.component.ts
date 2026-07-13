import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './profile.component.html',
})
export class ProfileComponent implements OnInit {
  private auth = inject(AuthService);
  
  user = {
    firstName: '',
    lastName: '',
    email: ''
  };

  ngOnInit() {
    const authUser = this.auth.user();
    if (authUser) {
      this.user = {
        firstName: authUser.firstName,
        lastName: authUser.lastName,
        email: authUser.email
      };
    }
  }
  
  successMessage = '';

  saveChanges() {
    this.successMessage = 'Your settings have been saved successfully!';
    setTimeout(() => {
      this.successMessage = '';
    }, 3000);
  }
}
