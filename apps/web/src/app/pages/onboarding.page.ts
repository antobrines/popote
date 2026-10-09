import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  type ActivityLevel,
  type AwayMode,
  DAY_LABELS,
  DEMO_LIKED_FOODS,
  DEMO_PROFILE,
  DEMO_TARGET,
  type Food,
  type MealSlotKind,
  type Sex,
  addDays,
  bmr,
  calorieFloor,
  mondayOf,
  suggestedCalories,
  suggestedProtein,
  tdee,
} from '@bouffe/core';
import { Store } from '../core/store';
import { Icon, NumPipe } from '../ui/ui';

const STEPS = ['Taille', 'Poids', 'Objectif', 'Activité', 'Calories', 'Aliments appréciés', 'Aliments refusés', 'Repas', 'Hors domicile', 'Magasin', 'Budget'] as const;

const GROUPS: { label: string; categories: string[] }[] = [
  { label: 'Viandes, poissons, œufs', categories: ['viande', 'poisson', 'oeuf', 'charcuterie'] },
  { label: 'Féculents', categories: ['feculent', 'pain'] },
  { label: 'Laitages & fromages', categories: ['laitier', 'fromage'] },
  { label: 'Fruits & compotes', categories: ['fruit'] },
  { label: 'Oléagineux, sauces, autres', categories: ['oleagineux', 'sauce', 'matiere-grasse', 'sucrant', 'supplement', 'boisson'] },
];

@Component({
  selector: 'app-onboarding-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Icon, NumPipe],
  template: `
    <div class="page flex min-h-dvh flex-col !pb-0">
      <header class="mb-8 flex items-center gap-3">
        <button type="button" class="grid size-10 place-items-center rounded-full bg-card text-muted disabled:opacity-0" [disabled]="step() === 0" (click)="back()" aria-label="Étape précédente">
          <app-icon name="chevron-left" [size]="20" />
        </button>
        <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-raised" role="progressbar" [attr.aria-valuenow]="step() + 1" [attr.aria-valuemax]="steps.length">
          <div class="h-full rounded-full bg-accent transition-[width] duration-500 ease-soft" [style.width.%]="((step() + 1) / steps.length) * 100"></div>
        </div>
        <span class="num w-10 text-right text-xs font-semibold text-muted">{{ step() + 1 }}/{{ steps.length }}</span>
      </header>

      <div class="flex-1">
        @switch (step()) {
          @case (0) {
            <section class="fade-in space-y-6">
              <h1 class="title">Commençons par toi.</h1>
              <div class="flex gap-2">
                <button type="button" class="chip flex-1 justify-center" [class.on]="sex() === 'male'" (click)="sex.set('male')">Homme</button>
                <button type="button" class="chip flex-1 justify-center" [class.on]="sex() === 'female'" (click)="sex.set('female')">Femme</button>
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="label" for="height">Taille (cm)</label>
                  <input id="height" class="input num text-xl font-semibold" type="number" inputmode="numeric" min="120" max="230" [(ngModel)]="height" />
                </div>
                <div>
                  <label class="label" for="age">Âge</label>
                  <input id="age" class="input num text-xl font-semibold" type="number" inputmode="numeric" min="16" max="100" [(ngModel)]="age" />
                </div>
              </div>
            </section>
          }
          @case (1) {
            <section class="fade-in space-y-6">
              <h1 class="title">Ton poids actuel ?</h1>
              <div>
                <label class="label" for="weight">Poids (kg)</label>
                <input id="weight" class="input num !min-h-20 text-center text-4xl font-bold" type="number" inputmode="decimal" step="0.1" min="35" max="350" [(ngModel)]="weight" />
              </div>
              <label class="card flex cursor-pointer items-start gap-3">
                <input type="checkbox" class="mt-1 size-5 accent-[var(--accent)]" [(ngModel)]="consent" />
                <span class="text-sm">
                  <span class="font-semibold">Suivre mon poids et mon activité.</span>
                  <span class="mt-1 block text-muted">
                    Ces données de santé sont enregistrées uniquement avec ton accord, ne servent qu'à ton suivi, et peuvent être exportées ou effacées à tout moment depuis ton
                    profil.
                  </span>
                </span>
              </label>
            </section>
          }
          @case (2) {
            <section class="fade-in space-y-6">
              <h1 class="title">Ton objectif ?</h1>
              <div>
                <label class="label" for="goal">Poids visé (kg)</label>
                <input id="goal" class="input num !min-h-20 text-center text-4xl font-bold" type="number" inputmode="decimal" step="0.5" min="35" max="350" [(ngModel)]="goalWeight" />
              </div>
              @if (weight() > goalWeight()) {
                <p class="text-center text-muted">
                  <span class="num font-semibold text-fg">{{ weight() - goalWeight() | num: 1 }} kg</span> à perdre, sans précipitation.
                </p>
              }
            </section>
          }
          @case (3) {
            <section class="fade-in space-y-6">
              <h1 class="title">Ton niveau d'activité ?</h1>
              <div class="space-y-2">
                @for (option of activities; track option.value) {
                  <button
                    type="button"
                    class="card flex w-full items-center justify-between text-left transition-shadow"
                    [class]="activity() === option.value ? 'ring-2 ring-accent' : ''"
                    [attr.aria-pressed]="activity() === option.value"
                    (click)="activity.set(option.value)"
                  >
                    <span>
                      <span class="block font-semibold">{{ option.label }}</span>
                      <span class="text-sm text-muted">{{ option.hint }}</span>
                    </span>
                    @if (activity() === option.value) {
                      <app-icon name="check" class="text-accent" />
                    }
                  </button>
                }
              </div>
            </section>
          }
          @case (4) {
            <section class="fade-in space-y-6">
              <h1 class="title">Ton budget calorique.</h1>
              <p class="text-muted">
                Dépense estimée : <span class="num font-semibold text-fg">{{ expenditure() | num }} kcal</span> par jour. Un déficit modéré donnerait environ
                <button type="button" class="num font-semibold text-accent underline" (click)="kcal.set(suggestedKcal())">{{ suggestedKcal() | num }} kcal</button>.
              </p>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="label" for="kcal">Calories / jour</label>
                  <input id="kcal" class="input num text-xl font-semibold" type="number" inputmode="numeric" step="50" [(ngModel)]="kcal" />
                </div>
                <div>
                  <label class="label" for="protein">Protéines (g) / jour</label>
                  <input id="protein" class="input num text-xl font-semibold" type="number" inputmode="numeric" step="5" [(ngModel)]="protein" />
                </div>
              </div>
              @if (kcal() < floor()) {
                <p class="rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn" role="alert">
                  En dessous de {{ floor() | num }} kcal, le déficit devient trop important pour ton profil. L'application ne proposera jamais de descendre plus bas ; pour un régime plus strict,
                  demande l'avis d'un professionnel de santé.
                </p>
              }
              <p class="text-xs text-muted">Estimations (Mifflin-St Jeor) à titre indicatif : cette application ne fournit pas d'avis médical.</p>
            </section>
          }
          @case (5) {
            <section class="fade-in space-y-5">
              <h1 class="title">Ce que tu aimes.</h1>
              <p class="text-muted">Ces aliments reviendront plus souvent dans tes repas.</p>
              @for (group of groups(); track group.label) {
                <div>
                  <p class="eyebrow mb-2">{{ group.label }}</p>
                  <div class="flex flex-wrap gap-2">
                    @for (food of group.foods; track food.id) {
                      <button type="button" class="chip" [class.on]="liked().has(food.id)" [attr.aria-pressed]="liked().has(food.id)" (click)="toggleLiked(food.id)">
                        {{ food.name }}
                      </button>
                    }
                  </div>
                </div>
              }
            </section>
          }
          @case (6) {
            <section class="fade-in space-y-5">
              <h1 class="title">Ce que tu refuses.</h1>
              <label class="card flex cursor-pointer items-center justify-between gap-3">
                <span>
                  <span class="block font-semibold">Pas de légumes</span>
                  <span class="text-sm text-muted">Fruits, compotes, féculents complets et oléagineux prendront le relais pour les fibres.</span>
                </span>
                <input type="checkbox" class="size-6 accent-[var(--accent)]" [(ngModel)]="noVegetables" />
              </label>
              <label class="card flex cursor-pointer items-center justify-between gap-3">
                <span>
                  <span class="block font-semibold">Pas de poisson</span>
                  <span class="text-sm text-muted">Ni poisson frais, ni surgelé, ni en conserve.</span>
                </span>
                <input type="checkbox" class="size-6 accent-[var(--accent)]" [(ngModel)]="noFish" />
              </label>
              <p class="text-muted">Touche un aliment pour ne jamais le voir dans ton programme.</p>
              @for (group of groups(); track group.label) {
                <div>
                  <p class="eyebrow mb-2">{{ group.label }}</p>
                  <div class="flex flex-wrap gap-2">
                    @for (food of group.foods; track food.id) {
                      <button
                        type="button"
                        class="chip"
                        [class]="excluded().has(food.id) ? '!bg-danger !text-white line-through' : ''"
                        [attr.aria-pressed]="excluded().has(food.id)"
                        (click)="toggleExcluded(food.id)"
                      >
                        {{ food.name }}
                      </button>
                    }
                  </div>
                </div>
              }
            </section>
          }
          @case (7) {
            <section class="fade-in space-y-6">
              <h1 class="title">Tes repas de la journée.</h1>
              <div class="space-y-2">
                @for (slot of slots; track slot.value) {
                  <label class="card flex cursor-pointer items-center justify-between">
                    <span class="font-semibold">{{ slot.label }}</span>
                    <input type="checkbox" class="size-6 accent-[var(--accent)]" [checked]="meals().has(slot.value)" (change)="toggleMeal(slot.value)" />
                  </label>
                }
              </div>
              <div>
                <p class="eyebrow mb-2">Temps en cuisine</p>
                <div class="flex gap-2">
                  @for (option of levels; track option.value) {
                    <button type="button" class="chip flex-1 justify-center" [class.on]="level() === option.value" (click)="level.set(option.value)">{{ option.label }}</button>
                  }
                </div>
              </div>
            </section>
          }
          @case (8) {
            <section class="fade-in space-y-6">
              <h1 class="title">Des jours hors de chez toi ?</h1>
              <p class="text-muted">Ces jours-là, tes repas seront transportables et sans cuisine. Touche un jour pour changer.</p>
              <div class="space-y-2">
                @for (label of dayLabels; track label; let i = $index) {
                  <button type="button" class="card flex w-full items-center justify-between text-left" (click)="cycleAway(i)">
                    <span class="font-semibold">{{ label }}</span>
                    <span class="badge" [class]="away()[i] === 'none' ? '' : 'badge-info'">{{ awayLabel(away()[i]!) }}</span>
                  </button>
                }
              </div>
            </section>
          }
          @case (9) {
            <section class="fade-in space-y-6">
              <h1 class="title">Où fais-tu tes courses ?</h1>
              <div>
                <label class="label" for="store">Magasin</label>
                <input id="store" class="input" [(ngModel)]="storeName" maxlength="80" />
              </div>
              <div>
                <label class="label" for="city">Ville (facultatif)</label>
                <input id="city" class="input" [(ngModel)]="storeCity" maxlength="80" />
              </div>
              <p class="rounded-2xl bg-card p-4 text-sm text-muted">
                Aucune enseigne ne fournit aujourd'hui de prix en ligne à cette application : la liste démarre avec des prix estimés, que tu remplaces par les vrais au fil de
                tes courses (saisie ou scan). Ils sont mémorisés pour ton magasin.
              </p>
            </section>
          }
          @case (10) {
            <section class="fade-in space-y-6">
              <h1 class="title">Un budget courses ?</h1>
              <div>
                <label class="label" for="budget">Budget hebdomadaire en € (facultatif)</label>
                <input id="budget" class="input num text-xl font-semibold" type="number" inputmode="decimal" min="0" step="5" placeholder="Pas de limite" [(ngModel)]="budget" />
              </div>
              <p class="text-muted">Avec un budget, les repas les plus chers reviennent moins souvent.</p>
            </section>
          }
        }
      </div>

      <footer class="sticky bottom-0 -mx-5 mt-8 bg-bg/90 px-5 pt-3 backdrop-blur-xl" style="padding-bottom: calc(env(safe-area-inset-bottom) + 1rem)">
        @if (step() < steps.length - 1) {
          <button type="button" class="btn btn-dark btn-lg" [disabled]="!valid()" (click)="next()">Continuer</button>
        } @else {
          <button type="button" class="btn btn-primary btn-lg" [disabled]="pending()" (click)="finish()">
            <app-icon name="sparkles" />
            {{ pending() ? 'Création de ta semaine…' : 'Créer ma semaine' }}
          </button>
        }
      </footer>
    </div>
  `,
})
export class OnboardingPage {
  private readonly store = inject(Store);
  private readonly router = inject(Router);

  protected readonly steps = STEPS;
  protected readonly dayLabels = DAY_LABELS;
  protected readonly step = signal(0);
  protected readonly pending = signal(false);

  // Pré-rempli avec le profil de démonstration : il suffit d'ajuster.
  protected readonly sex = signal<Sex>(DEMO_PROFILE.sex);
  protected readonly height = signal<number>(DEMO_PROFILE.heightCm);
  protected readonly age = signal<number>(DEMO_PROFILE.age);
  protected readonly weight = signal<number>(DEMO_PROFILE.startWeightKg);
  protected readonly goalWeight = signal<number>(DEMO_PROFILE.goalWeightKg);
  protected readonly activity = signal<ActivityLevel>(DEMO_PROFILE.activity);
  protected readonly kcal = signal<number>(DEMO_TARGET.kcal);
  protected readonly protein = signal<number>(DEMO_TARGET.protein);
  protected readonly consent = signal(true);
  protected readonly liked = signal(new Set<string>(DEMO_LIKED_FOODS));
  protected readonly excluded = signal(new Set<string>());
  protected readonly noVegetables = signal(true);
  protected readonly noFish = signal(false);
  protected readonly meals = signal(new Set<MealSlotKind>(['dejeuner', 'collation', 'diner']));
  protected readonly level = signal<'ultra-rapide' | 'normal' | 'meal-prep'>('normal');
  protected readonly away = signal<AwayMode[]>(Array(7).fill('none'));
  protected readonly storeName = signal('E.Leclerc');
  protected readonly storeCity = signal('');
  protected readonly budget = signal<number | null>(null);

  protected readonly activities: { value: ActivityLevel; label: string; hint: string }[] = [
    { value: 'sedentary', label: 'Sédentaire', hint: 'Travail assis, peu de marche' },
    { value: 'light', label: 'Légèrement actif', hint: 'Marche quotidienne, 1 à 2 séances par semaine' },
    { value: 'moderate', label: 'Actif', hint: '3 à 5 séances par semaine' },
    { value: 'active', label: 'Très actif', hint: 'Travail physique ou sport quotidien' },
  ];
  protected readonly slots: { value: MealSlotKind; label: string }[] = [
    { value: 'petit-dejeuner', label: 'Petit-déjeuner' },
    { value: 'dejeuner', label: 'Déjeuner' },
    { value: 'collation', label: 'Collation' },
    { value: 'diner', label: 'Dîner' },
  ];
  protected readonly levels = [
    { value: 'ultra-rapide' as const, label: 'Ultra rapide' },
    { value: 'normal' as const, label: 'Normal' },
    { value: 'meal-prep' as const, label: 'Meal prep' },
  ];

  private readonly body = computed(() => ({ sex: this.sex(), age: +this.age(), heightCm: +this.height(), weightKg: +this.weight(), activity: this.activity() }));
  protected readonly expenditure = computed(() => tdee(this.body()));
  protected readonly suggestedKcal = computed(() => suggestedCalories(this.body()));
  protected readonly floor = computed(() => calorieFloor(this.body()));
  protected readonly baseline = computed(() => bmr(this.body()));

  protected readonly groups = computed(() =>
    GROUPS.map((group) => ({
      label: group.label,
      foods: this.store.foodList().filter((f: Food) => group.categories.includes(f.category) && !(this.noFish() && f.category === 'poisson')),
    })).filter((g) => g.foods.length > 0),
  );

  protected readonly valid = computed(() => {
    switch (this.step()) {
      case 0:
        return +this.height() >= 120 && +this.height() <= 230 && +this.age() >= 16 && +this.age() <= 100;
      case 1:
        return +this.weight() >= 35 && +this.weight() <= 350;
      case 2:
        return +this.goalWeight() >= 35 && +this.goalWeight() <= 350;
      case 4:
        return +this.kcal() >= this.floor() && +this.kcal() <= 6000 && +this.protein() >= 40 && +this.protein() <= 400;
      case 7:
        return this.meals().size >= 2;
      case 9:
        return this.storeName().trim().length > 0;
      default:
        return true;
    }
  });

  protected awayLabel(mode: AwayMode): string {
    return mode === 'full' ? 'Toute la journée' : mode === 'lunch' ? 'Midi et collation' : 'À la maison';
  }

  protected cycleAway(index: number): void {
    const order: AwayMode[] = ['none', 'lunch', 'full'];
    this.away.update((list) => list.map((mode, i) => (i === index ? order[(order.indexOf(mode) + 1) % 3]! : mode)));
  }

  private toggle<T>(set: Set<T>, value: T): Set<T> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  protected toggleLiked(id: string): void {
    this.liked.update((s) => this.toggle(s, id));
    this.excluded.update((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  }

  protected toggleExcluded(id: string): void {
    this.excluded.update((s) => this.toggle(s, id));
    this.liked.update((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  }

  protected toggleMeal(slot: MealSlotKind): void {
    this.meals.update((s) => this.toggle(s, slot));
  }

  protected back(): void {
    this.step.update((s) => Math.max(0, s - 1));
  }

  protected next(): void {
    if (this.step() === 3 && this.kcal() === DEMO_TARGET.kcal && this.protein() === DEMO_TARGET.protein) {
      // Si le profil a changé, on repart d'une proposition adaptée plutôt que des valeurs de démonstration.
      const changed = +this.weight() !== DEMO_PROFILE.startWeightKg || +this.height() !== DEMO_PROFILE.heightCm || this.sex() !== DEMO_PROFILE.sex;
      if (changed) {
        this.kcal.set(this.suggestedKcal());
        this.protein.set(suggestedProtein(+this.goalWeight(), this.suggestedKcal()));
      }
    }
    this.step.update((s) => Math.min(STEPS.length - 1, s + 1));
    window.scrollTo({ top: 0 });
  }

  protected async finish(): Promise<void> {
    this.pending.set(true);
    const budget = this.budget();
    const ok = await this.store.onboard({
      profile: { ...this.body(), goalWeightKg: +this.goalWeight() },
      target: { kcal: Math.round(+this.kcal()), protein: Math.round(+this.protein()) },
      preferences: {
        likedFoods: [...this.liked()].filter((id) => !(this.noFish() && this.store.foods().get(id)?.category === 'poisson')),
        excludedFoods: [...this.excluded()],
        excludedTags: [...(this.noVegetables() ? ['legume'] : []), ...(this.noFish() ? ['poisson'] : [])],
        meals: [...this.meals()],
        awayDays: this.away(),
        level: this.level(),
        weeklyBudget: budget ? +budget : null,
      },
      store: { name: this.storeName().trim(), city: this.storeCity().trim() || undefined },
      consentHealthData: this.consent(),
    });
    if (ok) {
      // Le samedi et le dimanche, on prépare la semaine qui vient.
      const today = this.store.today();
      const weekend = new Date(`${today}T12:00:00`).getDay() % 6 === 0;
      const weekStart = weekend ? addDays(mondayOf(today), 7) : mondayOf(today);
      await this.store.generateWeek({ weekStart, away: this.away(), level: this.level() });
      if (weekend) this.store.week.set('next');
      await this.router.navigateByUrl('/programme');
    }
    this.pending.set(false);
  }
}
