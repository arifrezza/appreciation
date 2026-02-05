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
      // Navigate to appreciation page or open next modal
      console.log('Selected employee ID:', this.selectedEmployeeId);
      // TODO: Navigate to appreciation text page
      alert(`Proceeding to appreciate employee ${this.selectedEmployeeId}`);
      this.closeModal();
    }
  }

  closeModal(): void {
    this.close.emit();
  }
}
