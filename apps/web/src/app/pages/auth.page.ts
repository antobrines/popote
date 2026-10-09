import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { APP_NAME } from '@bouffe/core';
import { Api, OfflineError } from '../core/api';
import { Store } from '../core/store';

@Component({
  selector: 'app-auth-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="page flex min-h-dvh flex-col justify-center !pb-10">
      <div class="fade-in">
        <img src="icons/icon-192.png" alt="" width="64" height="64" class="mb-8 rounded-[1.25rem]" />
        <p class="eyebrow mb-1">{{ appName }}</p>
        <h1 class="title">{{ mode() === 'login' ? 'Bon retour.' : 'Créer ton compte.' }}</h1>
        <p class="mt-3 text-lg text-muted">Ce que tu manges cette semaine, au gramme près — et la liste de courses qui va avec.</p>

        <form class="mt-10 space-y-4" (ngSubmit)="submit()">
          @if (mode() === 'register') {
            <div>
              <label class="label" for="name">Prénom</label>
              <input id="name" class="input" name="name" autocomplete="given-name" [(ngModel)]="name" maxlength="60" />
            </div>
          }
          <div>
            <label class="label" for="email">Email</label>
            <input id="email" class="input" type="email" name="email" autocomplete="email" inputmode="email" required [(ngModel)]="email" />
          </div>
          <div>
            <label class="label" for="password">Mot de passe</label>
            <input
              id="password"
              class="input"
              type="password"
              name="password"
              required
              [minlength]="mode() === 'register' ? 10 : 1"
              [autocomplete]="mode() === 'login' ? 'current-password' : 'new-password'"
              [(ngModel)]="password"
            />
            @if (mode() === 'register') {
              <p class="mt-1.5 text-xs text-muted">10 caractères minimum.</p>
            }
          </div>

          @if (error()) {
            <p class="rounded-2xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger" role="alert">{{ error() }}</p>
          }

          <button type="submit" class="btn btn-primary btn-lg" [disabled]="pending()">
            {{ pending() ? 'Un instant…' : mode() === 'login' ? 'Se connecter' : 'Créer mon compte' }}
          </button>
        </form>

        @if (signupOpen() || mode() === 'register') {
          <button type="button" class="mt-6 w-full text-center text-sm font-semibold text-accent" (click)="toggle()">
            {{ mode() === 'login' ? 'Pas encore de compte ? Créer un compte' : 'Déjà un compte ? Se connecter' }}
          </button>
        }
      </div>
    </div>
  `,
})
export class AuthPage {
  private readonly api = inject(Api);
  private readonly store = inject(Store);
  private readonly router = inject(Router);

  protected readonly appName = APP_NAME;
  protected readonly mode = signal<'login' | 'register'>('login');
  /** Sur une installation privée, la création de compte peut être fermée côté serveur. */
  protected readonly signupOpen = signal(true);
  protected readonly pending = signal(false);
  protected readonly error = signal('');
  protected name = '';
  protected email = '';
  protected password = '';

  constructor() {
    void this.api.signupOpen().then((open) => this.signupOpen.set(open));
  }

  protected toggle(): void {
    this.mode.update((m) => (m === 'login' ? 'register' : 'login'));
    this.error.set('');
  }

  protected async submit(): Promise<void> {
    this.error.set('');
    if (!this.email || !this.password) return;
    if (this.mode() === 'register' && this.password.length < 10) {
      this.error.set('Le mot de passe doit contenir au moins 10 caractères.');
      return;
    }
    this.pending.set(true);
    try {
      if (this.mode() === 'login') await this.api.login(this.email, this.password);
      else await this.api.register(this.email, this.password, this.name);
      await this.store.refresh(true);
      await this.router.navigateByUrl(this.store.user()?.onboardedAt ? '/' : '/bienvenue');
    } catch (cause) {
      this.error.set(cause instanceof OfflineError ? 'Impossible de joindre le serveur. Vérifie ta connexion.' : cause instanceof Error ? cause.message : 'Connexion impossible.');
    } finally {
      this.pending.set(false);
    }
  }
}
