/**
 * Détail d'un repas : ingrédients au gramme près, recette, déclaration de ce qui a été mangé
 * (y compris un repas libre), alternatives, cadenas, avis.
 */
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  DAY_LABELS,
  type Meal,
  type MealStatus,
  type Nutrients,
  PREP_MODE_LABELS,
  type PrepLevel,
  SLOT_LABELS,
  buildRecipe,
  cookedItems,
  ingredientLabel,
  itemsNutrition,
  recipeIngredient,
} from '@bouffe/core';
import { batchInfo } from '../core/batch';
import { Store } from '../core/store';
import { Toasts } from '../core/toasts';
import { GramsPipe, Icon, NumPipe, Sheet } from '../ui/ui';

export const STATUS_LABELS: Record<MealStatus, string> = {
  planned: 'Prévu',
  eaten: 'Mangé',
  partial: 'En partie',
  replaced: 'Remplacé',
  skipped: 'Sauté',
};

export function statusBadge(status: MealStatus): string {
  return status === 'eaten' ? 'badge badge-ok' : status === 'planned' ? 'badge' : status === 'skipped' ? 'badge' : 'badge badge-warn';
}

type Panel = 'none' | 'partial' | 'other' | 'free' | 'alternatives' | 'food' | 'repeat';

const FREE_PRESETS = [
  { label: 'Léger', kcal: 600 },
  { label: 'Normal', kcal: 900 },
  { label: 'Copieux', kcal: 1300 },
  { label: 'Très copieux', kcal: 1800 },
];

@Component({
  selector: 'app-meal-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Sheet, Icon, GramsPipe, NumPipe],
  template: `
    @if (meal(); as m) {
      <app-sheet [title]="slotLabel()" (closed)="closed.emit()">
        <div class="space-y-5">
          <header>
            <h3 class="text-2xl leading-tight font-bold">{{ m.name }}</h3>
            <div class="mt-2 flex flex-wrap gap-1.5">
              <span [class]="badge(m.status)">{{ m.free ? 'Repas libre' : statusLabels[m.status] }}</span>
              @if (m.context === 'away') {
                <span class="badge badge-info"><app-icon name="bag" [size]="12" /> À emporter</span>
              }
              @if (m.locked) {
                <span class="badge"><app-icon name="lock" [size]="12" /> Gardé</span>
              }
              @if (m.swapped) {
                <span class="badge">Modifié</span>
              }
              @if (recipe(); as r) {
                @if (r.prepMin + r.cookMin > 0) {
                  <span class="badge"><app-icon name="clock" [size]="12" /> {{ r.prepMin + r.cookMin }} min</span>
                }
              }
            </div>
          </header>

          @if (batch(); as b) {
            <section class="rounded-3xl bg-accent-soft p-4 text-sm text-accent">
              @if (b.role === 'cook') {
                <p class="flex items-center gap-2 font-semibold"><app-icon name="pot" [size]="18" /> Cuisine double ce soir</p>
                <p class="mt-1">La seconde portion est ton déjeuner de {{ dayLabels[b.partnerDay].toLowerCase() }}. À préparer en une fois :</p>
                <ul class="num mt-2 space-y-0.5">
                  @for (line of doubled(); track line.label) {
                    <li>{{ line.label }} <span class="opacity-70">· dont {{ line.tomorrow | grams }} pour demain</span></li>
                  }
                </ul>
              } @else {
                <p class="flex items-center gap-2 font-semibold"><app-icon name="check" [size]="18" /> Déjà cuisiné {{ dayLabels[b.partnerDay].toLowerCase() }} soir</p>
                <p class="mt-1">Il ne reste qu'à réchauffer ta seconde portion.</p>
              }
            </section>
          }

          <div class="card grid grid-cols-4 gap-2 text-center">
            <div>
              <p class="num text-xl font-bold">{{ m.nutrition.kcal | num }}</p>
              <p class="text-xs text-muted">kcal</p>
            </div>
            <div>
              <p class="num text-xl font-bold text-protein">{{ m.nutrition.protein | num }}</p>
              <p class="text-xs text-muted">protéines</p>
            </div>
            <div>
              <p class="num text-xl font-bold">{{ m.nutrition.carbs | num }}</p>
              <p class="text-xs text-muted">glucides</p>
            </div>
            <div>
              <p class="num text-xl font-bold">{{ m.nutrition.fat | num }}</p>
              <p class="text-xs text-muted">lipides</p>
            </div>
          </div>

          <section>
            <h4 class="eyebrow mb-2">Ingrédients</h4>
            <ul class="card divide !py-1">
              @for (ingredient of ingredients(); track ingredient.slotKey) {
                <li class="flex items-center gap-3 py-3">
                  <div class="min-w-0 flex-1">
                    <p class="font-medium">{{ ingredient.label }}</p>
                    <p class="num text-xs text-muted">{{ ingredient.nutrition.kcal | num }} kcal · {{ ingredient.nutrition.protein | num: 1 }} g prot.</p>
                  </div>
                  @if (m.status === 'planned') {
                    <button
                      type="button"
                      class="grid size-10 shrink-0 place-items-center rounded-full bg-raised text-muted"
                      (click)="openFood(ingredient.slotKey)"
                      [attr.aria-label]="'Remplacer uniquement ' + ingredient.name"
                      title="Remplacer uniquement cet aliment"
                    >
                      <app-icon name="swap" [size]="18" />
                    </button>
                  }
                </li>
              }
            </ul>
          </section>

          @if (panel() === 'food') {
            <section class="card fade-in space-y-2">
              <h4 class="font-semibold">Remplacer uniquement cet aliment</h4>
              @if (loading()) {
                <p class="text-sm text-muted">Recherche d'équivalents…</p>
              } @else if (foodOptions().length === 0) {
                <p class="text-sm text-muted">Aucun autre aliment compatible pour ce rôle. Essaie « Générer une alternative » pour changer tout le repas.</p>
              } @else {
                @for (option of foodOptions(); track option.foodId) {
                  <button type="button" class="row w-full rounded-2xl bg-raised px-4 py-3 text-left" (click)="chooseFood(option.foodId)">
                    <span class="font-medium">{{ option.name }}</span>
                    <span class="num text-sm text-muted">{{ option.grams | grams }} · {{ option.mealNutrition.kcal | num }} kcal</span>
                  </button>
                }
              }
            </section>
          }

          @if (recipe(); as r) {
            <section>
              <div class="row mb-2">
                <h4 class="eyebrow">Recette</h4>
                <div class="flex gap-1">
                  @for (option of levels; track option.value) {
                    <button type="button" class="chip !min-h-8 !px-3 !text-xs" [class.on]="level() === option.value" (click)="level.set(option.value)">{{ option.label }}</button>
                  }
                </div>
              </div>
              <div class="card space-y-4">
                <p class="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                  <span>Préparation {{ r.prepMin }} min</span>
                  <span>Cuisson {{ r.cookMin }} min</span>
                  <span>{{ methods(r.methods) }}</span>
                </p>
                <ol class="space-y-3">
                  @for (step of r.steps; track $index) {
                    <li class="flex gap-3">
                      <span class="num grid size-6 shrink-0 place-items-center rounded-full bg-raised text-xs font-bold">{{ $index + 1 }}</span>
                      <span class="text-[0.9375rem] leading-relaxed">{{ step }}</span>
                    </li>
                  }
                </ol>
                <a routerLink="/programme/cuisine" [queryParams]="{ plan: planId(), day: dayIndex(), pos: position() }" class="btn btn-dark w-full" (click)="closed.emit()">
                  <app-icon name="play" [size]="18" />
                  Mode cuisine
                </a>
              </div>
            </section>
          }

          @if (m.status === 'planned') {
            <section class="space-y-2">
              <button type="button" class="btn btn-primary btn-lg" (click)="log('eaten')">
                <app-icon name="check" />
                J'ai mangé ce repas
              </button>
              <div class="grid grid-cols-2 gap-2">
                <button type="button" class="btn btn-sm" [class.btn-dark]="panel() === 'partial'" (click)="openPartial()">En partie</button>
                <button type="button" class="btn btn-sm" [class.btn-dark]="panel() === 'other'" (click)="openOther()">Autre chose</button>
                <button type="button" class="btn btn-sm" [class.btn-dark]="panel() === 'free'" (click)="openFree()"><app-icon name="utensils" [size]="16" /> Repas libre</button>
                <button type="button" class="btn btn-sm" (click)="log('skipped')">Sauté</button>
              </div>
            </section>
          } @else {
            <section class="card row">
              <div>
                <p class="font-semibold">{{ m.free ? (m.free.label === 'Repas libre' ? 'Repas libre' : 'Repas libre : ' + m.free.label) : 'Déclaré : ' + statusLabels[m.status].toLowerCase() }}</p>
                @if (actual(); as a) {
                  <p class="num text-sm text-muted">{{ m.free ? 'Estimé' : 'Réel' }} : {{ a.kcal | num }} kcal · {{ a.protein | num }} g prot.</p>
                }
              </div>
              <button type="button" class="btn btn-sm" (click)="log('planned')">Annuler</button>
            </section>
          }

          @if (panel() === 'partial' || panel() === 'other') {
            <section class="card fade-in space-y-3">
              <h4 class="font-semibold">{{ panel() === 'partial' ? 'Quantités réellement mangées' : 'Ce que tu as mangé à la place' }}</h4>
              @for (line of draft(); track line.foodId; let i = $index) {
                <div class="flex items-center gap-2">
                  <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ foodName(line.foodId) }}</span>
                  <input
                    class="input num !min-h-10 !w-24 text-right"
                    type="number"
                    inputmode="numeric"
                    min="0"
                    [ngModel]="line.grams"
                    (ngModelChange)="setDraft(i, $event)"
                    [attr.aria-label]="'Grammes de ' + foodName(line.foodId)"
                  />
                  <span class="w-4 text-sm text-muted">g</span>
                </div>
              }
              @if (panel() === 'other') {
                <div class="flex gap-2">
                  <select class="input !min-h-10 flex-1" [(ngModel)]="pickFood" aria-label="Ajouter un aliment">
                    <option value="">Ajouter un aliment…</option>
                    @for (food of store.foodList(); track food.id) {
                      <option [value]="food.id">{{ food.name }}</option>
                    }
                  </select>
                  <button type="button" class="btn btn-sm" [disabled]="!pickFood" (click)="addDraft()">Ajouter</button>
                </div>
              }
              <p class="num text-sm text-muted">Total : {{ draftNutrition().kcal | num }} kcal · {{ draftNutrition().protein | num }} g prot.</p>
              <label class="flex items-center gap-2 text-sm">
                <input type="checkbox" class="size-5 accent-[var(--accent)]" [(ngModel)]="rebalance" />
                Recalculer le reste de la journée
              </label>
              <button type="button" class="btn btn-dark w-full" [disabled]="draftNutrition().kcal === 0" (click)="log(panel() === 'partial' ? 'partial' : 'replaced')">Valider</button>
            </section>
          }

          @if (panel() === 'free') {
            <section class="card fade-in space-y-4">
              <div>
                <h4 class="font-semibold">Repas libre</h4>
                <p class="mt-1 text-sm text-muted">Restaurant, soirée, invitation : pas besoin de tout peser, une estimation suffit.</p>
              </div>
              <div class="grid grid-cols-2 gap-2">
                @for (preset of presets; track preset.kcal) {
                  <button type="button" class="chip justify-between !px-4" [class.on]="freeKcal() === preset.kcal" (click)="freeKcal.set(preset.kcal)">
                    <span>{{ preset.label }}</span>
                    <span class="num opacity-70">{{ preset.kcal | num }}</span>
                  </button>
                }
              </div>
              <div class="grid grid-cols-[1fr_7rem] gap-3">
                <div>
                  <label class="label" for="free-label">Où, quoi (facultatif)</label>
                  <input id="free-label" class="input" maxlength="60" placeholder="Restaurant" [(ngModel)]="freeLabel" />
                </div>
                <div>
                  <label class="label" for="free-kcal">kcal</label>
                  <input id="free-kcal" class="input num text-center font-semibold" type="number" inputmode="numeric" min="50" max="6000" step="50" [ngModel]="freeKcal()" (ngModelChange)="freeKcal.set($event)" />
                </div>
              </div>
              <label class="flex items-start gap-2 text-sm">
                <input type="checkbox" class="mt-0.5 size-5 accent-[var(--accent)]" [(ngModel)]="freeSpread" />
                <span>
                  Lisser l'écart sur les jours suivants
                  <span class="block text-muted">Au plus 150 kcal de moins par jour, jamais sous ton plancher.</span>
                </span>
              </label>
              <button type="button" class="btn btn-dark w-full" [disabled]="!freeKcal() || store.busy()" (click)="declareFree()">Valider le repas libre</button>
            </section>
          }

          @if (m.status === 'planned') {
            <section class="space-y-2">
              <button type="button" class="btn w-full" (click)="openAlternatives()">
                <app-icon name="refresh" [size]="18" />
                Je n'aime pas ce repas → Générer une alternative
              </button>
              @if (panel() === 'alternatives') {
                <div class="fade-in space-y-2">
                  @if (loading()) {
                    <p class="px-1 text-sm text-muted">Recherche de variantes équivalentes…</p>
                  } @else {
                    @for (option of mealOptions(); track option.id) {
                      <button type="button" class="card w-full text-left" (click)="chooseMeal(option)">
                        <p class="font-semibold">{{ option.name }}</p>
                        <p class="num mt-0.5 text-sm text-muted">{{ option.nutrition.kcal | num }} kcal · {{ option.nutrition.protein | num }} g prot.</p>
                        <p class="mt-1 text-xs text-faint">{{ summary(option) }}</p>
                      </button>
                    } @empty {
                      <p class="px-1 text-sm text-muted">Aucune autre variante possible avec tes préférences actuelles.</p>
                    }
                  }
                </div>
              }
            </section>
          }

          <section class="card space-y-4">
            <div class="row">
              <span class="text-sm font-semibold">Ta note</span>
              <div class="flex" role="group" aria-label="Note du repas">
                @for (star of [1, 2, 3, 4, 5]; track star) {
                  <button
                    type="button"
                    class="grid size-9 place-items-center"
                    [class]="star <= (feedback()?.rating ?? 0) ? 'text-warn' : 'text-faint'"
                    (click)="rate(star)"
                    [attr.aria-label]="star + ' sur 5'"
                  >
                    <app-icon name="star" [size]="22" />
                  </button>
                }
              </div>
            </div>
            <div class="flex flex-wrap gap-2">
              @if (m.status === 'planned') {
                <button type="button" class="chip" [class.on]="m.locked" [attr.aria-pressed]="!!m.locked" (click)="toggleLock()">
                  <app-icon [name]="m.locked ? 'lock' : 'unlock'" [size]="16" /> {{ m.locked ? 'Gardé' : 'Garder ce repas' }}
                </button>
              }
              <button type="button" class="chip" [class.on]="feedback()?.favorite" (click)="favorite()"><app-icon name="heart" [size]="16" /> Favori</button>
              <button type="button" class="chip" [class.on]="panel() === 'repeat'" (click)="panel.set(panel() === 'repeat' ? 'none' : 'repeat')">
                <app-icon name="refresh" [size]="16" /> Répéter
              </button>
              <button type="button" class="chip" (click)="ban()"><app-icon name="ban" [size]="16" /> Ne plus proposer</button>
            </div>
            @if (m.locked) {
              <p class="text-xs text-muted">Ce repas sera conservé si tu régénères la semaine.</p>
            }
            @if (panel() === 'repeat') {
              <div class="fade-in space-y-2">
                <p class="text-sm text-muted">Remplacer un autre repas de la semaine par celui-ci :</p>
                <div class="flex flex-wrap gap-2">
                  @for (target of repeatTargets(); track target.mealId) {
                    <button type="button" class="chip" (click)="repeat(target.mealId)">{{ target.label }}</button>
                  } @empty {
                    <span class="text-sm text-muted">Aucun créneau disponible.</span>
                  }
                </div>
              </div>
            }
          </section>
        </div>
      </app-sheet>
    }
  `,
})
export class MealSheet {
  protected readonly store = inject(Store);
  private readonly toasts = inject(Toasts);

  readonly planId = input.required<string>();
  readonly dayIndex = input.required<number>();
  /** Position du repas dans la journée (stable même quand le repas est remplacé). */
  readonly position = input.required<number>();
  readonly closed = output<void>();

  protected readonly statusLabels = STATUS_LABELS;
  protected readonly dayLabels = DAY_LABELS;
  protected readonly badge = statusBadge;
  protected readonly presets = FREE_PRESETS;
  protected readonly levels: { value: PrepLevel; label: string }[] = [
    { value: 'ultra-rapide', label: 'Ultra rapide' },
    { value: 'normal', label: 'Normal' },
    { value: 'meal-prep', label: 'Meal prep' },
  ];

  protected readonly panel = signal<Panel>('none');
  protected readonly loading = signal(false);
  protected readonly level = signal<PrepLevel>(this.store.user()?.preferences.level ?? 'normal');
  protected readonly mealOptions = signal<Meal[]>([]);
  protected readonly foodOptions = signal<{ foodId: string; name: string; grams: number; mealNutrition: Nutrients }[]>([]);
  protected readonly draft = signal<{ foodId: string; grams: number }[]>([]);
  protected readonly freeKcal = signal<number | null>(900);
  protected freeLabel = '';
  protected freeSpread = true;
  protected rebalance = true;
  protected pickFood = '';
  private foodSlot = '';

  private readonly plan = computed(() => [this.store.currentPlan(), this.store.nextPlan()].find((p) => p?.id === this.planId()) ?? null);
  protected readonly day = computed(() => this.plan()?.days[this.dayIndex()] ?? null);
  protected readonly meal = computed(() => this.day()?.meals[this.position()] ?? null);
  protected readonly slotLabel = computed(() => {
    const m = this.meal();
    return m ? `${SLOT_LABELS[m.slot]} · ${DAY_LABELS[this.dayIndex()]}` : '';
  });

  protected readonly batch = computed(() => {
    const m = this.meal();
    return m ? batchInfo(this.plan(), m.id) : null;
  });

  /** Quantités à cuisiner en une fois quand le dîner sert aussi le lendemain midi. */
  protected readonly doubled = computed(() => {
    const m = this.meal();
    const b = this.batch();
    if (!m || b?.role !== 'cook') return [];
    const foods = this.store.foods();
    return cookedItems(m.items).flatMap((item) => {
      const food = foods.get(item.foodId);
      const other = b.partner.items.find((i) => i.slotKey === item.slotKey && i.foodId === item.foodId);
      return food && other ? [{ label: ingredientLabel(food, item.grams + other.grams), tomorrow: other.grams }] : [];
    });
  });

  protected readonly ingredients = computed(() => {
    const foods = this.store.foods();
    return (this.meal()?.items ?? []).flatMap((item) => {
      const food = foods.get(item.foodId);
      return food ? [{ ...recipeIngredient(food, item.grams), slotKey: item.slotKey }] : [];
    });
  });

  protected readonly recipe = computed(() => {
    const m = this.meal();
    if (!m || this.store.foods().size === 0) return null;
    try {
      return buildRecipe(m, this.store.templates().find((t) => t.id === m.templateId), this.store.foods(), {
        level: this.level(),
        equipment: this.store.user()?.preferences.equipment ?? [],
      });
    } catch {
      return null;
    }
  });

  protected readonly actual = computed(() => {
    const m = this.meal();
    const d = this.day();
    if (!m || !d || m.status === 'planned' || m.status === 'skipped') return null;
    const entries = this.store.entriesFor(d.date).filter((e) => e.mealId === m.id);
    return entries.length ? { kcal: entries.reduce((s, e) => s + e.nutrition.kcal, 0), protein: entries.reduce((s, e) => s + e.nutrition.protein, 0) } : null;
  });

  protected readonly feedback = computed(() => {
    const m = this.meal();
    return this.store.user()?.preferences.mealFeedback.find((f) => f.signature === m?.signature) ?? null;
  });

  protected readonly draftNutrition = computed(() => {
    try {
      return itemsNutrition(
        this.draft().filter((l) => l.grams > 0),
        this.store.foods(),
      );
    } catch {
      return { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
    }
  });

  protected readonly repeatTargets = computed(() => {
    const m = this.meal();
    const plan = this.plan();
    if (!m || !plan) return [];
    const main = (slot: string) => slot === 'dejeuner' || slot === 'diner';
    return plan.days.flatMap((d) =>
      d.meals
        .filter((other) => other.id !== m.id && other.status === 'planned' && main(other.slot) === main(m.slot) && other.context === m.context)
        .map((other) => ({ mealId: other.id, label: `${DAY_LABELS[d.index]} · ${SLOT_LABELS[other.slot].toLowerCase()}` })),
    );
  });

  protected methods(modes: string[]): string {
    return modes.map((m) => PREP_MODE_LABELS[m as keyof typeof PREP_MODE_LABELS] ?? m).join(' · ');
  }

  protected foodName(id: string): string {
    return this.store.foods().get(id)?.name ?? id;
  }

  protected summary(meal: Meal): string {
    return meal.items
      .filter((i) => i.scaling !== 'fixed')
      .map((i) => `${i.grams} g ${this.store.foods().get(i.foodId)?.shortName ?? ''}`)
      .join(' · ');
  }

  // ───────────── Déclaration ─────────────

  private toggle(panel: Panel): void {
    this.panel.set(this.panel() === panel ? 'none' : panel);
  }

  protected openPartial(): void {
    this.draft.set((this.meal()?.items ?? []).map((i) => ({ foodId: i.foodId, grams: i.grams })));
    this.rebalance = true;
    this.toggle('partial');
  }

  protected openOther(): void {
    this.draft.set([]);
    this.rebalance = true;
    this.toggle('other');
  }

  protected openFree(): void {
    this.freeKcal.set(900);
    this.freeLabel = '';
    this.freeSpread = true;
    this.toggle('free');
  }

  protected setDraft(index: number, grams: number | null): void {
    this.draft.update((list) => list.map((l, i) => (i === index ? { ...l, grams: Math.max(0, grams ?? 0) } : l)));
  }

  protected addDraft(): void {
    const food = this.store.foods().get(this.pickFood);
    if (!food || this.draft().some((l) => l.foodId === food.id)) return;
    this.draft.update((list) => [...list, { foodId: food.id, grams: food.piece?.grams ?? food.portion.min }]);
    this.pickFood = '';
  }

  protected async log(status: MealStatus): Promise<void> {
    const m = this.meal();
    const d = this.day();
    if (!m || !d) return;
    const custom = status === 'partial' || status === 'replaced';
    const items = custom ? this.draft().filter((l) => l.grams > 0) : undefined;
    const ok = await this.store.logMeal(this.planId(), m, d.date, status, items, custom && this.rebalance);
    if (!ok) return;
    this.panel.set('none');
    if (status === 'eaten') {
      this.toasts.success('Repas enregistré. Stocks mis à jour.');
      this.closed.emit();
    }
  }

  protected async declareFree(): Promise<void> {
    const m = this.meal();
    const kcal = Math.round(Number(this.freeKcal()));
    if (!m || !kcal) return;
    const report = await this.store.freeMeal(this.planId(), m.id, { kcal, label: this.freeLabel.trim() || undefined, spread: this.freeSpread });
    if (!report) return;
    this.panel.set('none');
    if (report.surplusKcal <= 0) this.toasts.success('Repas libre enregistré : la journée reste dans ta cible.');
    else if (report.absorbedKcal > 0) {
      const days = report.days.length;
      this.toasts.success(`Écart de ${report.surplusKcal} kcal : ${report.absorbedKcal} répartis sur ${days} jour${days > 1 ? 's' : ''} suivant${days > 1 ? 's' : ''}.`);
    } else this.toasts.info(`Écart de ${report.surplusKcal} kcal enregistré, sans lissage sur les jours suivants.`);
  }

  // ───────────── Alternatives ─────────────

  protected async openAlternatives(): Promise<void> {
    const m = this.meal();
    if (!m) return;
    if (this.panel() === 'alternatives') {
      this.panel.set('none');
      return;
    }
    this.panel.set('alternatives');
    this.loading.set(true);
    try {
      this.mealOptions.set(await this.store.alternatives(this.planId(), m.id));
    } catch {
      this.mealOptions.set([]);
      this.toasts.error('Connexion requise pour générer une alternative.');
    } finally {
      this.loading.set(false);
    }
  }

  protected async chooseMeal(option: Meal): Promise<void> {
    const m = this.meal();
    if (!m) return;
    if (await this.store.replaceMeal(this.planId(), m.id, { templateId: option.templateId, items: option.items })) {
      this.panel.set('none');
      this.toasts.success('Repas remplacé, journée recalculée.');
    }
  }

  protected async openFood(slotKey: string): Promise<void> {
    const m = this.meal();
    if (!m) return;
    if (this.panel() === 'food' && this.foodSlot === slotKey) {
      this.panel.set('none');
      return;
    }
    this.foodSlot = slotKey;
    this.panel.set('food');
    this.loading.set(true);
    try {
      this.foodOptions.set(await this.store.foodAlternatives(this.planId(), m.id, slotKey));
    } catch {
      this.foodOptions.set([]);
      this.toasts.error('Connexion requise pour remplacer un aliment.');
    } finally {
      this.loading.set(false);
    }
  }

  protected async chooseFood(foodId: string): Promise<void> {
    const m = this.meal();
    if (!m) return;
    if (await this.store.replaceFood(this.planId(), m.id, this.foodSlot, foodId)) {
      this.panel.set('none');
      this.toasts.success('Aliment remplacé, quantités recalculées.');
    }
  }

  // ───────────── Cadenas et avis ─────────────

  protected async toggleLock(): Promise<void> {
    const m = this.meal();
    if (!m) return;
    const locked = !m.locked;
    if (await this.store.lockMeal(this.planId(), m.id, locked)) {
      this.toasts.info(locked ? 'Repas gardé : il restera quand tu régénéreras la semaine.' : 'Cadenas retiré.');
    }
  }

  protected rate(rating: number): void {
    const m = this.meal();
    if (m) void this.store.feedback(this.planId(), m.id, { rating });
  }

  protected favorite(): void {
    const m = this.meal();
    if (m) void this.store.feedback(this.planId(), m.id, { favorite: !this.feedback()?.favorite });
  }

  protected async ban(): Promise<void> {
    const m = this.meal();
    if (!m) return;
    if (!(await this.store.feedback(this.planId(), m.id, { banned: true }))) return;
    if (m.status === 'planned') await this.store.replaceMeal(this.planId(), m.id);
    this.toasts.info('Ce repas ne sera plus proposé.');
  }

  protected async repeat(targetMealId: string): Promise<void> {
    const m = this.meal();
    if (m && (await this.store.repeatMeal(this.planId(), m.id, targetMealId))) {
      this.panel.set('none');
      this.toasts.success('Repas répété.');
    }
  }
}
