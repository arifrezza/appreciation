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
  @Output() proceedWithEmployee = new EventEmitter<{ employees: { id: number; name: string }[] }>();

  @Input() currentUserId!: number;

  employees: Employee[] = [];
  selectedEmployeeIds: Set<number> = new Set();

  get selectedCount(): number { return this.selectedEmployeeIds.size; }

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
    if (this.selectedEmployeeIds.has(employeeId)) {
      this.selectedEmployeeIds.delete(employeeId);
    } else {
      this.selectedEmployeeIds.add(employeeId);
    }
    this.selectedEmployeeIds = new Set(this.selectedEmployeeIds);
  }

  proceed(): void {
    if (this.selectedEmployeeIds.size === 0) return;

    const selected = this.employees.filter(e => this.selectedEmployeeIds.has(e.id));
    this.proceedWithEmployee.emit({ employees: selected.map(e => ({ id: e.id, name: e.name })) });

    this.closeModal();
  }

  closeModal(): void {
    this.close.emit();
  }
}
