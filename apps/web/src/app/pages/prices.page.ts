import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { priceFreshness, pricePerKg } from '@bouffe/core';
import type { RetailProductJson } from '../core/models';
import { Store } from '../core/store';
import { Toasts } from '../core/toasts';
import { DayPipe, EuroPipe, GramsPipe, Icon } from '../ui/ui';

/** Mes prix : produits, conditionnements et prix relevés dans mon magasin, réutilisés chaque semaine. */
@Component({
  selector: 'app-prices-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FormsModule, Icon, EuroPipe, GramsPipe, DayPipe],
  template: `
    <div class="page space-y-6">
      <header>
        <a routerLink="/courses" class="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-accent"><app-icon name="chevron-left" [size]="16" /> Courses</a>
        <h1 class="title">Mes prix</h1>
        <p class="mt-2 text-muted">{{ store.currentStore()?.name ?? 'Mon magasin' }} — les prix que tu relèves remplacent les estimations dans tes listes.</p>
      </header>

      @for (provider of unavailable(); track provider.id) {
        <section class="flex gap-3 rounded-3xl bg-card p-4 text-sm text-muted">
          <app-icon name="info" [size]="20" class="mt-0.5 shrink-0" />
          <p class="leading-relaxed"><span class="font-semibold text-fg">{{ provider.label }} : pas de prix automatiques.</span> {{ provider.explanation }}</p>
        </section>
      }

      <form class="card space-y-3" (ngSubmit)="save()">
        <h2 class="font-semibold">{{ form.id ? 'Modifier le produit' : 'Ajouter un produit' }}</h2>
        <select class="input" name="food" required [(ngModel)]="form.foodKey" aria-label="Aliment">
          <option value="">Aliment…</option>
          @for (food of foods(); track food.id) {
            <option [value]="food.id">{{ food.name }}</option>
          }
        </select>
        <input class="input" name="label" required maxlength="120" placeholder="Nom du produit (ex. Filets de poulet 500 g)" [(ngModel)]="form.label" aria-label="Nom du produit" />
        <div class="grid grid-cols-2 gap-3">
          <input class="input num" name="grams" type="number" inputmode="numeric" min="1" required placeholder="Poids net (g)" [(ngModel)]="form.grams" aria-label="Poids net en grammes" />
          <input class="input num" name="price" type="number" inputmode="decimal" min="0" step="0.01" required placeholder="Prix (€)" [(ngModel)]="form.price" aria-label="Prix en euros" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <input class="input" name="brand" maxlength="60" placeholder="Marque" [(ngModel)]="form.brand" aria-label="Marque" />
          <input class="input num" name="ean" inputmode="numeric" pattern="[0-9]{8,14}" placeholder="Code-barres" [(ngModel)]="form.ean" aria-label="Code-barres" />
        </div>
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" class="size-5 accent-[var(--accent)]" name="variable" [(ngModel)]="form.variableWeight" />
          Vendu au poids
        </label>
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" class="size-5 accent-[var(--accent)]" name="preferred" [(ngModel)]="form.preferred" />
          Toujours utiliser ce conditionnement pour cet aliment
        </label>
        <div class="flex gap-2">
          <button type="submit" class="btn btn-dark flex-1" [disabled]="!form.foodKey || !form.label || !form.grams || form.price === null || store.busy()">Enregistrer</button>
          @if (form.id) {
            <button type="button" class="btn" (click)="reset()">Annuler</button>
          }
        </div>
      </form>

      @if (groups().length > 0) {
        @for (group of groups(); track group.foodKey) {
          <section>
            <h2 class="eyebrow mb-2">{{ group.name }}</h2>
            <ul class="card divide !py-1">
              @for (product of group.products; track product.id) {
                <li class="flex items-center gap-3 py-3">
                  <button type="button" class="min-w-0 flex-1 text-left" (click)="edit(product)">
                    <p class="font-medium">
                      {{ product.label }}
                      @if (product.preferred) {
                        <span class="badge badge-ok ml-1">préféré</span>
                      }
                    </p>
                    <p class="num text-sm text-muted">
                      {{ product.grams | grams }} · {{ perKg(product) | euro }}/kg ·
                      <span [class]="stale(product) ? 'font-semibold text-warn' : ''">relevé le {{ product.priceDate | day }}{{ stale(product) ? ' — à vérifier' : '' }}</span>
                    </p>
                  </button>
                  <span class="num font-semibold">{{ product.price | euro }}</span>
                  <button type="button" class="grid size-9 place-items-center rounded-full bg-raised text-muted" (click)="store.deleteRetailProduct(product.id)" [attr.aria-label]="'Supprimer ' + product.label">
                    <app-icon name="trash" [size]="16" />
                  </button>
                </li>
              }
            </ul>
          </section>
        }
      } @else {
        <section class="card text-center text-muted">
          <app-icon name="tag" [size]="28" />
          <p class="mt-2">Aucun prix relevé pour l'instant. Scanne tes produits en mode Courses : ils s'ajouteront ici tout seuls.</p>
        </section>
      }
    </div>
  `,
})
export class PricesPage {
  protected readonly store = inject(Store);
  private readonly toasts = inject(Toasts);

  protected form = this.empty();

  private empty() {
    return { id: '', foodKey: '', label: '', grams: null as number | null, price: null as number | null, brand: '', ean: '', variableWeight: false, preferred: false };
  }

  protected readonly foods = computed(() => [...this.store.foodList()].sort((a, b) => a.name.localeCompare(b.name, 'fr')));
  protected readonly unavailable = computed(() => (this.store.state()?.integrations.retail ?? []).filter((p) => !p.available && p.id === this.store.currentStore()?.chain));

  protected readonly groups = computed(() => {
    const foods = this.store.foods();
    const byFood = new Map<string, RetailProductJson[]>();
    for (const product of this.store.state()?.retailProducts ?? []) {
      byFood.set(product.foodKey, [...(byFood.get(product.foodKey) ?? []), product]);
    }
    return [...byFood.entries()]
      .map(([foodKey, products]) => ({ foodKey, name: foods.get(foodKey)?.name ?? foodKey, products }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  });

  protected perKg(product: RetailProductJson): number {
    return pricePerKg(product.price, product.grams);
  }

  protected stale(product: RetailProductJson): boolean {
    const freshness = priceFreshness(product.priceDate, this.store.today());
    return freshness === 'aging' || freshness === 'stale';
  }

  protected edit(product: RetailProductJson): void {
    this.form = {
      id: product.id,
      foodKey: product.foodKey,
      label: product.label,
      grams: product.grams,
      price: product.price,
      brand: product.brand ?? '',
      ean: product.ean ?? '',
      variableWeight: !!product.variableWeight,
      preferred: !!product.preferred,
    };
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  protected reset(): void {
    this.form = this.empty();
  }

  protected async save(): Promise<void> {
    const f = this.form;
    if (!f.foodKey || !f.label || !f.grams || f.price === null) return;
    const ok = await this.store.saveRetailProduct({
      id: f.id || undefined,
      foodKey: f.foodKey,
      label: f.label.trim(),
      grams: +f.grams,
      price: +f.price,
      brand: f.brand.trim() || undefined,
      ean: f.ean.trim() || undefined,
      variableWeight: f.variableWeight,
      preferred: f.preferred,
    });
    if (ok) {
      this.toasts.success('Prix enregistré.');
      this.reset();
    }
  }
}
