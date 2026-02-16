import {
  Component,
  Input,
  Output,
  EventEmitter,
  ViewChild,
  ElementRef,
  AfterViewInit,
  OnDestroy
} from '@angular/core';

import { LanguageService, QualityResponse } from '../services/language.service';
import { Subject, forkJoin } from 'rxjs';
import { debounceTime, filter, switchMap, takeUntil } from 'rxjs/operators';

type RuleStatus = 'neutral' | 'success' | 'error';

@Component({
  selector: 'app-appreciation-editor-modal',
  templateUrl: './appreciation-editor-modal.component.html',
  styleUrls: ['./appreciation-editor-modal.component.css']
})
export class AppreciationEditorModalComponent
  implements AfterViewInit, OnDestroy {

  @ViewChild('mainTextarea') mainTextarea!: ElementRef<HTMLTextAreaElement>;

  constructor(private languageService: LanguageService) {}

  /* =====================
     LIFECYCLE
  ====================== */

  ngAfterViewInit(): void {

    // focus textarea
    setTimeout(() => {
      this.mainTextarea?.nativeElement?.focus();
    }, 300);

    // ⭐ Reactive typing stream
    this.typingSubject
      .pipe(
        debounceTime(this.TYPING_DELAY),
        filter(text => text.length >= 2),

        switchMap(text => {

          // avoid flicker
          if (!this.isCheckingLanguage) {
            this.isCheckingLanguage = true;
          }

          return forkJoin({
            language: this.languageService.checkLanguage(text),
            quality: this.languageService.checkQuality(text)
          });
        }),

        takeUntil(this.destroy$)
      )
      .subscribe({
        next: ({ language, quality }) => {
          this.isCheckingLanguage = false;
          this.handleCombinedResults(language, quality);
        },
        error: () => {
          this.isCheckingLanguage = false;
        }
      });
  }

  ngOnDestroy(): void {
      console.log("DESTROY CALLED"); // 👈 add this
    this.destroy$.next();
    this.destroy$.complete();
  }

  /* =====================
     INPUT / OUTPUT
  ====================== */

  @Input() employeeName!: string;
  @Output() closed = new EventEmitter<void>();
  @Output() back = new EventEmitter<void>();

  /* =====================
     STATE
  ====================== */

  userText = '';
  aiText = '';
  showAiSuggestion = false;

  score = 0;
  isCheckingLanguage = false;

  aiGuidance = '';
  guidanceType: 'question' | 'suggestion' | 'none' | '' = '';

  radius = 34;
  circumference = 2 * Math.PI * this.radius;
  dashOffset = this.circumference;

  private hasStartedTyping = false;
  private readonly TYPING_DELAY = 1000;
  private lastGeneratedFor = '';
  private lastMeaningfulText = '';


  // ⭐ reactive streams
  private typingSubject = new Subject<string>();
  private destroy$ = new Subject<void>();

  /* =====================
     GUIDE ITEMS
  ====================== */

  private readonly weightageMap: Record<string, number> = {
    'Abusive Check': 10,
    'Be specific': 35,
    'Highlight impact': 30,
    'Acknowledge effort': 15,
    'Reinforce consistency': 10
  };

  guideItems = [
    { label: 'Abusive Check', status: 'neutral' as RuleStatus },
    { label: 'Be specific', status: 'neutral' as RuleStatus },
    { label: 'Highlight impact', status: 'neutral' as RuleStatus },
    { label: 'Acknowledge effort', status: 'neutral' as RuleStatus },
    { label: 'Reinforce consistency', status: 'neutral' as RuleStatus }
  ];

  /* =====================
     TEXT CHANGE
  ====================== */

  onTextChange(): void {

    const text = this.userText.trim();

    if (text.length === 0) {
      this.resetToInitialState();
      return;
    }

    if (!this.hasStartedTyping) {
      this.hasStartedTyping = true;
    }

const normalized = this.normalizeText(text);

  if (normalized === this.lastMeaningfulText) {
    return; // ❌ skip AI call
  }

  this.lastMeaningfulText = normalized;

    // ⭐ push to reactive stream
    this.typingSubject.next(text);
  }

  /* =====================
     RESULT PROCESSING
  ====================== */

  private handleCombinedResults(
    language: any,
    qualityResult: QualityResponse
  ): void {

    const languageRule = this.guideItems.find(
      item => item.label === 'Abusive Check'
    );

    if (!languageRule) return;

    // abusive check
    if (language.abusive) {
      languageRule.status = 'error';
      return;
    }

    languageRule.status = 'success';

    if (!qualityResult || !qualityResult.success) return;

    this.guidanceType = qualityResult.guidanceType;
    this.aiGuidance = qualityResult.guidance;

    this.updateGuideItemsWithDelay([
      { label: 'Be specific', pass: qualityResult.quality.beSpecific.pass },
      { label: 'Highlight impact', pass: qualityResult.quality.highlightImpact.pass },
      { label: 'Acknowledge effort', pass: qualityResult.quality.acknowledgeEffort.pass },
      { label: 'Reinforce consistency', pass: qualityResult.quality.reinforceConsistency.pass }
    ], () => {
      this.animateScore(this.calculateWeightedScore());
    });

    if (qualityResult.guidanceType === 'none') {

      this.showAiSuggestion = false;
      this.aiGuidance = this.getRandomCongratulation();
      this.guidanceType = 'suggestion';

    } else if (qualityResult.guidanceType === 'suggestion') {

      this.showAiSuggestion = true;
      this.aiText = qualityResult.guidance;
      this.aiGuidance = qualityResult.guidance;
      this.guidanceType = 'suggestion';

    } else {

      this.showAiSuggestion = false;
    }
  }

  /* =====================
     GUIDE HELPERS
  ====================== */

  private updateGuideItem(label: string, pass: boolean): void {
    const item = this.guideItems.find(i => i.label === label);
    if (item) item.status = pass ? 'success' : 'error';
  }

  private updateGuideItemsWithDelay(
    updates: Array<{ label: string, pass: boolean }>,
    onComplete?: () => void
  ): void {
    updates.forEach((u, i) => {
      setTimeout(() => {
        this.updateGuideItem(u.label, u.pass);
        // After the last item updates, call onComplete
        if (i === updates.length - 1 && onComplete) {
          onComplete();
        }
      }, i * 100);
    });
  }

  /* =====================
     SUBMIT
  ====================== */

  canSubmit(): boolean {
    const languageRule = this.guideItems.find(
      item => item.label === 'Abusive Check'
    );
    return languageRule?.status === 'success' &&
      this.userText.trim().length > 0;
  }

  postAppreciation(): void {
    alert("🙏 Appreciation posted successfully!");
    this.resetToInitialState();
  }

  /* =====================
     AI ACTIONS
  ====================== */

  useAiText(): void {
    this.userText = this.aiText;
    this.showAiSuggestion = false;
    this.isCheckingLanguage = true;

    setTimeout(() => {
      this.mainTextarea?.nativeElement?.focus();
    }, 100);

    this.languageService.checkQuality(this.userText.trim()).subscribe({
      next: (res) => {
        this.isCheckingLanguage = false;
        if (!res.success) return;

        this.updateGuideItemsWithDelay([
          { label: 'Be specific', pass: res.quality.beSpecific.pass },
          { label: 'Highlight impact', pass: res.quality.highlightImpact.pass },
          { label: 'Acknowledge effort', pass: res.quality.acknowledgeEffort.pass },
          { label: 'Reinforce consistency', pass: res.quality.reinforceConsistency.pass }
        ], () => {
          this.animateScore(this.calculateWeightedScore());
        });

        this.aiGuidance = this.getRandomCongratulation();
        this.guidanceType = 'suggestion';
      },
      error: () => {
        this.isCheckingLanguage = false;
      }
    });
  }

  rewriteWithAI(): void {

    if (this.userText.trim().length < 50) return;

    this.isCheckingLanguage = true;

    this.languageService.rewriteAppreciation(this.userText)
      .subscribe({
        next: (res) => {
          this.isCheckingLanguage = false;
          if (res.success) {
            this.aiText = res.rewrite;
            this.showAiSuggestion = true;
          }
        },
        error: () => {
          this.isCheckingLanguage = false;
        }
      });
  }

  /* =====================
     NAVIGATION
  ====================== */

  close(): void {
    this.resetToInitialState();
    this.closed.emit();
  }

  goBack(): void {
    this.resetToInitialState();
    this.back.emit();
  }

  /* =====================
     RESET
  ====================== */

  private resetToInitialState(): void {
    this.userText = '';
    this.aiText = '';
    this.showAiSuggestion = false;
    this.score = 0;
    this.hasStartedTyping = false;
    this.lastGeneratedFor = '';
    this.lastMeaningfulText = '';
    this.isCheckingLanguage = false;
    this.aiGuidance = '';
    this.guidanceType = '';
    this.updateProgress(0);

    this.guideItems.forEach(i => i.status = 'neutral');
  }

  /* =====================
     SCORE
  ====================== */

  get scoreClass(): string {
    if (this.score < 40) return 'low';
    if (this.score < 70) return 'medium';
    return 'high';
  }

  private calculateWeightedScore(): number {
    return this.guideItems.reduce((total, item) => {
      if (item.status === 'success') {
        return total + (this.weightageMap[item.label] || 0);
      }
      return total;
    }, 0);
  }

  private animateScore(target: number): void {
    const interval = setInterval(() => {
      if (this.score < target) this.score++;
      else if (this.score > target) this.score--;
      else clearInterval(interval);

      this.updateProgress(this.score);
    }, 25);
  }

  private updateProgress(score: number): void {
    const percent = score / 100;
    this.dashOffset = this.circumference * (1 - percent);
  }

  /* =====================
     HELPERS
  ====================== */

  formatGuidance(text: string): string {

    if (!text) return '';

    const marker = 'Consider phrases such as:';
    const index = text.indexOf(marker);

    if (index === -1) return text;

    const before = text.substring(0, index);
    const after = text.substring(index + marker.length);

    return `${before}<br><br>
      <span class="try-using">${marker}</span>
      <span class="word-suggestions">${after}</span>`;
  }

  getGuidanceMainText(text: string): string {
    if (!text) return '';

    const marker = 'Consider phrases such as:';
    const index = text.indexOf(marker);

    if (index === -1) return text;

    return text.substring(0, index).trim();
  }

  getGuidancePhrases(text: string): string {
    if (!text) return '';

    const marker = 'Consider phrases such as:';
    const index = text.indexOf(marker);

    if (index === -1) return '';

    return text.substring(index + marker.length).trim();
  }

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

private normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:]/g, '')  // remove punctuation
    .replace(/\s+/g, ' ')      // normalize spaces
    .trim();
}



}