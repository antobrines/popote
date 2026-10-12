import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { APP_NAME } from '@bouffe/core';
import { Api, ApiError, OfflineError, type SignupMode } from '../core/api';
import { Store } from '../core/store';
import { Icon } from '../ui/ui';

const MIN_PASSWORD = 10;

interface FieldErrors {
  code?: string;
  email?: string;
  password?: string;
}

/**
 * Inscription. Selon l'installation, la création de compte est ouverte, réservée aux invités
 * (un code, déjà rempli quand on arrive par le lien d'invitation) ou fermée.
 */
@Component({
  selector: 'app-signup-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Icon],
  template: `
    <div class="page flex min-h-dvh flex-col justify-center !pb-10">
      <div class="fade-in">
        <img src="icons/icon-192.png" alt="" width="64" height="64" class="mb-8 rounded-[1.25rem]" />
        <p class="eyebrow mb-1">{{ appName }}</p>

        @switch (mode()) {
          @case ('loading') {
            <h1 class="title">Créer ton compte.</h1>
            <p class="mt-3 text-lg text-muted" role="status">Un instant…</p>
          }
          @case ('closed') {
            <h1 class="title">Les inscriptions sont fermées.</h1>
            <p class="mt-3 text-lg text-muted">
              Cette installation n'accepte pas de nouveau compte pour le moment. Si tu connais la personne qui s'en occupe, demande-lui de t'ouvrir un accès.
            </p>
            <a routerLink="/connexion" class="btn btn-primary btn-lg mt-10">J'ai déjà un compte</a>
          }
          @default {
            <h1 class="title">Créer ton compte.</h1>
            <p class="mt-3 text-lg text-muted">Ta semaine de repas au gramme près, et la liste de courses qui va avec.</p>

            <form class="mt-8 space-y-4" (ngSubmit)="submit()" novalidate>
              @if (mode() === 'invite') {
                <div>
                  <label class="label" for="s-code">Code d'invitation</label>
                  <input
                    id="s-code"
                    class="input"
                    name="code"
                    autocomplete="off"
                    autocapitalize="none"
                    spellcheck="false"
                    [ngModel]="inviteCode()"
                    (ngModelChange)="inviteCode.set($event)"
                    [attr.aria-invalid]="errors().code ? true : null"
                    aria-describedby="s-code-help"
                  />
                  <p id="s-code-help" class="mt-1.5 text-xs" [class]="errors().code ? 'font-medium text-danger' : 'text-muted'">
                    {{ errors().code ?? 'Reçu avec ton invitation. Il est déjà rempli si tu es arrivé par le lien.' }}
                  </p>
                </div>
              }

              <div>
                <label class="label" for="s-name">Prénom</label>
                <input id="s-name" class="input" name="name" autocomplete="given-name" maxlength="60" [ngModel]="name()" (ngModelChange)="name.set($event)" />
              </div>

              <div>
                <label class="label" for="s-email">Email</label>
                <input
                  id="s-email"
                  class="input"
                  type="email"
                  name="email"
                  autocomplete="email"
                  inputmode="email"
                  autocapitalize="none"
                  spellcheck="false"
                  [ngModel]="email()"
                  (ngModelChange)="email.set($event)"
                  [attr.aria-invalid]="errors().email ? true : null"
                  aria-describedby="s-email-help"
                />
                <p id="s-email-help" class="mt-1.5 text-xs" [class]="errors().email ? 'font-medium text-danger' : 'text-muted'">
                  {{ errors().email ?? 'Il sert seulement à te connecter : aucun message ne t’est envoyé.' }}
                </p>
              </div>

              <div>
                <label class="label" for="s-password">Mot de passe</label>
                <div class="relative">
                  <input
                    id="s-password"
                    class="input !pr-24"
                    [type]="visible() ? 'text' : 'password'"
                    name="password"
                    autocomplete="new-password"
                    maxlength="200"
                    [ngModel]="password()"
                    (ngModelChange)="password.set($event)"
                    [attr.aria-invalid]="errors().password ? true : null"
                    aria-describedby="s-password-help"
                  />
                  <button
                    type="button"
                    class="absolute inset-y-0 right-1.5 my-1.5 rounded-xl px-3 text-sm font-semibold text-accent"
                    [attr.aria-pressed]="visible()"
                    aria-controls="s-password"
                    (click)="visible.set(!visible())"
                  >
                    {{ visible() ? 'Masquer' : 'Afficher' }}
                  </button>
                </div>
                <p id="s-password-help" class="mt-1.5 flex items-center gap-1.5 text-xs" [class]="errors().password ? 'font-medium text-danger' : password().length >= minPassword ? 'font-medium text-accent' : 'text-muted'">
                  @if (password().length >= minPassword) {
                    <app-icon name="check" [size]="14" [stroke]="2.6" />
                  }
                  {{ errors().password ?? minPassword + ' caractères minimum. Une phrase que toi seul connais fait très bien l’affaire.' }}
                </p>
              </div>

              @if (error()) {
                <p class="rounded-2xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger" role="alert">
                  {{ error() }}
                  @if (exists()) {
                    <a routerLink="/connexion" class="underline">Se connecter</a>
                  }
                </p>
              }

              <button type="submit" class="btn btn-primary btn-lg" [disabled]="pending()">
                {{ pending() ? 'Création du compte…' : 'Créer mon compte' }}
              </button>
            </form>

            <p class="mt-4 text-xs leading-relaxed text-muted">
              Tes données ne servent qu'à faire fonctionner l'application. Tu peux les exporter ou supprimer ton compte à tout moment depuis ton profil.
            </p>
            <a routerLink="/connexion" class="mt-6 block w-full text-center text-sm font-semibold text-accent">Déjà un compte ? Se connecter</a>
          }
        }
      </div>
    </div>
  `,
})
export class SignupPage {
  private readonly api = inject(Api);
  private readonly store = inject(Store);
  private readonly router = inject(Router);

  /** `/inscription?code=…` : le lien d'invitation remplit le code. */
  readonly code = input<string>();

  protected readonly appName = APP_NAME;
  protected readonly minPassword = MIN_PASSWORD;
  protected readonly mode = signal<SignupMode | 'loading'>('loading');
  protected readonly inviteCode = linkedSignal(() => this.code() ?? '');
  protected readonly visible = signal(false);
  protected readonly pending = signal(false);
  protected readonly error = signal('');
  protected readonly exists = signal(false);
  protected readonly name = signal('');
  protected readonly email = signal('');
  protected readonly password = signal('');
  /** Les erreurs n'apparaissent qu'après un premier envoi ; ensuite elles suivent la saisie. */
  private readonly submitted = signal(false);
  /** Refus du code par le serveur : il tombe dès que le code est modifié. */
  private readonly refusedCode = linkedSignal({ source: this.inviteCode, computation: () => '' });
  protected readonly errors = computed<FieldErrors>(() => {
    if (!this.submitted()) return {};
    const errors = this.validate();
    if (!errors.code && this.refusedCode()) errors.code = this.refusedCode();
    return errors;
  });

  constructor() {
    void this.api.signupMode().then((mode) => this.mode.set(mode));
  }

  private validate(): FieldErrors {
    const email = this.email().trim();
    const password = this.password();
    const errors: FieldErrors = {};
    if (this.mode() === 'invite' && !this.inviteCode().trim()) errors.code = 'Saisis le code reçu avec ton invitation.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = email ? 'Cet email ne semble pas valide.' : 'Indique ton email.';
    if (password.length < MIN_PASSWORD) {
      const missing = MIN_PASSWORD - password.length;
      errors.password = password ? `Encore ${missing} caractère${missing > 1 ? 's' : ''}.` : `Choisis un mot de passe d'au moins ${MIN_PASSWORD} caractères.`;
    }
    return errors;
  }

  protected async submit(): Promise<void> {
    if (this.pending()) return;
    const invited = this.mode() === 'invite';
    this.submitted.set(true);
    this.refusedCode.set('');
    this.error.set('');
    this.exists.set(false);
    if (Object.keys(this.validate()).length > 0) return;

    this.pending.set(true);
    try {
      await this.api.register(this.email().trim(), this.password(), this.name().trim(), invited ? this.inviteCode().trim() : undefined);
      await this.store.refresh(true);
      await this.router.navigateByUrl('/bienvenue');
    } catch (cause) {
      if (cause instanceof OfflineError) {
        this.error.set('Impossible de joindre le serveur. Vérifie ta connexion.');
      } else if (cause instanceof ApiError && cause.status === 409) {
        this.exists.set(true);
        this.error.set('Un compte existe déjà avec cet email.');
      } else if (cause instanceof ApiError && cause.status === 403 && invited) {
        // Code refusé : on le dit sous le champ concerné.
        this.refusedCode.set(cause.message);
      } else if (cause instanceof ApiError && cause.status === 403) {
        this.mode.set('closed');
      } else if (cause instanceof ApiError && cause.status === 429) {
        this.error.set('Trop de tentatives. Réessaie dans une minute.');
      } else {
        this.error.set(cause instanceof Error ? cause.message : 'Création du compte impossible.');
      }
    } finally {
      this.pending.set(false);
    }
  }
}
