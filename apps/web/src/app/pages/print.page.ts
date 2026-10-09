import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DAY_LABELS, SLOT_LABELS, groupByAisle, aisleLabel, ingredientLabel } from '@bouffe/core';
import { Store } from '../core/store';
import { DayPipe, EuroPipe, Icon, NumPipe } from '../ui/ui';

/**
 * Export PDF de la semaine : une page pensée pour l'impression. Le bouton lance la boîte de
 * dialogue du navigateur, où « Enregistrer au format PDF » produit le fichier.
 */
@Component({
  selector: 'app-print-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, NumPipe, DayPipe, EuroPipe],
  template: `
    <div class="page !max-w-3xl space-y-6 !pb-10">
      <div class="no-print flex items-center justify-between gap-3">
        <a routerLink="/programme" class="inline-flex items-center gap-1 text-sm font-semibold text-accent"><app-icon name="chevron-left" [size]="16" /> Programme</a>
        <button type="button" class="btn btn-primary" (click)="print()"><app-icon name="download" [size]="18" /> Enregistrer en PDF</button>
      </div>

      @if (store.plan(); as plan) {
        <header>
          <h1 class="text-2xl font-bold">Ma semaine du {{ plan.weekStart | day: 'long' }}</h1>
          <p class="num mt-1 text-sm text-muted">
            Cible : {{ plan.target.kcal | num }} kcal (±{{ plan.target.toleranceKcal }}) · {{ plan.target.protein | num }} g de protéines par jour — moyenne prévue :
            {{ plan.averages.kcal | num }} kcal, {{ plan.averages.protein | num }} g
          </p>
        </header>

        @for (d of days(); track d.index) {
          <section class="print-day border-t border-line pt-4">
            <div class="row">
              <h2 class="text-lg font-bold">{{ dayLabels[d.index] }} <span class="text-sm font-normal text-muted">{{ d.date | day }}</span></h2>
              <p class="num text-sm font-semibold">{{ d.nutrition.kcal | num }} kcal · {{ d.nutrition.protein | num }} g prot. · {{ d.nutrition.carbs | num }} g gluc. · {{ d.nutrition.fat | num }} g lip.</p>
            </div>
            @for (meal of d.meals; track meal.id) {
              <div class="mt-3">
                <p class="text-sm font-semibold">
                  {{ slotLabels[meal.slot] }} — {{ meal.name }}
                  <span class="num font-normal text-muted">({{ meal.nutrition.kcal | num }} kcal, {{ meal.nutrition.protein | num }} g prot.)</span>
                </p>
                <p class="mt-0.5 text-sm text-muted">{{ meal.lines.join(' · ') }}</p>
              </div>
            }
          </section>
        }

        @if (store.list(); as list) {
          <section class="print-day border-t border-line pt-4">
            <div class="row">
              <h2 class="text-lg font-bold">Liste de courses</h2>
              <p class="num text-sm font-semibold">{{ list.totals.cost | euro }}</p>
            </div>
            @for (group of aisles(); track group.aisle) {
              <div class="mt-3">
                <p class="text-sm font-semibold">{{ group.label }}</p>
                <ul class="mt-1 columns-2 gap-6 text-sm">
                  @for (item of group.items; track item.id) {
                    <li class="break-inside-avoid py-0.5">☐ {{ item.name }} — {{ item.packs }}</li>
                  }
                </ul>
              </div>
            }
          </section>
        }

        <p class="border-t border-line pt-4 text-xs text-muted">
          Quantités en poids cru sauf mention contraire. Valeurs nutritionnelles calculées à partir des ingrédients ; prix indicatifs. Ce programme ne constitue pas un avis
          médical.
        </p>
      } @else {
        <p class="card text-muted">Aucun programme à imprimer pour cette semaine.</p>
      }
    </div>
  `,
})
export class PrintPage {
  protected readonly store = inject(Store);
  protected readonly dayLabels = DAY_LABELS;
  protected readonly slotLabels = SLOT_LABELS;

  protected readonly days = computed(() => {
    const foods = this.store.foods();
    return (this.store.plan()?.days ?? []).map((d) => ({
      ...d,
      meals: d.meals.map((meal) => ({
        ...meal,
        lines: meal.items.map((i) => {
          const food = foods.get(i.foodId);
          return food ? ingredientLabel(food, i.grams) : i.foodId;
        }),
      })),
    }));
  });

  protected readonly aisles = computed(() => {
    const list = this.store.list();
    if (!list) return [];
    return groupByAisle(
      list.items.filter((i) => i.toBuyG > 0),
      this.store.currentStore()?.aisleOrder,
    ).map((group) => ({
      aisle: group.aisle,
      label: aisleLabel(group.aisle),
      items: group.items.map((i) => ({
        id: i.id,
        name: i.name,
        packs: i.packages.map((p) => (p.variableWeight ? `${Math.round(p.grams)} g` : `${p.count} × ${p.label}`)).join(' + '),
      })),
    }));
  });

  protected print(): void {
    window.print();
  }
}
