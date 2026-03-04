import {
  Component,
  Input,
  Output,
  EventEmitter,
  AfterViewInit,
  OnDestroy
} from '@angular/core';

import { LanguageService, QualityResponse, SpellCorrection } from '../services/language.service';
import { Subject, forkJoin, EMPTY } from 'rxjs';
import { debounceTime, filter, switchMap, takeUntil } from 'rxjs/operators';
import Quill from 'quill';

type RuleStatus = 'neutral' | 'success' | 'error';

@Component({
  selector: 'app-appreciation-editor-modal',
  templateUrl: './appreciation-editor-modal.component.html',
  styleUrls: ['./appreciation-editor-modal.component.css']
})
export class AppreciationEditorModalComponent
  implements AfterViewInit, OnDestroy {

  private quillEditor!: Quill;

  quillModules = {
    toolbar: {
      container: [
        ['bold', 'italic', 'underline'],
        [{ 'color': ['#000000', '#e60000', '#ff9900', '#ffff00', '#008a00', '#0066cc', '#9933ff', '#ffffff', '#facccc', '#ffebcc', '#ffffcc', '#cce8cc', '#cce0f5', '#ebd6ff'] }]
      ]
    }
  };

  constructor(private languageService: LanguageService) { }

  /* =====================
     LIFECYCLE
  ====================== */

  ngAfterViewInit(): void {

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

    // Autocomplete ghost text stream
    this.autocompleteSubject
      .pipe(
        debounceTime(400),
        filter(() => this.countAllPassed() < 5 && !this.showCongratulation && this.guideItems[0].status !== 'error'),
        switchMap(text => {
          const lowerText = text.toLowerCase();

          const failingCriteria = this.guideItems
            .filter(i => i.label !== 'Abusive Check' && i.status !== 'success')
            .map(i => i.label);

          if (failingCriteria.length === 0) return EMPTY;

          // Trigger A: check if text contains a known suggested phrase
          let targetCriterion: string | undefined;
          for (const [phrase, criterion] of Object.entries(this.phraseToCriterionMap)) {
            if (lowerText.includes(phrase)) {
              targetCriterion = criterion;
              break;
            }
          }

          // Trigger B: no keyword match — targetCriterion stays undefined,
          // backend picks the best-fitting failing criterion
          return this.languageService.autocomplete(text, failingCriteria, targetCriterion);
        }),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: (res) => {
          if (res.success && !this.showCongratulation) {
            if (res.completion) {
              this.ghostText = res.completion;
              setTimeout(() => this.updateGhostPosition());
            }
            this.spellCorrections = (res.corrections || [])
              .filter(c => !this.ignoredWords.has(c.wrong.toLowerCase()));
          }
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
  plainText = '';
  aiText = '';
  showAiSuggestion = false;
  ghostText = '';
  ghostTop = 0;
  ghostLeft = 0;
  ghostWidth = 0;
  ghostIndent = 0;
  spellCorrections: SpellCorrection[] = [];
  private ignoredWords: Set<string> = new Set();

  score = 0;
  isCheckingLanguage = false;

  aiGuidance = '';
  guidanceType: 'question' | 'suggestion' | 'none' | 'abusive' | 'congratulation' | '' = '';
  showCongratulation = false;

  radius = 27;
  circumference = 2 * Math.PI * this.radius;
  dashOffset = this.circumference;

  private hasStartedTyping = false;
  private readonly TYPING_DELAY = 1000;
  private lastGeneratedFor = '';
  private lastMeaningfulText = '';
  private hasTriggeredRewrite = false;
  private previousRawText = '';
  private lastRewriteAtTickCount = -1;  // tracks which tick count last triggered a rewrite


  private phraseToCriterionMap: Record<string, string> = {};

  // ⭐ reactive streams
  private typingSubject = new Subject<string>();
  private autocompleteSubject = new Subject<string>();
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
  return this.guideItems.filter(item => item.label !== 'Abusive Check' && item.status === 'success').length;
}
countAllPassed(): number {
  return this.guideItems.filter(item => item.status === 'success').length;
}


  get displayGhostText(): string {
    if (!this.ghostText) return '';
    if (!this.userText || this.userText.endsWith(' ') || this.ghostText.startsWith(' ')) {
      return this.ghostText;
    }
    return ' ' + this.ghostText;
  }

  /* =====================
     QUILL EDITOR
  ====================== */

  onEditorCreated(editor: Quill): void {
    this.quillEditor = editor;
    setTimeout(() => editor.focus(), 300);
  }

  onContentChanged(event: any): void {
    if (!this.quillEditor) return;
    this.plainText = this.quillEditor.getText().replace(/\n$/, '');
    this.userText = this.plainText;
    this.onTextChange();
  }

  private updateGhostPosition(): void {
    if (!this.quillEditor || !this.ghostText) return;
    try {
      const length = this.quillEditor.getLength() - 1;
      const bounds = this.quillEditor.getBounds(length);
      if (bounds) {
        const editorEl = this.quillEditor.root;
        const wrapperEl = editorEl.closest('.textarea-wrapper') as HTMLElement;
        if (wrapperEl) {
          const editorRect = editorEl.getBoundingClientRect();
          const wrapperRect = wrapperEl.getBoundingClientRect();
          const editorOffsetTop = editorRect.top - wrapperRect.top;
          const editorOffsetLeft = editorRect.left - wrapperRect.left;
          const padLeft = parseFloat(getComputedStyle(editorEl).paddingLeft) || 16;
          const padRight = parseFloat(getComputedStyle(editorEl).paddingRight) || 16;

          // Position overlay at cursor line, covering editor content area
          this.ghostTop = bounds.top + editorOffsetTop;
          this.ghostLeft = editorOffsetLeft + padLeft;
          this.ghostWidth = editorRect.width - padLeft - padRight;
          // text-indent: first line starts at cursor X (from content area left)
          this.ghostIndent = (bounds.left + bounds.width) - padLeft;
        }
      }
    } catch (e) {
      // getBounds can throw if editor not fully rendered
    }
  }

  /* =====================
     TEXT CHANGE
  ====================== */

  onTextChange(): void {

    const text = this.userText.trim();

    // Only dismiss ghost on alphanumeric characters, not spaces/punctuation
    if (this.ghostText) {
      if (this.userText.length <= this.previousRawText.length) {
        this.ghostText = '';
        this.spellCorrections = [];
      } else {
        const newChars = this.userText.substring(this.previousRawText.length);
        if (/[a-zA-Z0-9]/.test(newChars)) {
          this.ghostText = '';
          this.spellCorrections = [];
        }
      }
    }
    this.previousRawText = this.userText;

    if (text.length === 0) {
      this.resetToInitialState();
      return;
    }

    if (!this.hasStartedTyping) {
      this.hasStartedTyping = true;
    }

    const normalized = this.normalizeText(text);

    if (normalized === this.lastMeaningfulText) {
      return;
    }

    this.lastMeaningfulText = normalized;

    // ⭐ push to quality check stream
    this.typingSubject.next(text);

    // ⭐ push to autocomplete stream (if there are failing criteria)
    const failingCount = this.guideItems.filter(
      i => i.label !== 'Abusive Check' && i.status !== 'success'
    ).length;
    if (failingCount > 0 && text.length >= 10 && this.guideItems[0].status !== 'error') {
      this.autocompleteSubject.next(text);
    }
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
      this.ghostText = '';
      this.spellCorrections = [];
      this.lastRewriteAtTickCount = -1;
      this.showCongratulation = false;
      this.aiGuidance = 'Your message contains inappropriate language. Please revise it before continuing.';
      this.guidanceType = 'abusive';
      return;
    }

    const wasAbusive = languageRule.status === 'error';
    languageRule.status = 'success';

    // Re-trigger autocomplete only when recovering from abusive status
    if (wasAbusive) {
      const trimmedText = this.userText.trim();
      const failingCount = this.guideItems.filter(
        i => i.label !== 'Abusive Check' && i.status !== 'success'
      ).length;
      if (failingCount > 0 && trimmedText.length >= 10) {
        this.autocompleteSubject.next(trimmedText);
      }
    }

    if (!qualityResult || !qualityResult.success) return;

    // Hide AI suggestion box immediately when all criteria pass (don't wait for 300ms animation)
    if (qualityResult.guidanceType === 'none') {
      this.showAiSuggestion = false;
    }

    this.updateGuideItemsWithDelay([
      { label: 'Be specific', pass: qualityResult.quality.beSpecific.pass },
      { label: 'Highlight impact', pass: qualityResult.quality.highlightImpact.pass },
      { label: 'Acknowledge effort', pass: qualityResult.quality.acknowledgeEffort.pass },
      { label: 'Reinforce consistency', pass: qualityResult.quality.reinforceConsistency.pass }
    ], () => {
      this.animateScore(this.calculateWeightedScore());
      const totalPassed = this.countAllPassed();
        if (totalPassed < 3) {
                this.showAiSuggestion = false;
                this.lastRewriteAtTickCount = -1;
              }

          /*if (totalPassed >= 3 && totalPassed !== this.lastRewriteAtTickCount) {
                  this.lastRewriteAtTickCount = totalPassed;
                  this.rewriteWithAI();
                  // fall through — still update right panel guidance below
                }*/

        // If criteria regressed from 5, exit congratulation so autocomplete can resume
        if (this.showCongratulation && totalPassed < 5) {
          this.showCongratulation = false;
          const trimmedText = this.userText.trim();
          const failingCount = this.guideItems.filter(
            i => i.label !== 'Abusive Check' && i.status !== 'success'
          ).length;
          if (failingCount > 0 && trimmedText.length >= 10) {
            this.autocompleteSubject.next(trimmedText);
          }
        }

        if (totalPassed === 5 || qualityResult.guidanceType === 'none') {
          // All criteria passed → congratulations
          this.showCongratulation = true;
          this.showAiSuggestion = false;
          this.ghostText = '';
          this.aiGuidance = this.getRandomCongratulation();
          this.guidanceType = 'suggestion';
        } else if (qualityResult.guidanceType === 'suggestion') {
          // Backend returned a rewritten suggestion → show in AI suggestion box
          this.showCongratulation = false;
          //this.showAiSuggestion = true;
          this.aiText = qualityResult.guidance;
          this.aiGuidance = qualityResult.guidance;
          this.guidanceType = 'suggestion';
        } else {
          // Tips/questions → show as guidance on the right
          this.showCongratulation = false;
          this.showAiSuggestion = false;
          this.guidanceType = qualityResult.guidanceType;
          this.aiGuidance = qualityResult.guidance;
          // Extract suggested phrases and map them to their criterion
          this.extractPhrases(qualityResult.guidance, qualityResult);
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
    this.plainText = this.aiText;
    if (this.quillEditor) {
      this.quillEditor.setText(this.aiText);
    }
    this.showAiSuggestion = false;
    this.isCheckingLanguage = true;

    setTimeout(() => {
      this.quillEditor?.focus();
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
                this.showAiSuggestion = false;
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

  rewriteWithAI(manual = false): void {

    if (this.userText.trim().length < 50) return;

    this.isCheckingLanguage = true;

    const failingCriteria = this.guideItems
      .filter(item => item.label !== 'Abusive Check' && item.status !== 'success')
      .map(item => item.label);

    this.languageService.rewriteAppreciation(this.userText, failingCriteria)
      .subscribe({
        next: (res) => {
          this.isCheckingLanguage = false;
          if (res.success && (manual || (this.countAllPassed() < 5 && !this.showCongratulation))) {
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
    this.plainText = '';
    if (this.quillEditor) {
      this.quillEditor.setText('');
    }
    this.aiText = '';
    this.showAiSuggestion = false;
    this.ghostText = '';
    this.spellCorrections = [];
    this.ignoredWords.clear();
    this.score = 0;
    this.hasStartedTyping = false;
    this.lastGeneratedFor = '';
    this.lastMeaningfulText = '';
    this.hasTriggeredRewrite = false;
    this.previousRawText = '';
    this.lastRewriteAtTickCount = -1;
    this.isCheckingLanguage = false;
    this.aiGuidance = '';
    this.guidanceType = '';
    this.showCongratulation = false;
    this.phraseToCriterionMap = {};
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
     AUTOCOMPLETE
  ====================== */

  private extractPhrases(guidance: string, qualityResult: QualityResponse): void {
    const marker = 'Consider phrases such as:';
    const idx = guidance.indexOf(marker);
    if (idx === -1) return;

    // Find which criterion this guidance targets (the weakest failing one)
    const criteriaScores = [
      { label: 'Be specific', score: qualityResult.quality.beSpecific.score, pass: qualityResult.quality.beSpecific.pass },
      { label: 'Highlight impact', score: qualityResult.quality.highlightImpact.score, pass: qualityResult.quality.highlightImpact.pass },
      { label: 'Acknowledge effort', score: qualityResult.quality.acknowledgeEffort.score, pass: qualityResult.quality.acknowledgeEffort.pass },
      { label: 'Reinforce consistency', score: qualityResult.quality.reinforceConsistency.score, pass: qualityResult.quality.reinforceConsistency.pass }
    ];
    const weakest = criteriaScores.filter(c => !c.pass).sort((a, b) => a.score - b.score)[0];
    const criterionLabel = weakest?.label || '';

    // Map each phrase to the criterion it targets
    const raw = guidance.substring(idx + marker.length);
    const phrases = raw.split(',').map(p => p.trim().replace(/['"]/g, '').toLowerCase()).filter(p => p.length > 0);
    phrases.forEach(phrase => {
      this.phraseToCriterionMap[phrase] = criterionLabel;
    });
  }

  get activeCorrections(): SpellCorrection[] {
    const lower = this.userText.toLowerCase();
    return this.spellCorrections
      .filter(c => lower.includes(c.wrong.toLowerCase()));
  }

  acceptCorrection(correction: SpellCorrection): void {
    if (this.quillEditor) {
      const text = this.quillEditor.getText().replace(/\n$/, '');
      const idx = text.toLowerCase().indexOf(correction.wrong.toLowerCase());
      if (idx !== -1) {
        this.quillEditor.deleteText(idx, correction.wrong.length);
        this.quillEditor.insertText(idx, correction.fixed);
      }
    }
    this.spellCorrections = this.spellCorrections
      .filter(c => c.wrong !== correction.wrong);
    this.plainText = this.quillEditor?.getText().replace(/\n$/, '') || '';
    this.userText = this.plainText;
    this.previousRawText = this.userText;
    this.onTextChange();
  }

  acceptAllCorrections(): void {
    if (this.quillEditor) {
      let text = this.quillEditor.getText().replace(/\n$/, '');
      for (const c of this.activeCorrections) {
        const regex = new RegExp(this.escapeRegex(c.wrong), 'gi');
        text = text.replace(regex, c.fixed);
      }
      this.quillEditor.setText(text);
    }
    this.spellCorrections = [];
    this.plainText = this.quillEditor?.getText().replace(/\n$/, '') || '';
    this.userText = this.plainText;
    this.previousRawText = this.userText;
    this.onTextChange();
  }

  dismissCorrection(correction: SpellCorrection): void {
    this.ignoredWords.add(correction.wrong.toLowerCase());
    this.spellCorrections = this.spellCorrections
      .filter(c => c.wrong !== correction.wrong);
  }

  dismissAllCorrections(): void {
    this.activeCorrections.forEach(c =>
      this.ignoredWords.add(c.wrong.toLowerCase())
    );
    this.spellCorrections = [];
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Tab' && this.ghostText) {
      event.preventDefault();

      if (!this.quillEditor) return;

      // Apply spelling corrections first
      const currentText = this.quillEditor.getText().replace(/\n$/, '');
      let correctedText = currentText;
      for (const c of this.activeCorrections) {
        const regex = new RegExp(this.escapeRegex(c.wrong), 'gi');
        correctedText = correctedText.replace(regex, c.fixed);
      }
      if (correctedText !== currentText) {
        this.quillEditor.setText(correctedText);
      }
      this.spellCorrections = [];

      // Append ghost text at the end
      const len = this.quillEditor.getLength() - 1; // -1 for trailing \n
      const needsSpace = correctedText.length > 0
        && !correctedText.endsWith(' ')
        && !this.ghostText.startsWith(' ');
      this.quillEditor.insertText(len, (needsSpace ? ' ' : '') + this.ghostText);

      // Sync state
      this.plainText = this.quillEditor.getText().replace(/\n$/, '');
      this.userText = this.plainText;
      this.ghostText = '';
      this.previousRawText = this.userText;

      // Move cursor to end
      this.quillEditor.setSelection(this.quillEditor.getLength(), 0);

      this.onTextChange();
    }
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