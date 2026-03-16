import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class SpeechToTextService {

  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];

  private recordingSubject = new BehaviorSubject<boolean>(false);
  isRecording$ = this.recordingSubject.asObservable();

  constructor(private http: HttpClient) {}

  startRecording(): Promise<void> {
    return navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      this.audioChunks = [];
      this.mediaRecorder = new MediaRecorder(stream);

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.start();
      this.recordingSubject.next(true);
    });
  }

  stopRecording(): Promise<Blob> {
    return new Promise((resolve) => {
      if (!this.mediaRecorder) {
        resolve(new Blob());
        return;
      }

      this.mediaRecorder.onstop = () => {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        // Stop all tracks to release the microphone
        this.mediaRecorder!.stream.getTracks().forEach(t => t.stop());
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.recordingSubject.next(false);
        resolve(audioBlob);
      };

      this.mediaRecorder.stop();
    });
  }

  transcribe(audioBlob: Blob): Observable<{ text: string }> {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');
    return this.http.post<{ text: string }>('/api/transcribe', formData);
  }
}
