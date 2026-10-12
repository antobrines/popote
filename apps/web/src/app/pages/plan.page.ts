import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  type AwayMode,
  DAY_LABELS,
  type Meal,
  type MealPlanDay,
  type MealStyle,
  type Nutrients,
  type PrepLevel,
  SLOT_SHORT_LABELS,
  compactMeal,
  dayTargetKcal,
  planTableText,
} from '@bouffe/core';
import { Api } from '../core/api';
import { batchRoles } from '../core/batch';
import type { PlanJson } from '../core/models';
import { Store } from '../core/store';
import { Toasts } from '../core/toasts';
import { Bar, DayPipe, Icon, NumPipe, Sheet } from '../ui/ui';
import { MealCard } from './meal-card';
import { MealSheet } from './meal-sheet';

interface HistoryItem {
  id: string;
  weekStart: string;
  averages: Nutrients;
  meals: string[];
}

const STYLES: { value: MealStyle; label: string; hint: string }[] = [
  { value: 'simple', label: 'Simple', hint: 'Viande, féculent, laitage ou fruit. Une ligne par repas, pas de recette.' },
  { value: 'cuisine', label: 'Cuisiné', hint: 'Des plats avec une recette : bolognaise, curry, gratin…' },
];

const AWAY_OPTIONS: { value: AwayMode; label: string }[] = [
  { value: 'none', label: 'À la maison' },
  { value: 'lunch', label: 'Absent le midi' },
  { value: 'full', label: 'Absent la journée' },
];

@Component({
  selector: 'app-plan-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, Bar, NumPipe, DayPipe, Sheet, MealCard, MealSheet],
  template: `
    <div class="page space-y-6">
      <header>
        <div class="row">
          <h1 class="title">Programme</h1>
          @if (plan()) {
            <div class="flex rounded-full bg-raised p-1" role="tablist" aria-label="Affichage">
              <button type="button" role="tab" class="grid h-9 w-11 place-items-center rounded-full transition-colors" [class]="view() === 'day' ? 'bg-card shadow-sm' : 'text-muted'" [attr.aria-selected]="view() === 'day'" (click)="setView('day')" aria-label="Vue jour">
                <app-icon name="list" [size]="18" />
              </button>
              <button type="button" role="tab" class="grid h-9 w-11 place-items-center rounded-full transition-colors" [class]="view() === 'week' ? 'bg-card shadow-sm' : 'text-muted'" [attr.aria-selected]="view() === 'week'" (click)="setView('week')" aria-label="Tableau de la semaine">
                <app-icon name="grid" [size]="18" />
              </button>
            </div>
          }
        </div>
        <div class="mt-4 flex gap-2">
          <button type="button" class="chip" [class.on]="store.week() === 'current'" (click)="store.week.set('current')">Cette semaine</button>
          <button type="button" class="chip" [class.on]="store.week() === 'next'" (click)="store.week.set('next')">Semaine prochaine</button>
        </div>
      </header>

      @if (plan(); as p) {
        @if (view() === 'week') {
          <section class="space-y-2.5" aria-label="Semaine entière">
            <div class="flex flex-wrap items-center gap-2">
              <button type="button" class="chip" (click)="copyTable(p)"><app-icon name="list" [size]="16" /> Copier le tableau</button>
              <button type="button" class="chip" [class.on]="swapMode()" [attr.aria-pressed]="swapMode()" (click)="toggleSwap()"><app-icon name="swap" [size]="16" /> Échanger</button>
            </div>
            <p class="px-1 text-sm text-muted" aria-live="polite">
              {{ swapMode() ? (swapFirst() ? 'Touche le repas à mettre à la place.' : 'Touche le premier repas à échanger.') : 'Touche un repas pour le détail, le cadenas pour le garder.' }}
            </p>
            @for (d of p.days; track d.index) {
              <div class="card overflow-hidden !p-0" [class]="d.date === store.today() ? 'ring-2 ring-accent' : ''">
                <div class="row px-4 pt-3 pb-1.5">
                  <p class="flex items-center gap-1.5 font-bold">
                    {{ dayLabels[d.index] }} <span class="num text-sm font-normal text-muted">{{ d.date.slice(8) }}</span>
                    @if (d.training) {
                      <app-icon name="dumbbell" [size]="14" class="text-protein" />
                    }
                    @if (d.away !== 'none') {
                      <app-icon name="bag" [size]="14" class="text-protein" />
                    }
                  </p>
                  <p class="num text-xs text-muted">{{ d.nutrition.kcal | num }} kcal · {{ d.nutrition.protein | num }} g</p>
                </div>
                <ul class="divide">
                  @for (meal of d.meals; track meal.id; let i = $index) {
                    <li class="flex items-stretch" [class]="rowClass(meal)">
                      <button
                        type="button"
                        class="flex min-w-0 flex-1 items-baseline gap-3 py-2.5 pr-2 pl-4 text-left"
                        [attr.aria-label]="shortLabels[meal.slot] + ' : ' + (lines().get(meal.id) ?? meal.name)"
                        (click)="tapCell(p, d.index, i, meal)"
                      >
                        <span class="w-[3.75rem] shrink-0 text-xs font-semibold opacity-60">{{ shortLabels[meal.slot] }}</span>
                        <span class="min-w-0 flex-1">
                          @if (p.style !== 'simple' && !meal.free) {
                            <span class="block text-sm leading-snug font-semibold">{{ meal.name }}</span>
                          }
                          <span class="block leading-snug" [class]="p.style === 'simple' || meal.free ? 'text-[0.9375rem]' : 'text-[0.8125rem] opacity-70'">{{ lines().get(meal.id) }}</span>
                        </span>
                      </button>
                      @if (meal.status === 'planned' && !swapMode()) {
                        <button
                          type="button"
                          class="grid w-11 shrink-0 place-items-center transition-colors"
                          [class]="meal.locked ? 'text-fg' : 'text-faint'"
                          [attr.aria-label]="(meal.locked ? 'Ne plus garder ' : 'Garder ') + meal.name"
                          [attr.aria-pressed]="!!meal.locked"
                          (click)="toggleLock(p, meal)"
                        >
                          <app-icon [name]="meal.locked ? 'lock' : 'unlock'" [size]="16" [stroke]="meal.locked ? 2.4 : 1.8" />
                        </button>
                      } @else if (meal.status === 'eaten') {
                        <span class="grid w-11 shrink-0 place-items-center text-accent" aria-label="Mangé"><app-icon name="check" [size]="16" [stroke]="2.4" /></span>
                      }
                    </li>
                  }
                </ul>
              </div>
            }
            @if (lockedCount() > 0) {
              <p class="px-1 text-sm text-muted">
                {{ lockedCount() }} repas gardé{{ lockedCount() > 1 ? 's' : '' }} : {{ lockedCount() > 1 ? 'ils resteront' : 'il restera' }} en place si tu régénères la semaine.
              </p>
            }
          </section>
        } @else {
          <nav class="grid grid-cols-7 gap-1.5" aria-label="Jours de la semaine">
            @for (d of p.days; track d.index) {
              <button
                type="button"
                class="flex flex-col items-center gap-1 rounded-2xl py-2.5 transition-colors"
                [class]="selected() === d.index ? 'bg-fg text-bg' : d.date === store.today() ? 'bg-accent-soft text-accent' : 'bg-card text-fg'"
                [attr.aria-pressed]="selected() === d.index"
                [attr.aria-label]="dayLabels[d.index] + ', ' + d.nutrition.kcal + ' kilocalories'"
                (click)="selected.set(d.index)"
              >
                <span class="text-[0.6875rem] font-semibold opacity-70">{{ dayLabels[d.index]!.slice(0, 3) }}</span>
                <span class="num text-base font-bold">{{ d.date.slice(8) }}</span>
                <span class="flex h-1.5 gap-0.5">
                  @for (meal of d.meals; track meal.id) {
                    <span class="size-1.5 rounded-full" [class]="dot(meal)"></span>
                  }
                </span>
              </button>
            }
          </nav>

          @if (day(); as d) {
            <section class="card space-y-4">
              <div class="row">
                <h2 class="text-lg font-bold first-letter:uppercase">{{ d.date | day: 'long' }}</h2>
                <button type="button" class="badge" [class.badge-info]="d.away !== 'none'" (click)="awaySheet.set(true)">
                  <app-icon [name]="d.away === 'none' ? 'home' : 'bag'" [size]="12" />
                  {{ awayLabel(d.away) }}
                </button>
              </div>
              @if (d.training || d.spreadKcal) {
                <div class="flex flex-wrap gap-1.5">
                  @if (d.training) {
                    <span class="badge badge-info"><app-icon name="dumbbell" [size]="12" /> Entraînement · {{ dayKcal(p, d) | num }} kcal</span>
                  }
                  @if (d.spreadKcal) {
                    <span class="badge badge-warn">{{ d.spreadKcal }} kcal · repas libre lissé</span>
                  }
                </div>
              }
              <div class="space-y-3">
                <div>
                  <div class="row mb-1.5 text-sm">
                    <span class="text-muted">Calories</span>
                    <span class="num font-semibold">{{ actual().kcal | num }} / {{ dayKcal(p, d) | num }} kcal</span>
                  </div>
                  <app-bar [value]="actual().kcal" [max]="dayKcal(p, d)" />
                </div>
                <div>
                  <div class="row mb-1.5 text-sm">
                    <span class="text-muted">Protéines</span>
                    <span class="num font-semibold">{{ actual().protein | num }} / {{ p.target.protein | num }} g</span>
                  </div>
                  <app-bar [value]="actual().protein" [max]="p.target.protein" color="var(--protein)" />
                </div>
              </div>
              <p class="num border-t border-line pt-3 text-sm text-muted">
                Prévu : <span class="font-semibold text-fg">{{ d.nutrition.kcal | num }} kcal</span> · {{ d.nutrition.protein | num }} g protéines · {{ d.nutrition.carbs | num }} g
                glucides · {{ d.nutrition.fat | num }} g lipides · {{ d.nutrition.fiber | num }} g fibres
              </p>
            </section>

            <section class="space-y-3">
              @for (meal of d.meals; track meal.id; let i = $index) {
                <app-meal-card [meal]="meal" [detailed]="true" [batch]="roles().get(meal.id) ?? null" (opened)="sheet.set(i)" (toggled)="toggle(d, meal)" (swapped)="quickReplace(p, meal)" />
              }
              @if (canRebalance()) {
                <button type="button" class="btn w-full bg-card" (click)="store.rebalance(p.id, d.index)">
                  <app-icon name="refresh" [size]="18" />
                  Recalculer le reste de la journée
                </button>
              }
            </section>
          }
        }

        <section class="card space-y-3">
          <h2 class="eyebrow">Moyenne de la semaine</h2>
          <div class="grid grid-cols-4 gap-2 text-center">
            <div>
              <p class="num text-lg font-bold">{{ p.averages.kcal | num }}</p>
              <p class="text-xs text-muted">kcal</p>
            </div>
            <div>
              <p class="num text-lg font-bold text-protein">{{ p.averages.protein | num }}</p>
              <p class="text-xs text-muted">protéines</p>
            </div>
            <div>
              <p class="num text-lg font-bold">{{ p.averages.fat | num }}</p>
              <p class="text-xs text-muted">lipides</p>
            </div>
            <div>
              <p class="num text-lg font-bold">{{ p.averages.fiber | num }}</p>
              <p class="text-xs text-muted">fibres</p>
            </div>
          </div>
        </section>

        @for (warning of p.warnings; track warning.code) {
          <section class="flex gap-3 rounded-3xl p-4 text-sm" [class]="warning.severity === 'warning' ? 'bg-warn-soft text-warn' : 'bg-card text-muted'" role="note">
            <app-icon [name]="warning.severity === 'warning' ? 'alert' : 'info'" [size]="20" class="mt-0.5" />
            <p class="leading-relaxed">{{ warning.message }}</p>
          </section>
        }

        <section class="grid grid-cols-2 gap-3">
          <a routerLink="/programme/meal-prep" [queryParams]="{ from: selected() }" class="btn bg-card"><app-icon name="pot" [size]="18" /> Meal prep 3 jours</a>
          <a routerLink="/courses" class="btn bg-card"><app-icon name="cart" [size]="18" /> Faire mes courses</a>
          <a routerLink="/bilan" class="btn bg-card"><app-icon name="flag" [size]="18" /> Bilan</a>
          <a routerLink="/programme/imprimer" class="btn bg-card"><app-icon name="printer" [size]="18" /> Export PDF</a>
          <button type="button" class="btn bg-card" (click)="share(p)"><app-icon name="share" [size]="18" /> Partager</button>
          <button type="button" class="btn bg-card" (click)="openHistory()"><app-icon name="clock" [size]="18" /> Historique</button>
          <button type="button" class="btn btn-dark col-span-2" (click)="openGenerate()"><app-icon name="refresh" [size]="18" /> Régénérer la semaine</button>
        </section>
      } @else {
        <section class="card fade-in text-center">
          <div class="mx-auto grid size-14 place-items-center rounded-full bg-accent-soft text-accent"><app-icon name="sparkles" [size]="28" /></div>
          <h2 class="mt-4 text-xl font-bold">{{ store.week() === 'next' ? 'Prépare la semaine prochaine' : 'Aucun programme cette semaine' }}</h2>
          <p class="mt-2 text-muted">Un programme différent de la semaine précédente, calculé à partir de tes préférences et de tes stocks.</p>
          <button type="button" class="btn btn-primary btn-lg mt-5" (click)="openGenerate()">Générer ma semaine</button>
          <button type="button" class="mt-4 text-sm font-semibold text-accent" (click)="openHistory()">Voir l'historique</button>
        </section>
      }
    </div>

    @if (sheet() !== null && plan(); as p) {
      <app-meal-sheet [planId]="p.id" [dayIndex]="selected()" [position]="sheet()!" (closed)="sheet.set(null)" />
    }

    @if (awaySheet() && plan(); as p) {
      <app-sheet title="Ce jour-là" (closed)="awaySheet.set(false)">
        <div class="space-y-2">
          @for (option of awayOptions; track option.value) {
            <button type="button" class="card row w-full text-left" [class]="day()?.away === option.value ? 'ring-2 ring-accent' : ''" (click)="setAway(p, option.value)">
              <span class="font-semibold">{{ option.label }}</span>
              @if (day()?.away === option.value) {
                <app-icon name="check" class="text-accent" />
              }
            </button>
          }
          <p class="px-1 pt-2 text-sm text-muted">Hors de chez toi, les repas deviennent transportables et sans cuisine. Les repas de ce jour sont recalculés.</p>
        </div>
      </app-sheet>
    }

    @if (generateSheet()) {
      <app-sheet title="Générer ma semaine" (closed)="generateSheet.set(false)">
        <div class="space-y-5">
          <p class="text-muted">Semaine du {{ store.weekStart() | day }}</p>
          <div>
            <p class="eyebrow mb-2">Style des repas</p>
            <div class="grid grid-cols-2 gap-2">
              @for (option of styles; track option.value) {
                <button
                  type="button"
                  class="rounded-2xl bg-card px-4 py-3 text-left"
                  [class]="style() === option.value ? 'ring-2 ring-accent' : ''"
                  [attr.aria-pressed]="style() === option.value"
                  (click)="style.set(option.value)"
                >
                  <span class="block font-semibold">{{ option.label }}</span>
                  <span class="mt-0.5 block text-xs leading-snug text-muted">{{ option.hint }}</span>
                </button>
              }
            </div>
          </div>
          <div>
            <p class="eyebrow mb-2">Jours hors domicile</p>
            <div class="space-y-1.5">
              @for (label of dayLabels; track label; let i = $index) {
                <button type="button" class="row w-full rounded-2xl bg-card px-4 py-3 text-left" (click)="cycleAway(i)">
                  <span class="font-medium">{{ label }}</span>
                  <span class="badge" [class.badge-info]="away()[i] !== 'none'">{{ awayLabel(away()[i]!) }}</span>
                </button>
              }
            </div>
          </div>
          <div>
            <p class="eyebrow mb-2">Temps en cuisine</p>
            <div class="flex gap-2">
              @for (option of levels; track option.value) {
                <button type="button" class="chip flex-1 justify-center" [class.on]="level() === option.value" (click)="level.set(option.value)">{{ option.label }}</button>
              }
            </div>
          </div>
          <div class="space-y-2">
            <button type="button" class="row w-full rounded-2xl bg-card px-4 py-3 text-left" [attr.aria-pressed]="cookOnce()" (click)="cookOnce.set(!cookOnce())">
              <span>
                <span class="block font-medium">Cuisiner une fois, manger deux fois</span>
                <span class="text-sm text-muted">Le dîner, cuisiné en double, sert de déjeuner le lendemain.</span>
              </span>
              <span class="grid size-7 shrink-0 place-items-center rounded-full" [class]="cookOnce() ? 'bg-accent text-on-accent' : 'bg-raised text-transparent'"><app-icon name="check" [size]="16" [stroke]="2.6" /></span>
            </button>
            <button type="button" class="row w-full rounded-2xl bg-card px-4 py-3 text-left" [attr.aria-pressed]="prepAhead()" (click)="prepAhead.set(!prepAhead())">
              <span>
                <span class="block font-medium">Box froides hors domicile</span>
                <span class="text-sm text-muted">J'accepte de cuisiner la veille un repas à emporter.</span>
              </span>
              <span class="grid size-7 shrink-0 place-items-center rounded-full" [class]="prepAhead() ? 'bg-accent text-on-accent' : 'bg-raised text-transparent'"><app-icon name="check" [size]="16" [stroke]="2.6" /></span>
            </button>
          </div>
          @if (plan()) {
            <p class="rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">
              Un programme existe déjà : les jours passés, ceux où tu as déclaré des repas et
              {{ lockedCount() > 0 ? 'tes ' + lockedCount() + ' repas gardé' + (lockedCount() > 1 ? 's' : '') : 'les repas marqués d’un cadenas' }} sont conservés, le reste est remplacé.
            </p>
          }
          <button type="button" class="btn btn-primary btn-lg" [disabled]="store.busy()" (click)="generate()">
            <app-icon name="sparkles" />
            {{ store.busy() ? 'Génération…' : 'Générer ma semaine' }}
          </button>
        </div>
      </app-sheet>
    }

    @if (historySheet()) {
      <app-sheet title="Historique des semaines" (closed)="historySheet.set(false)">
        <div class="space-y-3">
          @for (item of history(); track item.id) {
            <article class="card">
              <div class="row">
                <h3 class="font-semibold">Semaine du {{ item.weekStart | day }}</h3>
                <span class="num text-sm text-muted">{{ item.averages.kcal | num }} kcal · {{ item.averages.protein | num }} g</span>
              </div>
              <p class="mt-2 text-sm text-muted">{{ item.meals.join(' · ') }}</p>
            </article>
          } @empty {
            <p class="text-muted">{{ historyLoading() ? 'Chargement…' : 'Aucune semaine enregistrée pour le moment.' }}</p>
          }
        </div>
      </app-sheet>
    }
  `,
})
export class PlanPage {
  protected readonly store = inject(Store);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly router = inject(Router);

  /** `?generer=1` (depuis le bilan) ouvre directement la feuille de génération. */
  readonly generer = input<string>();

  protected readonly dayLabels = DAY_LABELS;
  protected readonly shortLabels = SLOT_SHORT_LABELS;
  protected readonly styles = STYLES;
  protected readonly awayOptions = AWAY_OPTIONS;
  protected readonly levels: { value: PrepLevel; label: string }[] = [
    { value: 'ultra-rapide', label: 'Ultra rapide' },
    { value: 'normal', label: 'Normal' },
    { value: 'meal-prep', label: 'Meal prep' },
  ];

  protected readonly plan = this.store.plan;
  protected readonly view = signal<'day' | 'week'>(this.readView());
  protected readonly selected = signal(0);
  protected readonly sheet = signal<number | null>(null);
  protected readonly awaySheet = signal(false);
  protected readonly generateSheet = signal(false);
  protected readonly historySheet = signal(false);
  protected readonly history = signal<HistoryItem[]>([]);
  protected readonly historyLoading = signal(false);
  protected readonly away = signal<AwayMode[]>(Array(7).fill('none'));
  protected readonly level = signal<PrepLevel>('normal');
  protected readonly style = signal<MealStyle>('simple');
  protected readonly cookOnce = signal(false);
  protected readonly prepAhead = signal(false);
  protected readonly swapMode = signal(false);
  protected readonly swapFirst = signal<Meal | null>(null);

  private readonly weekKey = computed(() => this.plan()?.weekStart ?? this.store.week());
  protected readonly day = computed<MealPlanDay | null>(() => this.plan()?.days[this.selected()] ?? null);
  protected readonly roles = computed(() => batchRoles(this.plan()));
  /** Chaque repas de la semaine sur une ligne : « 250 g poulet + 100 g riz cru + 10 g beurre ». */
  protected readonly lines = computed(() => {
    const foods = this.store.foods();
    return new Map((this.plan()?.days ?? []).flatMap((d) => d.meals).map((meal) => [meal.id, compactMeal(meal, foods)]));
  });
  protected readonly lockedCount = computed(() => (this.plan()?.days ?? []).flatMap((d) => d.meals).filter((m) => m.locked && m.status === 'planned').length);
  protected readonly actual = computed(() => {
    const d = this.day();
    return d ? this.store.consumed(d.date) : { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
  });
  protected readonly canRebalance = computed(() => {
    const d = this.day();
    return !!d && d.meals.some((m) => m.status !== 'planned') && d.meals.some((m) => m.status === 'planned');
  });

  constructor() {
    // À l'ouverture (ou au changement de semaine), on se place sur aujourd'hui s'il est dans la semaine affichée.
    // (On ne dépend que de la semaine : une modification du programme ne doit pas changer le jour consulté.)
    effect(() => {
      this.weekKey();
      const index = untracked(() => this.plan()?.days.findIndex((d) => d.date === this.store.today()) ?? -1);
      this.selected.set(index >= 0 ? index : 0);
    });
    effect(() => {
      if (this.generer() !== '1') return;
      untracked(() => this.openGenerate());
      void this.router.navigate([], { queryParams: {}, replaceUrl: true });
    });
  }

  private readView(): 'day' | 'week' {
    try {
      return localStorage.getItem('bouffe.planView') === 'day' ? 'day' : 'week';
    } catch {
      return 'week';
    }
  }

  protected setView(view: 'day' | 'week'): void {
    this.view.set(view);
    this.swapMode.set(false);
    this.swapFirst.set(null);
    try {
      localStorage.setItem('bouffe.planView', view);
    } catch {
      /* préférence d'affichage non mémorisée */
    }
  }

  protected dayKcal(plan: PlanJson, day: MealPlanDay): number {
    return dayTargetKcal(plan, day);
  }

  protected dot(meal: Meal): string {
    return meal.status === 'eaten' ? 'bg-accent' : meal.status === 'planned' ? 'bg-current opacity-25' : 'bg-warn';
  }

  protected rowClass(meal: Meal): string {
    if (this.swapFirst()?.id === meal.id) return 'bg-fg text-bg';
    if (meal.status !== 'planned' && meal.status !== 'eaten') return 'bg-warn-soft';
    return '';
  }

  /** Copie la semaine en tableau « Jour / Midi / Collation / Soir », prêt à coller. */
  protected async copyTable(plan: PlanJson): Promise<void> {
    try {
      await navigator.clipboard.writeText(planTableText(plan, this.store.foods()));
      this.toasts.success('Tableau copié : colle-le dans une note, un message ou un tableur.');
    } catch {
      this.toasts.error('Copie impossible sur cet appareil : utilise « Partager ».');
    }
  }

  protected awayLabel(mode: AwayMode): string {
    return AWAY_OPTIONS.find((o) => o.value === mode)?.label ?? '';
  }

  protected toggle(day: MealPlanDay, meal: Meal): void {
    const plan = this.plan();
    if (plan) void this.store.logMeal(plan.id, meal, day.date, meal.status === 'planned' ? 'eaten' : 'planned');
  }

  /** Glissement vers la gauche : un autre repas, sans passer par le détail. */
  protected async quickReplace(plan: PlanJson, meal: Meal): Promise<void> {
    if (meal.status !== 'planned') return;
    if (await this.store.replaceMeal(plan.id, meal.id)) this.toasts.success('Repas remplacé, journée recalculée.');
  }

  // ───────────── Vue semaine ─────────────

  protected toggleSwap(): void {
    this.swapMode.update((on) => !on);
    this.swapFirst.set(null);
  }

  protected async tapCell(plan: PlanJson, dayIndex: number, position: number, meal: Meal): Promise<void> {
    if (!this.swapMode()) {
      this.selected.set(dayIndex);
      this.sheet.set(position);
      return;
    }
    if (meal.status !== 'planned') {
      this.toasts.info('Un repas déjà déclaré ne peut pas être échangé.');
      return;
    }
    const first = this.swapFirst();
    if (!first) {
      this.swapFirst.set(meal);
      return;
    }
    if (first.id === meal.id) {
      this.swapFirst.set(null);
      return;
    }
    if (await this.store.swapMeals(plan.id, first.id, meal.id)) this.toasts.success('Repas échangés, journées recalculées.');
    this.swapFirst.set(null);
    this.swapMode.set(false);
  }

  protected toggleLock(plan: PlanJson, meal: Meal): void {
    void this.store.lockMeal(plan.id, meal.id, !meal.locked);
  }

  // ───────────── Feuilles ─────────────

  protected async setAway(plan: PlanJson, away: AwayMode): Promise<void> {
    this.awaySheet.set(false);
    if (this.day()?.away === away) return;
    if (await this.store.setAway(plan.id, this.selected(), away)) this.toasts.success('Journée recalculée.');
  }

  protected openGenerate(): void {
    const prefs = this.store.user()?.preferences;
    this.away.set(this.plan()?.days.map((d) => d.away) ?? (prefs?.awayDays.length === 7 ? prefs.awayDays : Array(7).fill('none')));
    this.level.set(this.plan()?.level ?? prefs?.level ?? 'normal');
    this.style.set(prefs?.style ?? 'simple');
    this.cookOnce.set(!!prefs?.cookOnce);
    this.prepAhead.set(!!prefs?.awayPrepAhead);
    this.generateSheet.set(true);
  }

  protected cycleAway(index: number): void {
    const order: AwayMode[] = ['none', 'lunch', 'full'];
    this.away.update((list) => list.map((mode, i) => (i === index ? order[(order.indexOf(mode) + 1) % 3]! : mode)));
  }

  protected async generate(): Promise<void> {
    const prefs = this.store.user()?.preferences;
    // Ces choix sont des préférences durables : on les enregistre avant de générer.
    if ((prefs?.style ?? 'simple') !== this.style() || !!prefs?.cookOnce !== this.cookOnce() || !!prefs?.awayPrepAhead !== this.prepAhead()) {
      if (!(await this.store.updateMe({ preferences: { style: this.style(), cookOnce: this.cookOnce(), awayPrepAhead: this.prepAhead() } }))) return;
    }
    if (await this.store.generateWeek({ weekStart: this.store.weekStart(), away: this.away(), level: this.level() })) {
      this.generateSheet.set(false);
      // On montre la semaine entière qui vient d'être écrite.
      this.setView('week');
      this.toasts.success('Semaine générée, liste de courses prête.');
    }
  }

  protected async openHistory(): Promise<void> {
    this.historySheet.set(true);
    this.historyLoading.set(true);
    try {
      this.history.set(await this.api.get<HistoryItem[]>('/meal-plans'));
    } catch {
      this.toasts.error("Connexion requise pour consulter l'historique.");
    } finally {
      this.historyLoading.set(false);
    }
  }

  protected async share(plan: PlanJson): Promise<void> {
    const foods = this.store.foods();
    const lines: string[] = [`Ma semaine du ${plan.weekStart} — ${plan.target.kcal} kcal / ${plan.target.protein} g protéines par jour`, ''];
    for (const d of plan.days) {
      lines.push(`${DAY_LABELS[d.index]} — ${d.nutrition.kcal} kcal, ${d.nutrition.protein} g protéines`);
      for (const meal of d.meals) lines.push(`  ${SLOT_SHORT_LABELS[meal.slot]} : ${compactMeal(meal, foods)}`);
      lines.push('');
    }
    const text = lines.join('\n');
    try {
      if (navigator.share) await navigator.share({ title: 'Ma semaine', text });
      else {
        await navigator.clipboard.writeText(text);
        this.toasts.success('Programme copié dans le presse-papiers.');
      }
    } catch {
      /* partage annulé */
    }
  }
}
