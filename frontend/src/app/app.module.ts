import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';

import { AppComponent } from './app.component';
import { LoginComponent } from './login/login.component';
import { AppreciationModalComponent } from './modal/appreciation-modal.component';
// Editor modal shown after user selects who to appreciate (write appreciation text)
import { AppreciationEditorModalComponent } from './modal/appreciation-editor-modal.component';
import { AuthService } from './services/auth.service';

@NgModule({
  declarations: [
    AppComponent,
    LoginComponent,
    AppreciationModalComponent,
    AppreciationEditorModalComponent  // Required so <app-appreciation-editor-modal> can be used in templates
  ],
  imports: [
    BrowserModule,
    FormsModule,
    HttpClientModule
  ],
  providers: [
    AuthService
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }
