import {
  Component,
  EventEmitter,
  Output,
  Input,
  OnChanges,
  SimpleChanges
} from '@angular/core';
import { UserService } from '../services/user.service';

interface Employee {
  id: number;
  name: string;
  alreadyAppreciated?: boolean;
}

@Component({
  selector: 'app-appreciation-modal',
  templateUrl: './appreciation-modal.component.html',
  styleUrls: ['./appreciation-modal.component.css']
})
export class AppreciationModalComponent implements OnChanges {

  @Output() close = new EventEmitter<void>();
  @Output() proceedWithEmployee = new EventEmitter<{ id: number; name: string }>();

  @Input() currentUserId!: number;

  employees: Employee[] = [];
  selectedEmployeeId: number | null = null;

  constructor(private userService: UserService) {}

  // 🔥 THIS IS THE IMPORTANT PART
  ngOnChanges(changes: SimpleChanges): void {

    if (changes['currentUserId'] && this.currentUserId) {
      console.log('Calling users API with ID:', this.currentUserId);
      this.loadEmployees();
    }
  }

  loadEmployees(): void {

    this.userService.getUsers(this.currentUserId).subscribe({
      next: (response) => {

        console.log('Users API response:', response);

        if (response.success) {
          this.employees = response.users.map((u: any) => ({
            id: u.id,
            name: u.fullName || u.username,
            alreadyAppreciated: false
          }));
        }
      },
      error: (err) => {
        console.error('Error loading users:', err);
      }
    });
  }

  selectEmployee(employeeId: number): void {
    this.selectedEmployeeId = employeeId;
  }

  proceed(): void {
    if (!this.selectedEmployeeId) return;

    const employee = this.employees.find(e => e.id === this.selectedEmployeeId);

    if (employee) {
      this.proceedWithEmployee.emit({
        id: employee.id,
        name: employee.name
      });
    }

    this.closeModal();
  }

  closeModal(): void {
    this.close.emit();
  }
}
