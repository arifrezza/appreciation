import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

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
}
