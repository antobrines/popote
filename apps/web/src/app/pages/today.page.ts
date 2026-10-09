import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { type Meal, addDays, diffDays, mondayOf } from '@bouffe/core';
import { batchRoles } from '../core/batch';
import { Store } from '../core/store';
import { Toasts } from '../core/toasts';
import { DayPipe, Icon, NumPipe, Ring } from '../ui/ui';
import { MealCard } from './meal-card';
import { MealSheet } from './meal-sheet';

@Component({
  selector: 'app-today-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Ring, Icon, NumPipe, DayPipe, MealCard, MealSheet],
  template: `
    <div class="page space-y-6">
      <header class="fade-in">
        <p class="eyebrow first-letter:uppercase">{{ store.today() | day: 'long' }}</p>
        <h1 class="title mt-1">Bonjour{{ name() ? ' ' + name() : '' }}</h1>
        @if (summary(); as s) {
          <p class="num mt-2 text-lg text-muted">
            <span class="font-semibold text-fg">{{ s.currentKg ?? s.startKg | num: 1 }} kg</span>
            → objectif {{ s.goalKg | num }} kg
          </p>
        }
      </header>

      @if (!store.state()) {
        <section class="card text-center">
          <app-icon name="wifi-off" [size]="28" class="text-muted" />
          <p class="mt-3 font-semibold">Connexion requise au premier lancement</p>
          <p class="mt-1 text-sm text-muted">Une fois chargés, ton programme et ta liste de courses restent disponibles hors ligne.</p>
          <button type="button" class="btn btn-dark mt-4" (click)="store.refresh(true)">Réessayer</button>
        </section>
      } @else {
        <section class="card fade-in" aria-label="Aujourd'hui">
          <h2 class="eyebrow mb-4">Aujourd'hui</h2>
          <div class="flex items-center justify-around gap-4">
            <app-ring
              [value]="consumed().kcal"
              [max]="target().kcal"
              [tolerance]="target().toleranceKcal"
              [label]="consumed().kcal + ' sur ' + target().kcal + ' kilocalories'"
            >
              <div>
                <p class="num text-2xl leading-none font-bold">{{ consumed().kcal | num }}</p>
                <p class="num mt-1 text-xs text-muted">/ {{ target().kcal | num }} kcal</p>
              </div>
            </app-ring>
            <app-ring [value]="consumed().protein" [max]="target().protein" color="var(--protein)" [label]="consumed().protein + ' sur ' + target().protein + ' grammes de protéines'">
              <div>
                <p class="num text-2xl leading-none font-bold">{{ consumed().protein | num }}</p>
                <p class="num mt-1 text-xs text-muted">/ {{ target().protein | num }} g prot.</p>
              </div>
            </app-ring>
          </div>
          @if (remaining(); as r) {
            <p class="num mt-4 text-center text-sm text-muted">{{ r }}</p>
          }
          @if (day(); as d) {
            @if (d.training || d.spreadKcal) {
              <div class="mt-3 flex flex-wrap justify-center gap-1.5">
                @if (d.training) {
                  <span class="badge badge-info"><app-icon name="dumbbell" [size]="12" /> Jour d'entraînement</span>
                }
                @if (d.spreadKcal) {
                  <span class="badge badge-warn">{{ d.spreadKcal }} kcal · repas libre lissé</span>
                }
              </div>
            }
          }
        </section>

        @if (reviewDue()) {
          <a routerLink="/bilan" class="card fade-in flex items-center gap-3 ring-2 ring-accent">
            <span class="grid size-11 shrink-0 place-items-center rounded-full bg-accent-soft text-accent"><app-icon name="flag" /></span>
            <span class="min-w-0 flex-1">
              <span class="block font-semibold">Bilan de la semaine</span>
              <span class="block text-sm text-muted">Ce qui a marché, puis la semaine prochaine en un geste.</span>
            </span>
            <app-icon name="chevron-right" class="text-faint" />
          </a>
        }

        @if (day(); as d) {
          <section class="space-y-3" aria-label="Repas du jour">
            @for (meal of d.meals; track meal.id; let i = $index) {
              <app-meal-card [meal]="meal" [batch]="roles().get(meal.id) ?? null" (opened)="open(i)" (toggled)="toggle(meal)" (swapped)="quickReplace(meal)" />
            }
            <p class="px-1 text-center text-xs text-faint">Glisse une carte vers la droite pour « mangé », vers la gauche pour un autre repas.</p>
          </section>

          <section class="space-y-3">
            <button type="button" class="btn btn-primary btn-lg" (click)="openNow()">
              <app-icon name="pot" />
              Voir mon repas maintenant
            </button>
            <a routerLink="/courses" class="btn btn-lg bg-card">
              <app-icon name="cart" />
              Courses de la semaine
            </a>
          </section>
        } @else {
          <section class="card fade-in text-center">
            <div class="mx-auto grid size-14 place-items-center rounded-full bg-accent-soft text-accent"><app-icon name="sparkles" [size]="28" /></div>
            <h2 class="mt-4 text-xl font-bold">Pas encore de programme cette semaine</h2>
            <p class="mt-2 text-muted">7 jours de repas au gramme près, puis ta liste de courses, en quelques secondes.</p>
            <button type="button" class="btn btn-primary btn-lg mt-5" [disabled]="store.busy()" (click)="generate()">
              {{ store.busy() ? 'Génération…' : 'Générer ma semaine' }}
            </button>
            <a routerLink="/courses" class="btn btn-lg mt-3 bg-raised"><app-icon name="cart" /> Courses de la semaine</a>
          </section>
        }

        @if (suggestion(); as s) {
          <a routerLink="/progression" class="card flex items-start gap-3">
            <app-icon name="info" class="mt-0.5 text-protein" />
            <span class="text-sm">
              <span class="font-semibold">Ajustement suggéré : {{ s.suggestedKcal | num }} kcal</span>
              <span class="mt-0.5 block text-muted">À confirmer dans Progression — rien n'est modifié sans ton accord.</span>
            </span>
          </a>
        }

        <section class="grid grid-cols-2 gap-3" aria-label="Indicateurs">
          <a routerLink="/progression" class="card">
            <p class="eyebrow">Prochaine pesée</p>
            <p class="mt-1.5 text-lg font-bold first-letter:uppercase">{{ nextWeighIn() }}</p>
          </a>
          <a routerLink="/progression" class="card">
            <p class="eyebrow">Cette semaine</p>
            <p class="num mt-1.5 text-lg font-bold">{{ weekDelta() }}</p>
          </a>
          <div class="card">
            <p class="eyebrow">Calories moyennes</p>
            <p class="num mt-1.5 text-lg font-bold">{{ averages() ? (averages()!.kcal | num) + ' kcal' : '—' }}</p>
          </div>
          <div class="card">
            <p class="eyebrow">Protéines moyennes</p>
            <p class="num mt-1.5 text-lg font-bold">{{ averages() ? (averages()!.protein | num) + ' g' : '—' }}</p>
          </div>
          @if (!reviewDue()) {
            <a routerLink="/bilan" class="card col-span-2 flex items-center gap-3">
              <app-icon name="flag" class="text-accent" />
              <span class="flex-1 text-sm font-semibold">Bilan de la semaine</span>
              <app-icon name="chevron-right" [size]="18" class="text-faint" />
            </a>
          }
          @if (activity(); as a) {
            <a routerLink="/progression" class="card col-span-2 flex items-center gap-4">
              <app-icon name="activity" class="text-accent" />
              <p class="num text-sm">
                @if (a.steps) {
                  <span class="font-semibold">{{ a.steps | num }} pas</span>
                }
                @if (a.activeKcal) {
                  <span class="text-muted"> · {{ a.activeKcal | num }} kcal actives</span>
                }
                @if (a.workouts.length) {
                  <span class="text-muted"> · {{ a.workouts.length }} séance{{ a.workouts.length > 1 ? 's' : '' }}</span>
                }
              </p>
            </a>
          }
        </section>
      }
    </div>

    @if (sheet() !== null && plan(); as p) {
      <app-meal-sheet [planId]="p.id" [dayIndex]="dayIndex()" [position]="sheet()!" (closed)="sheet.set(null)" />
    }
  `,
})
export class TodayPage {
  protected readonly store = inject(Store);
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);

  /** `?repas=maintenant` (raccourci de l'icône) ouvre directement le prochain repas. */
  readonly repas = input<string>();

  protected readonly sheet = signal<number | null>(null);
  protected readonly plan = this.store.currentPlan;
  protected readonly day = this.store.todayDay;
  protected readonly dayIndex = computed(() => this.day()?.index ?? 0);
  protected readonly consumed = this.store.consumedToday;
  protected readonly target = this.store.todayTarget;
  protected readonly roles = computed(() => batchRoles(this.plan()));
  /** Le bilan est mis en avant le week-end, quand la semaine a un programme. */
  protected readonly reviewDue = computed(() => !!this.plan() && diffDays(mondayOf(this.store.today()), this.store.today()) >= 5);
  protected readonly averages = this.store.weekAverages;
  protected readonly summary = computed(() => this.store.state()?.weightSummary ?? null);
  protected readonly name = computed(() => this.store.user()?.displayName ?? '');
  protected readonly activity = computed(() => this.store.state()?.activities.find((a) => a.date === this.store.today()) ?? null);

  protected readonly suggestion = computed(() => {
    const s = this.store.state()?.calorieSuggestion;
    return s && s.kind !== 'none' ? s : null;
  });

  protected readonly remaining = computed(() => {
    const left = this.target().kcal - this.consumed().kcal;
    if (this.consumed().kcal === 0) return null;
    if (Math.abs(left) <= this.target().toleranceKcal) return 'Objectif du jour atteint.';
    return left > 0 ? `Encore ${left.toLocaleString('fr-FR')} kcal aujourd'hui` : `${Math.abs(left).toLocaleString('fr-FR')} kcal au-dessus de la cible`;
  });

  protected readonly nextWeighIn = computed(() => {
    const today = this.store.today();
    const weighDay = this.store.user()?.preferences.weighDay ?? 0;
    const weighedToday = this.store.state()?.weights.some((w) => w.date === today);
    let date = addDays(mondayOf(today), weighDay);
    if (date < today || (date === today && weighedToday)) date = addDays(date, 7);
    if (date === today) return "Aujourd'hui";
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y!, m! - 1, d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric' });
  });

  protected readonly weekDelta = computed(() => {
    const weekly = this.summary()?.weekly ?? [];
    const last = weekly[weekly.length - 1];
    if (!last || last.deltaKg === null) return '—';
    return `${last.deltaKg > 0 ? '+' : ''}${last.deltaKg.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} kg`;
  });

  constructor() {
    effect(() => {
      if (this.repas() === 'maintenant' && this.day()) {
        this.openNow();
        void this.router.navigate([], { queryParams: {}, replaceUrl: true });
      }
    });
  }

  protected open(position: number): void {
    this.sheet.set(position);
  }

  /** Le repas « du moment » : le premier repas encore prévu, à partir du créneau horaire actuel. */
  protected openNow(): void {
    const meals = this.day()?.meals ?? [];
    if (meals.length === 0) return;
    const hour = new Date().getHours();
    const from = hour < 10 ? 'petit-dejeuner' : hour < 15 ? 'dejeuner' : hour < 18 ? 'collation' : 'diner';
    const order = ['petit-dejeuner', 'dejeuner', 'collation', 'diner'];
    const start = order.indexOf(from);
    const candidate =
      meals.findIndex((m) => m.status === 'planned' && order.indexOf(m.slot) >= start) >= 0
        ? meals.findIndex((m) => m.status === 'planned' && order.indexOf(m.slot) >= start)
        : meals.findIndex((m) => m.status === 'planned');
    this.sheet.set(candidate >= 0 ? candidate : meals.length - 1);
  }

  protected toggle(meal: Meal): void {
    const plan = this.plan();
    const day = this.day();
    if (!plan || !day) return;
    void this.store.logMeal(plan.id, meal, day.date, meal.status === 'planned' ? 'eaten' : 'planned');
  }

  /** Glissement vers la gauche : un autre repas, sans passer par le détail. */
  protected async quickReplace(meal: Meal): Promise<void> {
    const plan = this.plan();
    if (!plan || meal.status !== 'planned') return;
    if (await this.store.replaceMeal(plan.id, meal.id)) this.toasts.success('Repas remplacé, journée recalculée.');
  }

  protected generate(): void {
    void this.store.generateWeek({ weekStart: mondayOf(this.store.today()) });
  }
}
