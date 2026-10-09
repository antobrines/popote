import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { SwPush } from '@angular/service-worker';
import { DAY_LABELS, type MealSlotKind, PREP_MODE_LABELS, type PrepLevel, type PrepMode, type ShoppingStrategy, calorieFloor, cyclingTargets } from '@bouffe/core';
import { Api } from '../core/api';
import type { MealFeedback, ProviderStatus } from '../core/models';
import { Store } from '../core/store';
import { Theme, Toasts } from '../core/toasts';
import { Icon, NumPipe, Sheet } from '../ui/ui';

const EQUIPMENT: PrepMode[] = ['air-fryer', 'poele', 'four', 'rice-cooker', 'casserole', 'one-pot', 'micro-ondes'];

@Component({
  selector: 'app-profile-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Icon, NumPipe, Sheet],
  template: `
    <div class="page space-y-6">
      <header>
        <h1 class="title">Profil</h1>
        <p class="mt-2 text-muted">{{ user()?.displayName || 'Mon compte' }} · {{ user()?.email }}</p>
      </header>

      @if (user(); as u) {
        <section class="card space-y-4">
          <h2 class="eyebrow">Objectif quotidien</h2>
          <form class="grid grid-cols-2 gap-3" (ngSubmit)="saveGoal()">
            <div>
              <label class="label" for="g-kcal">Calories</label>
              <input id="g-kcal" class="input num text-lg font-semibold" name="kcal" type="number" inputmode="numeric" step="50" [(ngModel)]="goal.kcal" />
            </div>
            <div>
              <label class="label" for="g-prot">Protéines (g)</label>
              <input id="g-prot" class="input num text-lg font-semibold" name="protein" type="number" inputmode="numeric" step="5" [(ngModel)]="goal.protein" />
            </div>
            <button type="submit" class="btn btn-dark col-span-2" [disabled]="!goalChanged() || store.busy()">Mettre à jour l'objectif</button>
          </form>
          @if (floor(); as f) {
            @if ((goal.kcal ?? 0) < f) {
              <p class="rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn" role="alert">
                {{ f | num }} kcal est le plancher prudent pour ton profil. En dessous, demande l'avis d'un professionnel de santé.
              </p>
            }
          }
          <p class="text-xs text-muted">Le nouvel objectif s'applique aux prochaines semaines générées. Cette application ne fournit pas d'avis médical.</p>
        </section>

        <section class="card space-y-5">
          <h2 class="eyebrow">Mes repas</h2>
          <div>
            <p class="label">Repas de la journée</p>
            <div class="flex flex-wrap gap-2">
              @for (slot of slots; track slot.value) {
                <button type="button" class="chip" [class.on]="u.preferences.meals.includes(slot.value)" (click)="toggleMeal(slot.value)">{{ slot.label }}</button>
              }
            </div>
          </div>
          <div>
            <p class="label">Temps en cuisine</p>
            <div class="flex gap-2">
              @for (option of levels; track option.value) {
                <button type="button" class="chip flex-1 justify-center" [class.on]="u.preferences.level === option.value" (click)="patch({ level: option.value })">
                  {{ option.label }}
                </button>
              }
            </div>
          </div>
          <div>
            <p class="label">Mon équipement</p>
            <div class="flex flex-wrap gap-2">
              @for (mode of equipment; track mode) {
                <button type="button" class="chip" [class.on]="u.preferences.equipment.includes(mode)" (click)="toggleList('equipment', mode)">{{ modeLabels[mode] }}</button>
              }
            </div>
          </div>
          <label class="row cursor-pointer">
            <span>
              <span class="block font-semibold">Cuisiner une fois, manger deux fois</span>
              <span class="text-sm text-muted">Le dîner, cuisiné en double, sert de déjeuner le lendemain.</span>
            </span>
            <input type="checkbox" class="size-6 shrink-0 accent-[var(--accent)]" [checked]="!!u.preferences.cookOnce" (change)="patch({ cookOnce: !u.preferences.cookOnce })" />
          </label>
          <label class="row cursor-pointer">
            <span>
              <span class="block font-semibold">Box froides hors domicile</span>
              <span class="text-sm text-muted">J'accepte de cuisiner la veille un repas à emporter (pâtes, riz, tortilla…).</span>
            </span>
            <input type="checkbox" class="size-6 shrink-0 accent-[var(--accent)]" [checked]="!!u.preferences.awayPrepAhead" (change)="patch({ awayPrepAhead: !u.preferences.awayPrepAhead })" />
          </label>
          <p class="text-xs text-muted">Ces réglages s'appliquent aux prochaines semaines générées.</p>
        </section>

        <section class="card space-y-4">
          <h2 class="eyebrow">Jours d'entraînement</h2>
          <div class="grid grid-cols-7 gap-1">
            @for (label of dayLabels; track label; let i = $index) {
              <button type="button" class="chip justify-center !px-0" [class.on]="training()[i]" [attr.aria-pressed]="training()[i]" [attr.aria-label]="label" (click)="toggleTraining(i)">
                {{ label.slice(0, 3) }}
              </button>
            }
          </div>
          @if (cycle(); as c) {
            <div>
              <p class="label">Calories en plus ces jours-là</p>
              <div class="flex gap-2">
                @for (b of bonuses; track b) {
                  <button type="button" class="chip flex-1 justify-center num" [class.on]="bonus() === b" (click)="patch({ trainingBonusKcal: b })">+ {{ b }} kcal</button>
                }
              </div>
            </div>
            <p class="num rounded-2xl bg-raised px-4 py-3 text-sm leading-relaxed">
              <span class="font-semibold">{{ c.training | num }} kcal</span> les jours d'entraînement, <span class="font-semibold">{{ c.rest | num }} kcal</span> les jours de repos. La moyenne de
              la semaine reste à {{ c.average | num }} kcal.
              @if (c.capped) {
                <span class="mt-1 block text-warn">Le bonus est réduit pour que les jours de repos ne passent pas sous ton plancher prudent.</span>
              }
            </p>
          } @else {
            <p class="text-sm text-muted">
              {{
                trainingCount() === 7
                  ? 'Tous les jours sont cochés : la cible reste la même chaque jour.'
                  : 'Indique tes jours de sport : tu manges un peu plus ces jours-là et un peu moins les autres, pour la même moyenne sur la semaine.'
              }}
            </p>
          }
          <p class="text-xs text-muted">S'applique aux prochaines semaines générées.</p>
        </section>

        <a routerLink="/profil/aliments" class="card row">
          <span class="min-w-0">
            <span class="block text-lg font-bold">Mes aliments</span>
            <span class="num mt-0.5 block text-sm text-muted">{{ foodSummary() }}</span>
          </span>
          <app-icon name="chevron-right" class="shrink-0 text-faint" />
        </a>

        <a routerLink="/profil/recettes" class="card row">
          <span class="min-w-0">
            <span class="block text-lg font-bold">Mes recettes</span>
            <span class="num mt-0.5 block text-sm text-muted">{{ recipeSummary() }}</span>
          </span>
          <app-icon name="chevron-right" class="shrink-0 text-faint" />
        </a>

        <section class="card space-y-5">
          <h2 class="eyebrow">Mes courses</h2>
          <div>
            <label class="label" for="store-name">Magasin</label>
            @if (store.currentStore(); as s) {
              <p class="flex items-center gap-2 font-semibold"><app-icon name="store" [size]="18" /> {{ s.name }}{{ s.city ? ' · ' + s.city : '' }}</p>
            } @else {
              <form class="flex gap-2" (ngSubmit)="addStore()">
                <input id="store-name" class="input flex-1" name="store" placeholder="E.Leclerc" [(ngModel)]="newStore" />
                <button type="submit" class="btn btn-dark" [disabled]="!newStore">Ajouter</button>
              </form>
            }
          </div>
          <div>
            <p class="label">Optimiser la liste selon</p>
            <div class="flex flex-wrap gap-2">
              @for (s of strategies; track s.value) {
                <button type="button" class="chip" [class.on]="u.preferences.strategy === s.value" (click)="patch({ strategy: s.value })">{{ s.label }}</button>
              }
            </div>
          </div>
          <form class="flex items-end gap-2" (ngSubmit)="saveBudget()">
            <div class="flex-1">
              <label class="label" for="budget">Budget hebdomadaire (€)</label>
              <input id="budget" class="input num" name="budget" type="number" inputmode="decimal" min="0" step="5" placeholder="Pas de limite" [(ngModel)]="budget" />
            </div>
            <button type="submit" class="btn">OK</button>
          </form>
          <form class="flex items-end gap-2" (ngSubmit)="saveBrands()">
            <div class="flex-1">
              <label class="label" for="brands">Marques à éviter (séparées par des virgules)</label>
              <input id="brands" class="input" name="brands" [(ngModel)]="brands" />
            </div>
            <button type="submit" class="btn">OK</button>
          </form>
        </section>

        <section class="card space-y-5">
          <h2 class="eyebrow">Rappels</h2>
          <div>
            <p class="label">Jour de pesée</p>
            <div class="grid grid-cols-7 gap-1">
              @for (label of dayLabels; track label; let i = $index) {
                <button type="button" class="chip justify-center !px-0" [class.on]="u.preferences.weighDay === i" [attr.aria-label]="label" (click)="patch({ weighDay: i })">{{ label.slice(0, 3) }}</button>
              }
            </div>
          </div>
          <label class="row cursor-pointer">
            <span class="font-semibold">Rappel de pesée (8 h)</span>
            <input type="checkbox" class="size-6 accent-[var(--accent)]" [checked]="!!u.preferences.reminders?.weighIn" (change)="toggleReminder('weighIn')" />
          </label>
          <label class="row cursor-pointer">
            <span class="font-semibold">Rappel meal prep (dimanche 17 h)</span>
            <input type="checkbox" class="size-6 accent-[var(--accent)]" [checked]="!!u.preferences.reminders?.mealPrep" (change)="toggleReminder('mealPrep')" />
          </label>
          @if (pushState() === 'unsupported') {
            <p class="text-sm text-muted">Les notifications nécessitent l'application installée (version de production, HTTPS) et un navigateur compatible.</p>
          } @else {
            <button type="button" class="btn w-full" (click)="enablePush()">
              {{ pushState() === 'on' ? 'Envoyer une notification de test' : 'Activer les notifications sur cet appareil' }}
            </button>
          }
        </section>

        <section class="card space-y-4">
          <h2 class="eyebrow">Apparence</h2>
          <div class="flex gap-2">
            <button type="button" class="chip flex-1 justify-center" [class.on]="theme.mode() === 'auto'" (click)="theme.set('auto')">Auto</button>
            <button type="button" class="chip flex-1 justify-center" [class.on]="theme.mode() === 'light'" (click)="theme.set('light')"><app-icon name="sun" [size]="16" /> Clair</button>
            <button type="button" class="chip flex-1 justify-center" [class.on]="theme.mode() === 'dark'" (click)="theme.set('dark')"><app-icon name="moon" [size]="16" /> Sombre</button>
          </div>
        </section>

        @if (feedbackList().length > 0) {
          <section class="card space-y-3">
            <h2 class="eyebrow">Mes avis sur les repas</h2>
            <ul class="divide">
              @for (item of feedbackList(); track item.signature) {
                <li class="row py-2.5 text-sm">
                  <span class="min-w-0 truncate">{{ item.name }}</span>
                  <span class="flex shrink-0 items-center gap-1.5">
                    @if (item.rating) {
                      <span class="badge">{{ item.rating }} ★</span>
                    }
                    @if (item.favorite) {
                      <span class="badge badge-ok">favori</span>
                    }
                    @if (item.banned) {
                      <span class="badge badge-warn">interdit</span>
                    }
                  </span>
                </li>
              }
            </ul>
          </section>
        }

        <section class="card space-y-4">
          <h2 class="eyebrow">Intégrations</h2>
          @for (provider of integrations(); track provider.id) {
            <div>
              <div class="row">
                <h3 class="font-semibold">{{ provider.label }}</h3>
                <span class="badge" [class]="provider.available ? 'badge-ok' : 'badge-warn'">{{ provider.available ? (provider.example ? 'Démonstration' : 'Actif') : 'Non disponible' }}</span>
              </div>
              <p class="mt-1 text-sm leading-relaxed text-muted">{{ provider.explanation }}</p>
            </div>
          }
        </section>

        <section class="card space-y-4">
          <h2 class="eyebrow">Mes données</h2>
          <label class="row cursor-pointer">
            <span>
              <span class="block font-semibold">Suivi du poids et de l'activité</span>
              <span class="text-sm text-muted">Désactiver efface ces données de santé.</span>
            </span>
            <input type="checkbox" class="size-6 accent-[var(--accent)]" [checked]="u.consents.healthData" (change)="toggleConsent(u.consents.healthData)" />
          </label>
          <button type="button" class="btn w-full" (click)="exportData()"><app-icon name="download" [size]="18" /> Exporter toutes mes données (JSON)</button>
          <button type="button" class="btn w-full" (click)="logout()"><app-icon name="logout" [size]="18" /> Se déconnecter</button>
          <button type="button" class="btn btn-danger w-full" (click)="deleteSheet.set(true)"><app-icon name="trash" [size]="18" /> Supprimer mon compte</button>
          <p class="text-xs leading-relaxed text-muted">
            Tes données ne servent qu'à faire fonctionner l'application. Aucune n'est partagée ; seuls les codes-barres que tu scannes sont envoyés à Open Food Facts pour identifier
            un produit.
          </p>
        </section>
      }
    </div>

    @if (deleteSheet()) {
      <app-sheet title="Supprimer mon compte" (closed)="deleteSheet.set(false)">
        <form class="space-y-4" (ngSubmit)="deleteAccount()">
          <p class="text-muted">Toutes tes données (profil, programmes, pesées, stocks, prix, historique) seront définitivement effacées. Cette action est irréversible.</p>
          <div>
            <label class="label" for="del-pw">Mot de passe</label>
            <input id="del-pw" class="input" type="password" name="password" autocomplete="current-password" required [(ngModel)]="deletePassword" />
          </div>
          <button type="submit" class="btn btn-danger btn-lg" [disabled]="!deletePassword">Supprimer définitivement</button>
        </form>
      </app-sheet>
    }
  `,
})
export class ProfilePage {
  protected readonly store = inject(Store);
  protected readonly theme = inject(Theme);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly router = inject(Router);
  private readonly swPush = inject(SwPush, { optional: true });

  protected readonly user = this.store.user;
  protected readonly dayLabels = DAY_LABELS;
  protected readonly equipment = EQUIPMENT;
  protected readonly modeLabels = PREP_MODE_LABELS;
  protected readonly slots: { value: MealSlotKind; label: string }[] = [
    { value: 'petit-dejeuner', label: 'Petit-déjeuner' },
    { value: 'dejeuner', label: 'Déjeuner' },
    { value: 'collation', label: 'Collation' },
    { value: 'diner', label: 'Dîner' },
  ];
  protected readonly levels: { value: PrepLevel; label: string }[] = [
    { value: 'ultra-rapide', label: 'Ultra rapide' },
    { value: 'normal', label: 'Normal' },
    { value: 'meal-prep', label: 'Meal prep' },
  ];
  protected readonly strategies: { value: ShoppingStrategy; label: string }[] = [
    { value: 'cheapest', label: 'Prix total' },
    { value: 'least-waste', label: 'Moins de restes' },
    { value: 'best-unit-price', label: 'Prix au kilo' },
  ];

  protected readonly deleteSheet = signal(false);
  protected readonly pushState = signal<'unsupported' | 'off' | 'on'>(this.swPush?.isEnabled ? 'off' : 'unsupported');
  protected goal: { kcal: number | null; protein: number | null } = { kcal: this.store.goal()?.kcal ?? null, protein: this.store.goal()?.protein ?? null };
  protected budget: number | null = this.user()?.preferences.weeklyBudget ?? null;
  protected brands = (this.user()?.preferences.bannedBrands ?? []).join(', ');
  protected newStore = '';
  protected deletePassword = '';

  protected readonly feedbackList = computed<MealFeedback[]>(() => (this.user()?.preferences.mealFeedback ?? []).filter((f) => f.rating || f.favorite || f.banned));
  protected readonly integrations = computed<ProviderStatus[]>(() => {
    const i = this.store.state()?.integrations;
    return i ? [...i.retail, ...i.health] : [];
  });

  protected readonly floor = computed(() => {
    const profile = this.user()?.profile;
    const weight = this.store.state()?.weightSummary?.trendKg ?? profile?.startWeightKg;
    if (!profile || !weight) return null;
    return calorieFloor({ sex: profile.sex, age: new Date().getFullYear() - profile.birthYear, heightCm: profile.heightCm, weightKg: weight });
  });

  // ───────────── Jours d'entraînement ─────────────

  protected readonly bonuses = [100, 200, 300];
  protected readonly training = computed(() => Array.from({ length: 7 }, (_, i) => !!this.user()?.preferences.trainingDays?.[i]));
  protected readonly trainingCount = computed(() => this.training().filter(Boolean).length);
  protected readonly bonus = computed(() => this.user()?.preferences.trainingBonusKcal ?? 200);

  /** Cibles obtenues avec ces réglages — le même calcul que le générateur. */
  protected readonly cycle = computed(() => {
    const days = this.training();
    const count = this.trainingCount();
    if (count === 0 || count === 7) return null;
    const target = this.store.target();
    const targets = cyclingTargets(target, { days, bonusKcal: this.bonus(), floorKcal: this.floor() ?? undefined });
    const training = targets[days.indexOf(true)]!;
    return { training, rest: targets[days.indexOf(false)]!, average: target.kcal, capped: training - target.kcal < this.bonus() - 10 };
  });

  protected toggleTraining(index: number): void {
    this.patch({ trainingDays: this.training().map((on, i) => (i === index ? !on : on)) });
  }

  protected readonly recipeSummary = computed(() => {
    const count = this.store.state()?.customRecipes?.length ?? 0;
    return count === 0 ? 'Ajoute tes propres plats au programme' : `${count} recette${count > 1 ? 's' : ''} perso`;
  });

  constructor() {
    this.swPush?.subscription.subscribe((subscription) => {
      if (this.swPush?.isEnabled) this.pushState.set(subscription ? 'on' : 'off');
    });
  }

  protected goalChanged(): boolean {
    const current = this.store.goal();
    return !!this.goal.kcal && !!this.goal.protein && (+this.goal.kcal !== current?.kcal || +this.goal.protein !== current?.protein);
  }

  protected async saveGoal(): Promise<void> {
    if (!this.goal.kcal || !this.goal.protein) return;
    const floor = this.floor();
    if (floor && +this.goal.kcal < floor) {
      this.toasts.error(`${floor.toLocaleString('fr-FR')} kcal est le minimum proposé pour ton profil.`);
      return;
    }
    if (await this.store.setGoal(Math.round(+this.goal.kcal), Math.round(+this.goal.protein))) this.toasts.success('Objectif mis à jour.');
  }

  protected patch(preferences: Record<string, unknown>): void {
    void this.store.updateMe({ preferences });
  }

  protected toggleMeal(slot: MealSlotKind): void {
    const current = this.user()?.preferences.meals ?? [];
    const next = current.includes(slot) ? current.filter((s) => s !== slot) : [...current, slot];
    if (next.length < 2) {
      this.toasts.info('Garde au moins deux repas par jour.');
      return;
    }
    this.patch({ meals: next });
  }

  protected toggleList(key: 'equipment', value: string): void {
    const current: string[] = this.user()?.preferences[key] ?? [];
    this.patch({ [key]: current.includes(value) ? current.filter((v) => v !== value) : [...current, value] });
  }

  /** « 12 appréciés · 1 rarement · 4 refusés · sans poisson » */
  protected readonly foodSummary = computed(() => {
    const prefs = this.user()?.preferences;
    if (!prefs) return '';
    const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;
    const parts = [plural(prefs.likedFoods.length, 'apprécié')];
    if (prefs.limitedFoods?.length) parts.push(`${prefs.limitedFoods.length} rarement`);
    parts.push(plural(prefs.excludedFoods.length, 'refusé'));
    if (prefs.excludedTags.includes('poisson')) parts.push('sans poisson');
    if (prefs.excludedTags.includes('legume')) parts.push('sans légumes');
    return parts.join(' · ');
  });

  protected toggleReminder(key: 'weighIn' | 'mealPrep'): void {
    const current = this.user()?.preferences.reminders ?? { weighIn: false, mealPrep: false };
    this.patch({ reminders: { ...current, [key]: !current[key] } });
  }

  protected saveBudget(): void {
    this.patch({ weeklyBudget: this.budget ? +this.budget : null });
    this.toasts.success('Budget enregistré.');
  }

  protected saveBrands(): void {
    this.patch({
      bannedBrands: this.brands
        .split(',')
        .map((b) => b.trim())
        .filter(Boolean),
    });
    this.toasts.success('Marques enregistrées.');
  }

  protected async addStore(): Promise<void> {
    if (this.newStore.trim() && (await this.store.createStore(this.newStore.trim()))) this.newStore = '';
  }

  protected toggleConsent(current: boolean): void {
    if (current && !confirm('Désactiver le suivi efface définitivement tes pesées et ton activité. Continuer ?')) {
      void this.store.refresh();
      return;
    }
    void this.store.updateMe({ consentHealthData: !current });
  }

  protected async enablePush(): Promise<void> {
    if (!this.swPush?.isEnabled) return;
    try {
      if (this.pushState() !== 'on') {
        const { enabled, publicKey } = await this.api.get<{ enabled: boolean; publicKey: string | null }>('/push/public-key');
        if (!enabled || !publicKey) {
          this.toasts.error('Les notifications ne sont pas configurées sur ce serveur.');
          return;
        }
        const subscription = await this.swPush.requestSubscription({ serverPublicKey: publicKey });
        const json = subscription.toJSON();
        await this.api.request('POST', '/push/subscribe', { endpoint: json.endpoint, keys: json.keys });
        this.pushState.set('on');
        this.toasts.success('Notifications activées sur cet appareil.');
        return;
      }
      await this.api.request('POST', '/push/test');
      this.toasts.info('Notification de test envoyée.');
    } catch {
      this.toasts.error("Impossible d'activer les notifications (autorisation refusée ?).");
    }
  }

  protected async exportData(): Promise<void> {
    try {
      const data = await this.api.get<unknown>('/me/export');
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `bouffe-export-${this.store.today()}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      this.toasts.error("Connexion requise pour exporter tes données.");
    }
  }

  protected async logout(): Promise<void> {
    await this.store.signOut();
    await this.router.navigateByUrl('/connexion');
  }

  protected async deleteAccount(): Promise<void> {
    try {
      await this.api.request('DELETE', '/me', { password: this.deletePassword });
      await this.store.signOut();
      await this.router.navigateByUrl('/connexion');
    } catch (error) {
      this.toasts.error(error instanceof Error ? error.message : 'Suppression impossible.');
    }
  }
}
