import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { Store } from './core/store';
import { Toasts } from './core/toasts';
import { Icon, type IconName } from './ui/ui';

interface Tab {
  path: string;
  label: string;
  icon: IconName;
  exact: boolean;
}

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon],
  template: `
    @if (store.busy()) {
      <div class="no-print fixed inset-x-0 top-0 z-[70] h-0.5 overflow-hidden bg-accent-soft" role="progressbar" aria-label="Chargement">
        <div class="loading-bar h-full w-1/3 bg-accent"></div>
      </div>
    }

    <main>
      <router-outlet />
    </main>

    @if (!store.online() && chrome()) {
      <div class="no-print fixed inset-x-0 z-40 flex justify-center px-4" style="bottom: calc(env(safe-area-inset-bottom) + 5.25rem)" role="status">
        <span class="flex items-center gap-2 rounded-full bg-fg px-3.5 py-2 text-xs font-semibold text-bg shadow-lg">
          <app-icon name="wifi-off" [size]="14" />
          Hors ligne
          @if (store.outbox().length > 0) {
            · {{ store.outbox().length }} en attente
          }
        </span>
      </div>
    }

    @if (chrome()) {
      <nav
        class="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card/80 backdrop-blur-xl"
        style="padding-bottom: env(safe-area-inset-bottom)"
        aria-label="Navigation principale"
      >
        <ul class="mx-auto flex max-w-[34rem] items-stretch justify-between px-2">
          @for (tab of tabs; track tab.path) {
            <li class="flex-1">
              <a
                [routerLink]="tab.path"
                routerLinkActive="!text-accent"
                [routerLinkActiveOptions]="{ exact: tab.exact }"
                ariaCurrentWhenActive="page"
                class="flex min-h-16 flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium text-faint transition-colors"
              >
                <app-icon [name]="tab.icon" [size]="24" />
                {{ tab.label }}
              </a>
            </li>
          }
        </ul>
      </nav>
    }

    <div
      class="no-print pointer-events-none fixed inset-x-0 top-0 z-[80] flex flex-col items-center gap-2 px-4"
      style="padding-top: calc(env(safe-area-inset-top) + 0.75rem)"
      aria-live="polite"
    >
      @for (toast of toasts.items(); track toast.id) {
        <button
          type="button"
          class="fade-in pointer-events-auto max-w-sm rounded-2xl px-4 py-3 text-left text-sm font-medium shadow-lg"
          [class]="toast.kind === 'error' ? 'bg-danger text-white' : toast.kind === 'success' ? 'bg-accent text-on-accent' : 'bg-fg text-bg'"
          (click)="toasts.dismiss(toast.id)"
        >
          {{ toast.text }}
        </button>
      }
    </div>
  `,
  styles: `
    .loading-bar {
      animation: slide 1s ease-in-out infinite;
    }

    @keyframes slide {
      from {
        transform: translateX(-100%);
      }
      to {
        transform: translateX(300%);
      }
    }
  `,
})
export class App {
  protected readonly store = inject(Store);
  protected readonly toasts = inject(Toasts);
  private readonly router = inject(Router);

  protected readonly tabs: Tab[] = [
    { path: '/', label: 'Aujourd’hui', icon: 'home', exact: true },
    { path: '/programme', label: 'Programme', icon: 'calendar', exact: false },
    { path: '/courses', label: 'Courses', icon: 'cart', exact: false },
    { path: '/progression', label: 'Progression', icon: 'chart', exact: false },
    { path: '/profil', label: 'Profil', icon: 'user', exact: false },
  ];

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  /** La barre d'onglets disparaît sur les écrans plein cadre (connexion, mode Courses, impression). */
  protected readonly chrome = computed(() => !/^\/(connexion|inscription|bienvenue|courses\/magasin|programme\/imprimer|programme\/cuisine)/.test(this.url()));
}
