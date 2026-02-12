import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class LanguageService {

  constructor(private http: HttpClient) {}

  checkLanguage(text: string): Observable<{ abusive: boolean }> {
    return this.http.post<{ abusive: boolean }>(
      '/api/check-abusive-words',
      { text }
    );
  }
}
