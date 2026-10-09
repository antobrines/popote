import { type ApplicationConfig, inject, isDevMode, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { routes } from './app.routes';
import { ShoppingSessions } from './core/shopping-session';
import { Store } from './core/store';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding(), withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
    // Service worker : coquille applicative disponible hors ligne (désactivé en développement).
    provideServiceWorker('ngsw-worker.js', { enabled: !isDevMode(), registrationStrategy: 'registerWhenStable:30000' }),
    provideAppInitializer(async () => {
      const store = inject(Store);
      const sessions = inject(ShoppingSessions);
      await store.init();
      await sessions.restore();
    }),
  ],
};
