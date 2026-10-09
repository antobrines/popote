import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  AISLES,
  type HabitSuggestion,
  type ShoppingListItem,
  type ShoppingStrategy,
  aisleLabel,
  groupByAisle,
  priceFreshness,
  shoppingListToText,
  wasteReport,
} from '@bouffe/core';
import { ShoppingSessions } from '../core/shopping-session';
import { Store } from '../core/store';
import { Toasts } from '../core/toasts';
import { Bar, DayPipe, EuroPipe, GramsPipe, Icon, Sheet } from '../ui/ui';

const STRATEGIES: { value: ShoppingStrategy; label: string; hint: string }[] = [
  { value: 'cheapest', label: 'Prix total', hint: 'Le ticket le plus bas possible.' },
  { value: 'least-waste', label: 'Moins de restes', hint: 'Les formats les plus proches de tes besoins.' },
  { value: 'best-unit-price', label: 'Prix au kilo', hint: 'Les gros formats quand le produit se conserve.' },
];

@Component({
  selector: 'app-shopping-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FormsModule, Icon, Bar, Sheet, EuroPipe, GramsPipe, DayPipe],
  template: `
    <div class="page space-y-6">
      <header>
        <h1 class="title">Courses</h1>
        <div class="mt-4 flex gap-2">
          <button type="button" class="chip" [class.on]="store.week() === 'current'" (click)="store.week.set('current')">Cette semaine</button>
          <button type="button" class="chip" [class.on]="store.week() === 'next'" (click)="store.week.set('next')">Semaine prochaine</button>
        </div>
      </header>

      @if (list(); as l) {
        <section class="card space-y-4">
          <div class="row items-end">
            <div>
              <p class="eyebrow">{{ l.status === 'done' ? 'Courses terminées' : 'Total estimé' }}</p>
              <p class="num mt-1 text-4xl font-bold tracking-tight">{{ l.totals.cost | euro }}</p>
            </div>
            <div class="num text-right text-sm text-muted">
              <p>
                <span class="font-semibold text-fg">{{ l.totals.perDay | euro }}</span> / jour
              </p>
              <p>
                <span class="font-semibold text-fg">{{ l.totals.perMeal | euro }}</span> / repas
              </p>
            </div>
          </div>
          <div>
            <div class="row mb-1.5 text-sm">
              <span class="text-muted">{{ store.currentStore()?.name ?? 'Magasin' }}</span>
              <span class="num font-semibold">{{ checkedCount() }} / {{ toBuy().length }} articles</span>
            </div>
            <app-bar [value]="checkedCount()" [max]="toBuy().length" />
          </div>
          @if (l.totals.estimatedShare > 0) {
            <p class="text-xs leading-relaxed text-muted">
              {{ estimatedPercent() }} % de ce total repose sur des <strong>prix estimés</strong>, pas sur ceux de ton magasin. Relève-les en scannant pendant tes courses ou dans
              <a routerLink="/courses/prix" class="font-semibold text-accent">Mes prix</a>.
            </p>
          }
        </section>

        @if (l.status === 'open') {
          <button type="button" class="btn btn-primary btn-lg" (click)="startShopping()">
            <app-icon name="scan" />
            {{ sessions.session() ? 'Reprendre mes courses' : 'Mode Courses' }}
          </button>
        } @else {
          <section class="flex gap-3 rounded-3xl bg-accent-soft p-4 text-sm text-accent">
            <app-icon name="check" [size]="20" class="mt-0.5" />
            <p>
              Courses faites : les achats ont été ajoutés à tes stocks.
              <button type="button" class="font-semibold underline" (click)="store.regenerateList(l.weekStart)">Recalculer une liste</button>
            </p>
          </section>
        }

        @for (habit of habits(); track habit.foodId + habit.kind) {
          <section class="card space-y-3">
            <p class="text-sm leading-relaxed">{{ habit.message }}</p>
            <div class="flex gap-2">
              @if (habit.kind === 'package') {
                <button type="button" class="btn btn-sm btn-dark" (click)="applyHabit(habit)">Adapter la liste</button>
              }
              <button type="button" class="btn btn-sm" (click)="dismissHabit(habit)">Non merci</button>
            </div>
          </section>
        }

        @if (waste().length > 0) {
          <section class="card space-y-3" aria-label="Restes à prévoir">
            <h2 class="eyebrow">Restes à prévoir en fin de semaine</h2>
            <ul class="space-y-1.5 text-sm">
              @for (w of waste(); track w.foodId) {
                <li class="row">
                  <span>{{ w.name }}</span>
                  <span class="num font-semibold">{{ w.leftoverG | grams: w.unit }}</span>
                </li>
              }
            </ul>
            <p class="text-xs leading-relaxed text-muted">
              Des produits frais que le programme n'utilise pas en entier. Congèle-les ou garde-les : s'ils sont dans tes stocks, la semaine suivante les utilise en priorité.
            </p>
            @if (l.strategy !== 'least-waste' && l.status === 'open') {
              <button type="button" class="btn btn-sm" (click)="store.regenerateList(l.weekStart, 'least-waste')">Réduire les restes</button>
            }
          </section>
        }

        <section>
          <p class="eyebrow mb-2">Optimiser selon</p>
          <div class="flex gap-2 overflow-x-auto pb-1">
            @for (s of strategies; track s.value) {
              <button type="button" class="chip" [class.on]="l.strategy === s.value" [disabled]="l.status === 'done'" (click)="store.regenerateList(l.weekStart, s.value)" [title]="s.hint">
                {{ s.label }}
              </button>
            }
          </div>
        </section>

        @for (group of groups(); track group.aisle) {
          <section>
            <h2 class="eyebrow mb-2">{{ group.label }}</h2>
            <ul class="card divide !p-0">
              @for (item of group.items; track item.id) {
                <li>
                  <div class="flex items-center gap-3 px-4 py-3.5">
                    <button
                      type="button"
                      class="grid size-7 shrink-0 place-items-center rounded-full border-2 transition-colors"
                      [class]="item.checked ? 'border-accent bg-accent text-on-accent' : 'border-line text-transparent'"
                      (click)="store.checkItem(l, item.id, !item.checked)"
                      [attr.aria-label]="(item.checked ? 'Décocher ' : 'Cocher ') + item.name"
                      [attr.aria-pressed]="item.checked"
                    >
                      <app-icon name="check" [size]="16" [stroke]="2.6" />
                    </button>
                    <button type="button" class="min-w-0 flex-1 text-left" (click)="toggleOpen(item.id)" [attr.aria-expanded]="open() === item.id">
                      <p class="font-semibold" [class]="item.checked ? 'text-muted line-through' : ''">{{ item.name }}</p>
                      <p class="num text-sm text-muted">{{ packs(item) }}</p>
                    </button>
                    <div class="num text-right">
                      <p class="font-semibold">{{ item.cost | euro }}</p>
                      @if (item.priceSource === 'estimate' || item.priceSource === 'example') {
                        <p class="text-[0.6875rem] text-faint">estimé</p>
                      } @else if (item.priceDate) {
                        <p class="text-[0.6875rem]" [class]="stale(item) ? 'text-warn' : 'text-faint'">{{ item.priceDate | day }}</p>
                      }
                    </div>
                  </div>
                  @if (open() === item.id) {
                    <dl class="num fade-in grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line bg-raised/50 px-4 py-3 text-sm">
                      <dt class="text-muted">Nécessaire</dt>
                      <dd class="text-right font-medium">{{ item.neededG | grams: item.unit }}</dd>
                      @if (item.fromStockG > 0) {
                        <dt class="text-muted">Déjà en stock</dt>
                        <dd class="text-right font-medium">− {{ item.fromStockG | grams: item.unit }}</dd>
                      }
                      <dt class="text-muted">Acheté</dt>
                      <dd class="text-right font-medium">{{ item.boughtG | grams: item.unit }}</dd>
                      <dt class="text-muted">Reste en fin de semaine</dt>
                      <dd class="text-right font-medium">{{ item.leftoverG | grams: item.unit }}</dd>
                      @for (p of item.packages; track $index) {
                        <dt class="text-muted">{{ p.variableWeight ? 'Au poids' : p.label }}</dt>
                        <dd class="text-right font-medium">{{ p.price | euro }}{{ p.variableWeight ? '' : ' l’unité' }}</dd>
                      }
                      <dt class="text-muted">Prix au kilo</dt>
                      <dd class="text-right font-medium">{{ item.pricePerKg | euro }}</dd>
                      <dd class="col-span-2 pt-1">
                        <button type="button" class="btn btn-sm w-full bg-card" (click)="editPrice(item)"><app-icon name="tag" [size]="16" /> Enregistrer le prix de mon magasin</button>
                      </dd>
                    </dl>
                  }
                </li>
              }
            </ul>
          </section>
        }

        @if (inStock().length > 0) {
          <section>
            <h2 class="eyebrow mb-2">Déjà dans tes placards</h2>
            <ul class="card divide !py-1">
              @for (item of inStock(); track item.id) {
                <li class="row py-2.5 text-sm">
                  <span>{{ item.name }}</span>
                  <span class="num text-muted">{{ item.neededG | grams: item.unit }} utilisés · reste {{ item.leftoverG | grams: item.unit }}</span>
                </li>
              }
            </ul>
          </section>
        }
      } @else {
        <section class="card text-center">
          <div class="mx-auto grid size-14 place-items-center rounded-full bg-raised text-muted"><app-icon name="cart" [size]="28" /></div>
          <h2 class="mt-4 text-xl font-bold">Pas encore de liste</h2>
          <p class="mt-2 text-muted">La liste de courses se calcule automatiquement à partir de ton programme.</p>
          <a routerLink="/programme" class="btn btn-primary btn-lg mt-5">Générer ma semaine</a>
        </section>
      }

      <section class="grid grid-cols-2 gap-3">
        <a routerLink="/courses/stocks" class="btn bg-card"><app-icon name="box" [size]="18" /> Mes stocks</a>
        <a routerLink="/courses/prix" class="btn bg-card"><app-icon name="tag" [size]="18" /> Mes prix</a>
        @if (list()) {
          <button type="button" class="btn bg-card" (click)="share()"><app-icon name="share" [size]="18" /> Exporter</button>
        }
        <button type="button" class="btn bg-card" (click)="historySheet.set(true)"><app-icon name="clock" [size]="18" /> Historique</button>
      </section>
    </div>

    @if (priceItem(); as item) {
      <app-sheet title="Prix dans mon magasin" (closed)="priceItem.set(null)">
        <form class="space-y-4" (ngSubmit)="savePrice(item)">
          <p class="text-muted">{{ item.name }} — ce conditionnement sera réutilisé pour tes prochaines listes.</p>
          <div>
            <label class="label" for="p-label">Produit</label>
            <input id="p-label" class="input" name="label" required maxlength="120" [(ngModel)]="priceForm.label" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="label" for="p-grams">Poids net ({{ item.unit }})</label>
              <input id="p-grams" class="input num" name="grams" type="number" inputmode="numeric" min="1" required [(ngModel)]="priceForm.grams" />
            </div>
            <div>
              <label class="label" for="p-price">Prix (€)</label>
              <input id="p-price" class="input num" name="price" type="number" inputmode="decimal" min="0" step="0.01" required [(ngModel)]="priceForm.price" />
            </div>
          </div>
          <div>
            <label class="label" for="p-brand">Marque (facultatif)</label>
            <input id="p-brand" class="input" name="brand" maxlength="60" [(ngModel)]="priceForm.brand" />
          </div>
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" class="size-5 accent-[var(--accent)]" name="variable" [(ngModel)]="priceForm.variableWeight" />
            Vendu au poids (prix pour le poids indiqué)
          </label>
          <button type="submit" class="btn btn-primary btn-lg" [disabled]="!priceForm.label || !priceForm.grams || priceForm.price === null">Enregistrer</button>
        </form>
      </app-sheet>
    }

    @if (historySheet()) {
      <app-sheet title="Historique des courses" (closed)="historySheet.set(false)">
        <div class="space-y-3">
          @for (purchase of purchases(); track purchase.id) {
            <article class="card">
              <div class="row">
                <h3 class="font-semibold first-letter:uppercase">{{ purchase.date | day: 'long' }}</h3>
                <span class="num font-semibold">{{ purchase.actualTotal | euro }}</span>
              </div>
              <p class="num mt-1 text-sm text-muted">
                Prévu {{ purchase.plannedTotal | euro }} ·
                {{ purchase.saving >= 0 ? 'économie' : 'dépassement' }} {{ abs(purchase.saving) | euro }} sur les achats · {{ purchase.itemsBought }} /
                {{ purchase.itemsPlanned }} produits
              </p>
              @if (purchase.missing.length > 0) {
                <p class="mt-1 text-sm text-warn">Manquants : {{ missingNames(purchase.missing) }}</p>
              }
            </article>
          } @empty {
            <p class="text-muted">Aucune course enregistrée pour le moment.</p>
          }
        </div>
      </app-sheet>
    }
  `,
})
export class ShoppingPage {
  protected readonly store = inject(Store);
  protected readonly sessions = inject(ShoppingSessions);
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);

  protected readonly strategies = STRATEGIES;
  protected readonly list = this.store.list;
  protected readonly open = signal<string | null>(null);
  protected readonly priceItem = signal<ShoppingListItem | null>(null);
  protected readonly historySheet = signal(false);
  private readonly dismissed = signal<string[]>([]);
  protected priceForm: { label: string; grams: number | null; price: number | null; brand: string; variableWeight: boolean } = {
    label: '',
    grams: null,
    price: null,
    brand: '',
    variableWeight: false,
  };

  protected readonly toBuy = computed(() => (this.list()?.items ?? []).filter((i) => i.toBuyG > 0));
  protected readonly inStock = computed(() => (this.list()?.items ?? []).filter((i) => i.toBuyG <= 0));
  protected readonly checkedCount = computed(() => this.toBuy().filter((i) => i.checked).length);
  /** Produits frais entamés que la semaine ne finit pas. */
  protected readonly waste = computed(() => {
    const list = this.list();
    return list && this.store.foods().size > 0 ? wasteReport(list, this.store.foods()) : [];
  });
  protected readonly estimatedPercent = computed(() => Math.round((this.list()?.totals.estimatedShare ?? 0) * 100));
  protected readonly purchases = computed(() => this.store.state()?.purchases ?? []);

  protected readonly groups = computed(() =>
    groupByAisle(this.toBuy(), this.store.currentStore()?.aisleOrder?.length ? this.store.currentStore()!.aisleOrder : undefined).map((g) => ({
      ...g,
      label: aisleLabel(g.aisle),
    })),
  );

  protected readonly habits = computed(() => {
    if (this.list()?.status !== 'open') return [];
    return (this.store.state()?.habits ?? []).filter((h) => !this.dismissed().includes(h.foodId + h.kind));
  });

  protected packs(item: ShoppingListItem): string {
    return item.packages.map((p) => (p.variableWeight ? `${Math.round(p.grams).toLocaleString('fr-FR')} ${item.unit} au poids` : `${p.count} × ${p.label}`)).join(' + ');
  }

  protected stale(item: ShoppingListItem): boolean {
    const freshness = priceFreshness(item.priceDate, this.store.today());
    return freshness === 'aging' || freshness === 'stale';
  }

  protected abs(value: number): number {
    return Math.abs(value);
  }

  protected missingNames(missing: { name: string }[]): string {
    return missing.map((m) => m.name).join(', ');
  }

  protected toggleOpen(id: string): void {
    this.open.update((current) => (current === id ? null : id));
  }

  protected async startShopping(): Promise<void> {
    const list = this.list();
    if (!list) return;
    const active = this.sessions.session();
    if (!active || active.listId !== list.id) await this.sessions.start(list, this.store.currentStore());
    await this.router.navigateByUrl('/courses/magasin');
  }

  protected editPrice(item: ShoppingListItem): void {
    const pack = item.packages[0];
    this.priceForm = {
      label: pack && !pack.variableWeight ? pack.label : item.name,
      grams: pack && !pack.variableWeight ? pack.grams : 1000,
      price: pack && !pack.variableWeight ? pack.price : item.pricePerKg,
      brand: pack?.brand ?? '',
      variableWeight: !!pack?.variableWeight,
    };
    this.priceItem.set(item);
  }

  protected async savePrice(item: ShoppingListItem): Promise<void> {
    const form = this.priceForm;
    if (!form.label || !form.grams || form.price === null) return;
    const ok = await this.store.saveRetailProduct({
      foodKey: item.foodId,
      label: form.label.trim(),
      grams: +form.grams,
      price: +form.price,
      brand: form.brand.trim() || undefined,
      variableWeight: form.variableWeight || undefined,
    });
    if (ok) {
      this.priceItem.set(null);
      this.toasts.success('Prix enregistré, liste recalculée.');
    }
  }

  protected async applyHabit(habit: HabitSuggestion): Promise<void> {
    if (await this.store.applyHabit({ foodId: habit.foodId, packGrams: habit.packGrams, brand: habit.brand, price: habit.price })) {
      this.toasts.success('Liste adaptée à ton format habituel.');
    }
  }

  protected dismissHabit(habit: HabitSuggestion): void {
    this.dismissed.update((list) => [...list, habit.foodId + habit.kind]);
  }

  protected async share(): Promise<void> {
    const list = this.list();
    if (!list) return;
    const text = shoppingListToText(list, Object.fromEntries(AISLES.map((a) => [a.key, a.label])));
    try {
      if (navigator.share) await navigator.share({ title: 'Liste de courses', text });
      else {
        await navigator.clipboard.writeText(text);
        this.toasts.success('Liste copiée dans le presse-papiers.');
      }
    } catch {
      /* partage annulé */
    }
  }
}
