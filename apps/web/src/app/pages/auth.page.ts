import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { APP_NAME } from '@bouffe/core';
import { Api, ApiError, OfflineError, type SignupMode } from '../core/api';
import { Store } from '../core/store';

/** Connexion. La création de compte a sa propre page : `/inscription`. */
@Component({
  selector: 'app-auth-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="page flex min-h-dvh flex-col justify-center !pb-10">
      <div class="fade-in">
        <img src="icons/icon-192.png" alt="" width="64" height="64" class="mb-8 rounded-[1.25rem]" />
        <p class="eyebrow mb-1">{{ appName }}</p>
        <h1 class="title">Bon retour.</h1>
        <p class="mt-3 text-lg text-muted">Ce que tu manges cette semaine, au gramme près — et la liste de courses qui va avec.</p>

        <form class="mt-10 space-y-4" (ngSubmit)="submit()">
          <div>
            <label class="label" for="email">Email</label>
            <input id="email" class="input" type="email" name="email" autocomplete="email" inputmode="email" autocapitalize="none" spellcheck="false" required [(ngModel)]="email" />
          </div>
          <div>
            <label class="label" for="password">Mot de passe</label>
            <input id="password" class="input" type="password" name="password" required autocomplete="current-password" [(ngModel)]="password" />
          </div>

          @if (error()) {
            <p class="rounded-2xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger" role="alert">{{ error() }}</p>
          }

          <button type="submit" class="btn btn-primary btn-lg" [disabled]="pending()">
            {{ pending() ? 'Un instant…' : 'Se connecter' }}
          </button>
        </form>

        <!-- Sur une installation privée, la création de compte peut être fermée côté serveur. -->
        @if (signup() !== 'closed') {
          <a routerLink="/inscription" class="mt-6 block w-full text-center text-sm font-semibold text-accent">
            {{ signup() === 'invite' ? 'Tu as reçu une invitation ? Créer un compte' : 'Pas encore de compte ? Créer un compte' }}
          </a>
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
  protected readonly signup = signal<SignupMode>('open');
  protected readonly pending = signal(false);
  protected readonly error = signal('');
  protected email = '';
  protected password = '';

  constructor() {
    void this.api.signupMode().then((mode) => this.signup.set(mode));
  }

  protected async submit(): Promise<void> {
    this.error.set('');
    if (!this.email || !this.password) return;
    this.pending.set(true);
    try {
      await this.api.login(this.email.trim(), this.password);
      await this.store.refresh(true);
      await this.router.navigateByUrl(this.store.user()?.onboardedAt ? '/' : '/bienvenue');
    } catch (cause) {
      if (cause instanceof OfflineError) this.error.set('Impossible de joindre le serveur. Vérifie ta connexion.');
      else if (cause instanceof ApiError && cause.status === 429) this.error.set('Trop de tentatives. Réessaie dans une minute.');
      else this.error.set(cause instanceof Error ? cause.message : 'Connexion impossible.');
    } finally {
      this.pending.set(false);
    }
  }
}
