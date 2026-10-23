import { enableProdMode } from '@angular/core';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
import * as go from 'gojs';

import { AppModule } from './app/app.module';
import { environment } from './environments/environment';

if (environment.production) {
  enableProdMode();
}

// Non-commercial academic use (TCC); must be set before the first Diagram is created.
go.Diagram.licenseKey = 'academic';

platformBrowserDynamic().bootstrapModule(AppModule)
  .catch(err => console.error(err));
