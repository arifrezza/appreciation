import { Component } from '@angular/core';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent {

  email = '';
  password = '';

  showModal = false;           // "Who to appreciate" modal
  showEditorModal = false;     // "Write appreciation" modal

  selectedEmployeeName = '';   // Passed to editor modal
  errorMessage = '';
  isLoading = false;

  // 🔥 IMPORTANT: Store logged-in user
  loggedInUser: any = null;

  constructor(private authService: AuthService) {}

  login(): void {

    if (!this.email || !this.password) {
      this.errorMessage = 'Please enter both email and password';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    this.authService.login(this.email, this.password).subscribe({
      next: (response) => {
        this.isLoading = false;

        if (response.success && response.user) {

          // 🔥 STORE LOGGED-IN USER
          this.loggedInUser = response.user;

          // 🔥 OPEN EMPLOYEE SELECTION MODAL
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

  /**
   * Called when user selects an employee and clicks "Next"
   */
  onProceedWithEmployee(employee: { id: number; name: string }): void {
    this.selectedEmployeeName = employee.name;

    // Hide employee selection modal
    this.showModal = false;

    // Show appreciation editor modal
    this.showEditorModal = true;
  }

  /**
   * Called when user closes the appreciation editor modal
   */
  closeEditorModal(): void {
    this.showEditorModal = false;
  }

  /**
   * Called when user clicks back arrow in editor modal
   * Prevent login form flash by showing modal first
   */
  goBackToSelection(): void {
    this.showModal = true;
    this.showEditorModal = false;
  }
}
