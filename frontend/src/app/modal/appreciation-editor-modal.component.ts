import { Component, Input, Output, EventEmitter } from '@angular/core';

@Component({
  selector: 'app-appreciation-editor-modal',
  templateUrl: './appreciation-editor-modal.component.html',
  styleUrls: ['./appreciation-editor-modal.component.css']
})
export class AppreciationEditorModalComponent {

  @Input() employeeName!: string;
  @Output() closed = new EventEmitter<void>();

  userText: string = '';
  aiText: string = '';
  showAiSuggestion: boolean = false;
  score: number = 55;

  guideItems = [
    { label: 'Language Check', status: 'error' },
    { label: 'Be specific', status: 'success' },
    { label: 'Highlight impact', status: 'success' },
    { label: 'Acknowledge effort', status: 'success' },
    { label: 'Reinforce consistency', status: 'success' }
  ];

  private lastGeneratedFor: string = '';

  onTextChange(): void {
    const text = this.userText.trim();

    if (text.length >= 20) {
      this.showAiSuggestion = true;

      if (text !== this.lastGeneratedFor) {
        this.aiText =
          'Thank you for your dedication and commitment. Your timely delivery and consistent effort have made a meaningful impact on the team, and your contribution is sincerely appreciated.';
        this.lastGeneratedFor = text;
      }
    } else {
      this.showAiSuggestion = false;
      this.lastGeneratedFor = '';
    }
  }

  rewriteWithAI(): void {
    // Later: call backend AI rewrite API
  }

  useAiText(): void {
    this.userText = this.aiText;
  }

  close(): void {
    this.closed.emit();
  }
}
