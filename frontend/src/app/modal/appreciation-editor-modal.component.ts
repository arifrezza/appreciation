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

  constructor(private languageService: LanguageService) { }

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
  guidanceType: 'question' | 'suggestion' | 'none' | 'abusive' | 'congratulation' | '' = '';
  showCongratulation = false;

  radius = 34;
  circumference = 2 * Math.PI * this.radius;
  dashOffset = this.circumference;

  private hasStartedTyping = false;
  private readonly TYPING_DELAY = 1700;
  private lastGeneratedFor = '';
  private lastMeaningfulText = '';
  private lastRewriteAtTickCount = -1;  // tracks which tick count last triggered a rewrite


  // ⭐ reactive streams
  private typingSubject = new Subject<string>();
  private destroy$ = new Subject<void>();

  /* =====================
     GUIDE ITEMS
  ====================== */

  private readonly weightageMap: Record<string, number> = {
    'Abusive Check': 3,
    'Be specific': 35,
    'Highlight impact': 37,
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

  private countPassedCriteria(): number {
    console.log("countPassedCriteria");
    console.log(this.guideItems.filter(item => item.label !== 'Abusive Check' && item.status === 'success').length);
    return this.guideItems.filter(item => item.label !== 'Abusive Check' && item.status === 'success').length;

  }

  //This gives no of Green Tick including Ausive Check
  private countAllPassed(): number {
    return this.guideItems.filter(item => item.status === 'success').length;

  }


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
      // Reset all other criteria to neutral
      this.guideItems.forEach(item => {
        if (item.label !== 'Abusive Check') item.status = 'neutral';
      });
      this.animateScore(0);
      this.showAiSuggestion = false;
      this.lastRewriteAtTickCount = -1;
      this.showCongratulation = false;
      this.aiGuidance = 'Your message contains inappropriate language. Please revise it before continuing.';
      this.guidanceType = 'abusive';
      return;
    }

    languageRule.status = 'success';

    if (!qualityResult || !qualityResult.success) return;

    this.updateGuideItemsWithDelay([
      { label: 'Be specific', pass: qualityResult.quality.beSpecific.pass },
      { label: 'Highlight impact', pass: qualityResult.quality.highlightImpact.pass },
      { label: 'Acknowledge effort', pass: qualityResult.quality.acknowledgeEffort.pass },
      { label: 'Reinforce consistency', pass: qualityResult.quality.reinforceConsistency.pass }
    ], () => {
      this.animateScore(this.calculateWeightedScore());
      const totalPassed = this.countAllPassed();

      // Hide AI suggestion if ticks drop below 3; reset so it re-triggers on recovery
      if (totalPassed < 3) {
        this.showAiSuggestion = false;
        this.lastRewriteAtTickCount = -1;
      }

      // Auto-trigger rewrite at 3+ ticks, and re-trigger whenever tick count increases
      if (totalPassed >= 3 && totalPassed !== this.lastRewriteAtTickCount) {
        this.lastRewriteAtTickCount = totalPassed;
        this.rewriteWithAI();
        // fall through — still update right panel guidance below
      }

      if (totalPassed === 5 || qualityResult.guidanceType === 'none') {
        // All criteria passed → congratulations
        this.showCongratulation = true;
        this.showAiSuggestion = false;
        this.aiGuidance = this.getRandomCongratulation();
        this.guidanceType = 'congratulation';
      } else {
        // Tips/questions → show as guidance on the right
        this.showCongratulation = false;
        this.guidanceType = qualityResult.guidanceType;
        this.aiGuidance = qualityResult.guidance;
      }
    });

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

    // Here You get the Response of type Quality Response
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
          //this.aiGuidance = this.getRandomCongratulation();
          //this.guidanceType = 'suggestion';
          const passedCount = this.countAllPassed();

          // ✅ Only show congratulation if ALL 5 pass (4 quality + Abusive Check)
          if (passedCount === 5) {
            this.showCongratulation = true;
            this.aiGuidance = this.getRandomCongratulation();
            this.guidanceType = 'congratulation';
          } else {
            // ❗ Otherwise keep backend AI guidance
            this.showCongratulation = false;
            this.guidanceType = res.guidanceType;
            this.aiGuidance = res.guidance;
          }
        });
      },
      error: () => {
        this.isCheckingLanguage = false;
      }
    });
  }

  rewriteWithAI(): void {

    if (this.userText.trim().length < 50) return;
    if (this.countAllPassed() === 5) return;
    this.isCheckingLanguage = true;

    const failingCriteria = this.guideItems
      .filter(item => item.label !== 'Abusive Check' && item.status !== 'success')
      .map(item => item.label);

    this.languageService.rewriteAppreciation(this.userText, failingCriteria)
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
    this.lastRewriteAtTickCount = -1;
    this.isCheckingLanguage = false;
    this.aiGuidance = '';
    this.guidanceType = '';
    this.showCongratulation = false;
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
      'This appreciation is beautifully written.',
      'You’ve captured their impact perfectly.',
      'Excellent acknowledgment of effort!',
      'Your recognition feels sincere and meaningful.',
      'Strong appreciation — clear and impactful.',
      'You’ve highlighted their contribution brilliantly.',
      'This message truly celebrates their work.',
      'Fantastic job recognizing their achievement!',
      'Your words make a real difference.',
      'This is thoughtful and well articulated.',
      'You’re setting a great example of recognition.',
      'Impressive clarity and appreciation.',
      'This recognition feels authentic and powerful.',
      'Well done — this will truly motivate them!',
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