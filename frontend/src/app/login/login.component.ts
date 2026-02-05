import { Component } from '@angular/core';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent {
  username = '';
  password = '';
  showModal = false;
  errorMessage = '';
  isLoading = false;

  constructor(private authService: AuthService) {}

  login(): void {
    if (!this.username || !this.password) {
      this.errorMessage = 'Please enter both username and password';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

//Username and password will be sent to backedend for authentication. If successful, the modal will be shown.
 //Otherwise, an error message will be displayed.
    this.authService.login(this.username, this.password).subscribe({
      next: (response) => {
        this.isLoading = false;
        if (response.success) {
          this.showModal = true;
        } else {
          this.errorMessage = response.message || 'Login failed';
        }
      },
      error: (error) => {
        this.isLoading = false;
        this.errorMessage = 'Invalid credentials. Please try again.';
        console.error('Login error:', error);
      }
    });
  }

  closeModal(): void {
    this.showModal = false;
  }
}
