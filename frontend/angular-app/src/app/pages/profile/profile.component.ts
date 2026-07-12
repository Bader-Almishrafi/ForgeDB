import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './profile.component.html',
})
export class ProfileComponent {
  user = {
    firstName: 'Ahmed',
    lastName: 'Ali',
    email: 'ahmed@example.com'
  };
  
  successMessage = '';

  saveChanges() {
    this.successMessage = 'Your settings have been saved successfully!';
    setTimeout(() => {
      this.successMessage = '';
    }, 3000);
  }
}
