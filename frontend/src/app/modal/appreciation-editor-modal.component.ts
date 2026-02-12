import { Component, Input, Output, EventEmitter } from '@angular/core';
import { LanguageService } from '../services/language.service';

/**
 * Rule status types
 */
type RuleStatus = 'neutral' | 'success' | 'error';

@Component({
  selector: 'app-appreciation-editor-modal',
  templateUrl: './appreciation-editor-modal.component.html',
  styleUrls: ['./appreciation-editor-modal.component.css']
})
export class AppreciationEditorModalComponent {

    constructor(private languageService: LanguageService) {}
  @Input() employeeName!: string;
  @Output() closed = new EventEmitter<void>();
  @Output() back = new EventEmitter<void>();

  userText: string = '';
  aiText: string = '';
  showAiSuggestion: boolean = false;

  // 🔥 Circular score (starts at 0)
  score: number = 0;

  // 🔒 Internal flags
  private hasStartedTyping = false;
  private typingTimer: any = null;
  private readonly TYPING_DELAY = 2000; // 2 seconds
  private lastGeneratedFor: string = '';

  /**
   * Local abusive words list
   * (Later will come from backend file / API)
   */
  /* private abusiveWords: string[] = [
    'idiot',
    'stupid',
    'useless',
    'nonsense'
   ];*/

  /**
   * Right-side guide items
   */
  guideItems = [
    { label: 'Language Check', status: 'neutral' as RuleStatus },
    { label: 'Be specific', status: 'neutral' as RuleStatus },
    { label: 'Highlight impact', status: 'neutral' as RuleStatus },
    { label: 'Acknowledge effort', status: 'neutral' as RuleStatus },
    { label: 'Reinforce consistency', status: 'neutral' as RuleStatus }
  ];

  /**
   * Triggered on every keystroke
   */
  onTextChange(): void {
    const text = this.userText.trim();

    // 🔴 Case 1: All text removed
    if (text.length === 0) {
      this.resetToInitialState();
      return;
    }

    // 🟢 First typing → bump score once
    if (!this.hasStartedTyping) {
      this.hasStartedTyping = true;
      this.score = 5;
    }

    // 🔁 ALWAYS clear previous timer
    if (this.typingTimer !== null) {
      clearTimeout(this.typingTimer);
      this.typingTimer = null;
    }

    // ⏱ ALWAYS schedule a fresh check
    this.typingTimer = setTimeout(() => {
      // IMPORTANT: use latest text, not stale copy
      this.runLocalLanguageCheck(this.userText.trim());
    }, this.TYPING_DELAY);

    // AI suggestion logic (unchanged)
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


  /**
   * Local abusive language check
   */
  private runLocalLanguageCheck(text: string): void {
    const languageRule = this.guideItems.find(
      item => item.label === 'Language Check'
    );

    if (!languageRule) return;

    languageRule.status = 'neutral';

    this.languageService.checkLanguage(text).subscribe({
      next: (res) => {
        languageRule.status = res.abusive ? 'error' : 'success';
      },
      error: () => {
        // Fail-safe: don't block user on API error
        languageRule.status = 'neutral';
      }
    });

    // TODO (AI INTEGRATION):
    // Combine AI moderation result here
  }

canSubmit(): boolean {
  const languageRule = this.guideItems.find(
    item => item.label === 'Language Check'
  );

  return (
    languageRule?.status === 'success' &&
    this.userText.trim().length > 0
  );
}

postAppreciation(): void {
  const payload = {
    employeeName: this.employeeName,
    appreciationText: this.userText
  };

  console.log('POST appreciation payload:', payload);

  // TODO:
  // 1. Call backend POST /api/appreciation
  // 2. Handle success (toast + close modal)
  // 3. Handle error (show error message)

  this.close();
}



  /**
   * Use AI suggested text
   */
  useAiText(): void {
    this.userText = this.aiText;
  }

  /**
   * Placeholder for AI rewrite
   */
  rewriteWithAI(): void {
    // TODO: Call backend AI rewrite API
  }

  /**
   * Close modal
   */
  close(): void {
    this.resetToInitialState();
    this.closed.emit();
  }

  /**
   * Go back to employee selection
   */
  goBack(): void {
    this.resetToInitialState();
    this.back.emit();
  }

  /**
   * Reset editor to initial neutral state
   */
  private resetToInitialState(): void {
    this.userText = '';
    this.aiText = '';
    this.showAiSuggestion = false;
    this.score = 0;
    this.hasStartedTyping = false;
    this.lastGeneratedFor = '';

    this.guideItems.forEach(item => {
      item.status = 'neutral';
    });

    if (this.typingTimer) {
      clearTimeout(this.typingTimer);
      this.typingTimer = null;
    }
  }
}
