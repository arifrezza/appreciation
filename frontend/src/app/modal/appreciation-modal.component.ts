import { Component, EventEmitter, Output } from '@angular/core';

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
export class AppreciationModalComponent {
  @Output() close = new EventEmitter<void>();
  // Emitted when user clicks "Next" with a selected employee; parent (Login) uses this to open the editor modal
  @Output() proceedWithEmployee = new EventEmitter<{ id: number; name: string }>();

  // Mock employee list - replace with actual API call
  employees: Employee[] = [
    { id: 1, name: 'Sanjoy Debnath', alreadyAppreciated: false },
    { id: 2, name: 'Vishal Kumar Singh', alreadyAppreciated: false },
    { id: 3, name: 'Priya Sharma', alreadyAppreciated: true },
    { id: 4, name: 'Rahul Verma', alreadyAppreciated: false }
  ];

  selectedEmployeeId: number | null = null;

  selectEmployee(employeeId: number): void {
    this.selectedEmployeeId = employeeId;
  }

  proceed(): void {
    if (this.selectedEmployeeId) {
      const employee = this.employees.find(e => e.id === this.selectedEmployeeId);
      if (employee) {
        // Notify parent so it can show appreciation-editor-modal with this employee's name
        this.proceedWithEmployee.emit({ id: employee.id, name: employee.name });
      }
      this.closeModal();
    }
  }

  closeModal(): void {
    this.close.emit();
  }
}
