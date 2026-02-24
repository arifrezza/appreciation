import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface SpellCorrection {
  wrong: string;
  fixed: string;
}

export interface CriterionResult {
  score: number;
  pass: boolean;
}

export interface QualityResponse {
  success: boolean;
  quality: {
    beSpecific: CriterionResult;
    highlightImpact: CriterionResult;
    acknowledgeEffort: CriterionResult;
    reinforceConsistency: CriterionResult;
  };
  overallScore: number;
  guidanceType: 'question' | 'suggestion' | 'none';
  guidance: string;
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class LanguageService {

  constructor(private http: HttpClient) {}

  checkLanguage(text: string): Observable<{ abusive: boolean }> {
    return this.http.post<{ abusive: boolean }>(
      '/api/check-abusive-words',
      { text }
    );
  }

  checkQuality(text: string): Observable<QualityResponse> {
    return this.http.post<QualityResponse>(
      '/api/check-appreciation-quality',
      { text }
    );
  }

rewriteAppreciation(text: string, failingCriteria: string[]) {
  return this.http.post<any>(
    '/api/rewrite-appreciation',
    { text, failingCriteria }
  );
}

autocomplete(
  text: string,
  failingCriteria: string[],
  targetCriterion?: string
): Observable<{ success: boolean; completion: string; corrections: SpellCorrection[] }> {
  const body: any = { text, failingCriteria };
  if (targetCriterion) {
    body.targetCriterion = targetCriterion;
  }
  return this.http.post<{ success: boolean; completion: string; corrections: SpellCorrection[] }>(
    '/api/autocomplete', body
  );
}

}
