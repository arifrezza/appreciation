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
  showModal = false;           // "Who to appreciate" modal (shown after login)
  showEditorModal = false;     // "Write appreciation" modal (shown after user picks someone)
  selectedEmployeeName = '';   // Passed to editor modal so it can show "You are now appreciating {{ name }}"
  errorMessage = '';
  isLoading = false;

  constructor(private authService: AuthService) {}

  login(): void {
    if (!this.email || !this.password) {
      this.errorMessage = 'Please enter both email and password';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    // Email and password will be sent to backend for authentication.
    // If successful, the modal will be shown. Otherwise, an error message will be displayed.
    this.authService.login(this.email, this.password).subscribe({
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

  /** Called when user selects an employee and clicks "Next" in the appreciation modal. */
  onProceedWithEmployee(employee: { id: number; name: string }): void {
    this.selectedEmployeeName = employee.name;
    this.showModal = false;       // Hide "Who to appreciate" modal
    this.showEditorModal = true;  // Show "Write appreciation" modal with this employee's name
  }

  /** Called when user closes the appreciation editor modal (e.g. via ✕). */
  closeEditorModal(): void {
    this.showEditorModal = false;
  }

  // MODIFY: Called when user clicks back arrow in editor modal; returns to employee selection modal
  // FIX: Set showModal first, then hide editor modal to prevent login form from briefly appearing
  goBackToSelection(): void {
    this.showModal = true;         // Show employee selection modal first
    this.showEditorModal = false;  // Then hide editor modal (prevents login form flash)
    // Note: selectedEmployeeName is kept, so if needed later, you know who was previously selected
  }
}
