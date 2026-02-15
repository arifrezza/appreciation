import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { LanguageService, QualityResponse } from '../services/language.service';

/**
 * Rule status types
 */
type RuleStatus = 'neutral' | 'success' | 'error';

@Component({
  selector: 'app-appreciation-editor-modal',
  templateUrl: './appreciation-editor-modal.component.html',
  styleUrls: ['./appreciation-editor-modal.component.css']
})
export class AppreciationEditorModalComponent implements AfterViewInit {

    @ViewChild('mainTextarea') mainTextarea!: ElementRef<HTMLTextAreaElement>;

    constructor(private languageService: LanguageService) {}

    ngAfterViewInit(): void {
      setTimeout(() => {
        this.mainTextarea?.nativeElement?.focus();
      }, 300);
    }
  @Input() employeeName!: string;
  @Output() closed = new EventEmitter<void>();
  @Output() back = new EventEmitter<void>();

  userText: string = '';
  aiText: string = '';
  showAiSuggestion: boolean = false;

  // 🔥 Circular score (starts at 0)
  score: number = 0;
  isCheckingLanguage: boolean = false;

  // 🤖 AI Coaching
  aiGuidance: string = '';
  guidanceType: 'question' | 'suggestion' | 'none' | '' = '';

  radius = 34;
  circumference = 2 * Math.PI * this.radius;
  dashOffset = this.circumference;



  // 🔒 Internal flags
  private hasStartedTyping = false;
  private typingTimer: any = null;
  private readonly TYPING_DELAY = 800; // 800ms for faster response
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

    // Track that typing has started
    if (!this.hasStartedTyping) {
      this.hasStartedTyping = true;
    }

    // 🔁 ALWAYS clear previous timer
    if (this.typingTimer !== null) {
      clearTimeout(this.typingTimer);
      this.typingTimer = null;
    }

    // ⏱ ALWAYS schedule a fresh check
    this.typingTimer = setTimeout(() => {
      this.isCheckingLanguage = true; // 🔴 START CHECKING
      this.runChecksInParallel(this.userText.trim());
    }, this.TYPING_DELAY);


    // AI suggestion is now controlled by quality check (score >= 70%)
    // No longer based on character count
  }


  /**
   * Run language check and quality check in PARALLEL for faster response
   */
  private runChecksInParallel(text: string): void {
    const languageRule = this.guideItems.find(
      item => item.label === 'Language Check'
    );

    if (!languageRule) return;

    languageRule.status = 'neutral';

    let abusiveResult: boolean | null = null;
    let qualityResult: QualityResponse | null = null;
    let languageCheckDone = false;
    let qualityCheckDone = false;

    // Helper to process results when both are ready
    const processResults = () => {
      if (!languageCheckDone) return;

      // If abusive, ignore quality results and show error
      if (abusiveResult) {
        languageRule.status = 'error';
        this.isCheckingLanguage = false;
        return;
      }

      // Language is clean
      languageRule.status = 'success';

      // Wait for quality check if not done yet
      if (!qualityCheckDone) return;

      this.isCheckingLanguage = false;

      if (qualityResult && qualityResult.success) {
        this.guidanceType = qualityResult.guidanceType;
        this.aiGuidance = qualityResult.guidance;

        // Always show actual criterion pass/fail states
        this.updateGuideItemsWithDelay([
          { label: 'Be specific', pass: qualityResult.quality.beSpecific.pass },
          { label: 'Highlight impact', pass: qualityResult.quality.highlightImpact.pass },
          { label: 'Acknowledge effort', pass: qualityResult.quality.acknowledgeEffort.pass },
          { label: 'Reinforce consistency', pass: qualityResult.quality.reinforceConsistency.pass }
        ]);

        if (qualityResult.guidanceType === 'none') {
          // All 4 criteria pass - show congratulation
          this.animateScore(qualityResult.overallScore);
          this.showAiSuggestion = false;
          this.aiGuidance = this.getRandomCongratulation();
          this.guidanceType = 'suggestion'; // Show congratulations label
        } else if (qualityResult.guidanceType === 'suggestion') {
          // Not perfect - show actual pass/fail for each criterion
          // Remaining checkmarks turn green only when user clicks "Use Suggestion Text"
          this.updateGuideItemsWithDelay([
            { label: 'Be specific', pass: qualityResult.quality.beSpecific.pass },
            { label: 'Highlight impact', pass: qualityResult.quality.highlightImpact.pass },
            { label: 'Acknowledge effort', pass: qualityResult.quality.acknowledgeEffort.pass },
            { label: 'Reinforce consistency', pass: qualityResult.quality.reinforceConsistency.pass }
          ]);
          this.animateScore(qualityResult.overallScore);
          this.showAiSuggestion = true;
          this.aiText = qualityResult.guidance;
          this.aiGuidance = qualityResult.guidance;
        } else {
          // 0-1 criteria pass - show coaching tip
          this.animateScore(qualityResult.overallScore);
          this.showAiSuggestion = false;
        }
      }
    };

    // 🚀 API CALL 1: Language/Abusive check
    this.languageService.checkLanguage(text).subscribe({
      next: (res) => {
        abusiveResult = res.abusive;
        languageCheckDone = true;
        processResults();
      },
      error: () => {
        languageRule.status = 'neutral';
        abusiveResult = false; // Fail-safe: allow on error
        languageCheckDone = true;
        processResults();
      }
    });

    // 🚀 API CALL 2: Quality check (runs in parallel)
    this.languageService.checkQuality(text).subscribe({
      next: (res: QualityResponse) => {
        qualityResult = res;
        qualityCheckDone = true;
        processResults();
      },
      error: () => {
        qualityCheckDone = true;
        processResults();
      }
    });
  }

  /**
   * Helper to update a guide item's status
   */
  private updateGuideItem(label: string, pass: boolean): void {
    const item = this.guideItems.find(i => i.label === label);
    if (item) {
      item.status = pass ? 'success' : 'error';
    }
  }

  /**
   * Update multiple guide items with staggered delays for smooth transition
   */
  private updateGuideItemsWithDelay(updates: Array<{ label: string, pass: boolean }>): void {
    updates.forEach((update, index) => {
      setTimeout(() => {
        this.updateGuideItem(update.label, update.pass);
      }, index * 100); // 100ms delay between each update
    });
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

  // Demo popup
  alert("🙏 Appreciation posted successfully!");

  // Reset editor (blank text field + reset state)
  this.resetToInitialState();

  // IMPORTANT:
  // DO NOT call this.close()
  // because we want to stay in the editor modal
}




  /**
   * Use AI suggested text
   */
  useAiText(): void {
    this.userText = this.aiText;
    this.showAiSuggestion = false;

    // Mark all guide items as success since AI suggestion covers all criteria
    this.updateGuideItemsWithDelay([
      { label: 'Be specific', pass: true },
      { label: 'Highlight impact', pass: true },
      { label: 'Acknowledge effort', pass: true },
      { label: 'Reinforce consistency', pass: true }
    ]);
    this.animateScore(100);
    this.aiGuidance = this.getRandomCongratulation();
    this.guidanceType = 'suggestion';

    // Focus on textarea after pasting
    setTimeout(() => {
      this.mainTextarea?.nativeElement?.focus();
    }, 100);
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
    this.isCheckingLanguage = false;
    this.aiGuidance = '';
    this.guidanceType = '';
    this.updateProgress(0);



    this.guideItems.forEach(item => {
      item.status = 'neutral';
    });

    if (this.typingTimer) {
      clearTimeout(this.typingTimer);
      this.typingTimer = null;
    }
  }

get scoreClass(): string {
  if (this.score < 40) return 'low';
  if (this.score < 70) return 'medium';
  return 'high';
}

private animateScore(target: number): void {
  const interval = setInterval(() => {
    if (this.score < target) {
      this.score++;
      this.updateProgress(this.score);
    } else if (this.score > target) {
      this.score--;
      this.updateProgress(this.score);
    } else {
      clearInterval(interval);
    }
  }, 25); // Changed from 10ms to 25ms for smoother, slower animation
}


private updateProgress(score: number): void {
  const percent = score / 100;
  this.dashOffset = this.circumference * (1 - percent);
}

/**
 * Format guidance text: make words after "Consider phrases such as:" bold and cyan
 */
formatGuidance(text: string): string {
  if (!text) return '';

  const marker = 'Consider phrases such as:';
  const index = text.indexOf(marker);

  if (index === -1) return text;

  const before = text.substring(0, index);
  const after = text.substring(index + marker.length);

  return `${before}<br><br><span class="try-using">${marker}</span><span class="word-suggestions">${after}</span>`;
}

/**
 * Get a random congratulation message
 */
private getRandomCongratulation(): string {
  const messages = [
    'Your message is perfect!',
    'Great job on your appreciation!',
    'Well written message!',
    'Your recognition is spot on!',
    'Excellent appreciation!'
  ];
  return messages[Math.floor(Math.random() * messages.length)];
}

/**
 * Get a random encouragement message for when suggestion is available
 */
private getRandomEncouragement(): string {
  const messages = [
    'Good progress! Use the suggestion below to strengthen your message.',
    'You are on the right track! Try the enhanced version below.',
    'Almost there! The suggestion below covers all criteria.',
    'Nice work so far! See the improved version below.'
  ];
  return messages[Math.floor(Math.random() * messages.length)];
}

}
