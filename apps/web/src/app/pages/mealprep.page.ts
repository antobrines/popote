import { ChangeDetectionStrategy, Component, computed, inject, input, numberAttribute, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DAY_LABELS, SLOT_LABELS, buildMealPrep } from '@bouffe/core';
import { Store } from '../core/store';
import { GramsPipe, Icon } from '../ui/ui';

/** « Préparer mes repas pour 3 jours » : quantités regroupées, cuisson en une fois, répartition par boîte. */
@Component({
  selector: 'app-mealprep-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, GramsPipe],
  template: `
    <div class="page space-y-6">
      <header>
        <a routerLink="/programme" class="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-accent"><app-icon name="chevron-left" [size]="16" /> Programme</a>
        <h1 class="title">Meal prep</h1>
        <p class="mt-2 text-muted">Cuisine une fois, mange {{ days() }} jour{{ days() > 1 ? 's' : '' }}.</p>
      </header>

      @if (store.plan(); as plan) {
        <section class="space-y-3">
          <div>
            <p class="eyebrow mb-2">À partir de</p>
            <div class="flex gap-1.5 overflow-x-auto pb-1">
              @for (d of plan.days; track d.index) {
                <button type="button" class="chip" [class.on]="start() === d.index" (click)="pick(d.index)">{{ dayLabels[d.index] }}</button>
              }
            </div>
          </div>
          <div>
            <p class="eyebrow mb-2">Pendant</p>
            <div class="flex gap-1.5">
              @for (n of [2, 3, 4]; track n) {
                <button type="button" class="chip" [class.on]="days() === n" (click)="days.set(n)">{{ n }} jours</button>
              }
            </div>
          </div>
        </section>

        @if (prep(); as p) {
          @if (p.portions.length === 0) {
            <section class="card text-muted">Aucun plat maison à préparer sur cette période (repas déjà mangés ou jours hors domicile).</section>
          } @else {
            <section>
              <h2 class="eyebrow mb-2">À sortir · {{ p.portions.length }} portions</h2>
              <ul class="card divide !py-1">
                @for (total of p.totals; track total.foodId) {
                  <li class="row py-3">
                    <span class="font-medium">{{ total.name }}</span>
                    <span class="num text-right">
                      <span class="font-semibold">{{ total.rawGrams | grams }}</span>
                      @if (total.cookedGrams) {
                        <span class="block text-xs text-muted">≈ {{ total.cookedGrams | grams }} cuit</span>
                      }
                    </span>
                  </li>
                }
              </ul>
            </section>

            <section>
              <h2 class="eyebrow mb-2">Préparation</h2>
              <ol class="card space-y-4">
                @for (step of p.steps; track $index) {
                  <li class="flex gap-3">
                    <span class="num grid size-6 shrink-0 place-items-center rounded-full bg-raised text-xs font-bold">{{ $index + 1 }}</span>
                    <span class="text-[0.9375rem] leading-relaxed">{{ step }}</span>
                  </li>
                }
              </ol>
            </section>

            <section>
              <h2 class="eyebrow mb-2">Répartition par boîte</h2>
              <div class="space-y-3">
                @for (portion of p.portions; track $index) {
                  <article class="card">
                    <p class="eyebrow">{{ dayLabels[portion.dayIndex] }} · {{ slotLabels[portion.slot] }}</p>
                    <h3 class="mt-1 font-semibold">{{ portion.mealName }}</h3>
                    <ul class="mt-2 space-y-1 text-sm text-muted">
                      @for (item of portion.items; track item.foodId) {
                        <li class="row">
                          <span>{{ item.name }}</span>
                          <span class="num">{{ item.cookedGrams ? (item.cookedGrams | grams) + ' cuit' : (item.rawGrams | grams) }}</span>
                        </li>
                      }
                    </ul>
                  </article>
                }
              </div>
            </section>

            <p class="flex gap-3 rounded-3xl bg-card p-4 text-sm text-muted">
              <app-icon name="info" [size]="20" class="mt-0.5" />
              {{ p.storageNote }}
            </p>
          }
        }
      } @else {
        <section class="card text-muted">Génère d'abord ta semaine pour préparer tes repas.</section>
      }
    </div>
  `,
})
export class MealPrepPage {
  protected readonly store = inject(Store);
  protected readonly dayLabels = DAY_LABELS;
  protected readonly slotLabels = SLOT_LABELS;

  /** Jour de départ passé par l'écran Programme (`?from=2`). */
  readonly from = input(undefined, { transform: (v: unknown) => (v === undefined || v === null || v === '' ? undefined : numberAttribute(v, 0)) });

  private readonly manualStart = signal<number | null>(null);
  protected readonly days = signal(3);
  protected readonly start = computed(() => {
    const manual = this.manualStart();
    if (manual !== null) return manual;
    const from = this.from();
    if (from !== undefined) return from;
    const today = this.store.plan()?.days.findIndex((d) => d.date === this.store.today()) ?? -1;
    return today >= 0 ? today : 0;
  });

  protected pick(index: number): void {
    this.manualStart.set(index);
  }

  protected readonly prep = computed(() => {
    const plan = this.store.plan();
    if (!plan || this.store.foods().size === 0) return null;
    try {
      return buildMealPrep(plan, this.store.foods(), this.start(), this.days(), {
        level: 'meal-prep',
        equipment: this.store.user()?.preferences.equipment ?? [],
      });
    } catch {
      return null;
    }
  });
}
