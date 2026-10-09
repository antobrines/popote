import { ChangeDetectionStrategy, Component, type OnDestroy, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  type Food,
  STORAGE_ZONES,
  type ScannedProduct,
  type StockPack,
  type StorageZone,
  inferFood,
  isVariableWeightEan,
  normalize,
  scannedPackGrams,
  stockLabel,
  stockPacks,
  stockStep,
  stockToReset,
  storageZone,
} from '@bouffe/core';
import { ScannerComponent } from '../core/scanner';
import { ShoppingSessions } from '../core/shopping-session';
import { Store } from '../core/store';
import { Toasts } from '../core/toasts';
import { Icon, Sheet } from '../ui/ui';

interface Row {
  food: Food;
  grams: number;
  label: string;
}

interface ZoneView {
  key: StorageZone;
  label: string;
  hint: string;
  rows: Row[];
}

/** Un produit scanné, en attente de confirmation avant d'entrer dans le stock. */
interface Draft {
  ean: string;
  loading: boolean;
  product: ScannedProduct | null;
  foodId: string | null;
  /** `known` : code-barres déjà rattaché ; `guess` : aliment deviné ; `none` : à choisir. */
  origin: 'known' | 'guess' | 'none';
  confidence: number;
  /** Rayon coupe : le poids change à chaque barquette. */
  variable: boolean;
  packGrams: number | null;
  qty: number;
  choosing: boolean;
}

interface Undo {
  label: string;
  stock: Record<string, number>;
}

/**
 * Mes stocks : ce qu'il y a à la maison, retiré de la liste de courses.
 * Rangé par zone (frais, surgelés, placard) pour vérifier ou vider d'un geste ce qui bouge vite ;
 * rempli en scannant les produits, ou à la main par paquets.
 */
@Component({
  selector: 'app-stocks-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, Sheet, ScannerComponent],
  template: `
    <div class="page space-y-6">
      <header>
        <a routerLink="/courses" class="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-accent"><app-icon name="chevron-left" [size]="16" /> Courses</a>
        <div class="row items-end">
          <h1 class="title">Mes stocks</h1>
          <p class="pb-1 text-xs font-semibold text-muted" aria-live="polite">{{ store.stockSaving() ? 'Enregistrement…' : saved() ? 'Enregistré' : '' }}</p>
        </div>
        <p class="mt-2 text-muted">Ce que tu as déjà à la maison est retiré de ta liste de courses.</p>
      </header>

      <section class="space-y-3">
        <button type="button" class="btn btn-primary btn-lg" (click)="startScan()">
          <app-icon name="scan" />
          Scanner mes produits
        </button>
        <button type="button" class="btn btn-lg bg-card" (click)="openPicker('all')">
          <app-icon name="plus" />
          Ajouter sans scanner
        </button>
      </section>

      @if (undo(); as u) {
        <section class="flex items-center gap-3 rounded-3xl bg-fg px-4 py-3 text-bg" role="status">
          <p class="min-w-0 flex-1 text-sm font-medium">{{ u.label }}</p>
          <button type="button" class="shrink-0 rounded-full bg-bg px-3.5 py-1.5 text-sm font-semibold text-fg" (click)="restore()">Annuler</button>
        </section>
      }

      @for (zone of zones(); track zone.key) {
        <section [attr.aria-label]="zone.label">
          <div class="row mb-2">
            <h2 class="eyebrow">
              {{ zone.label }}
              @if (zone.rows.length > 0) {
                <span class="num font-normal">· {{ zone.rows.length }}</span>
              }
            </h2>
            @if (zone.rows.length > 0) {
              <button type="button" class="text-sm font-semibold text-accent" [attr.aria-label]="'Vider la zone ' + zone.label" (click)="reset(zone)">Vider</button>
            }
          </div>
          @if (zone.rows.length > 0) {
            <ul class="card divide !py-1">
              @for (row of zone.rows; track row.food.id) {
                <li class="flex items-center gap-2 py-3">
                  <button type="button" class="min-w-0 flex-1 text-left" [attr.aria-label]="'Modifier le stock de ' + row.food.name" (click)="openEdit(row.food)">
                    <span class="block truncate font-semibold">{{ row.food.name }}</span>
                    <span class="num text-sm text-muted">{{ row.label }}</span>
                  </button>
                  <button type="button" class="grid size-10 shrink-0 place-items-center rounded-full bg-raised" (click)="bump(row.food, -1)" [attr.aria-label]="'Retirer du stock de ' + row.food.name">
                    <app-icon name="minus" [size]="18" />
                  </button>
                  <button type="button" class="grid size-10 shrink-0 place-items-center rounded-full bg-raised" (click)="bump(row.food, 1)" [attr.aria-label]="'Ajouter au stock de ' + row.food.name">
                    <app-icon name="plus" [size]="18" />
                  </button>
                </li>
              }
            </ul>
          } @else {
            <p class="rounded-3xl bg-card px-5 py-4 text-sm text-muted">Rien en stock. {{ zone.hint }}</p>
          }
          <button type="button" class="mt-2 inline-flex items-center gap-1 px-1 text-sm font-semibold text-accent" (click)="openPicker(zone.key)">
            <app-icon name="plus" [size]="16" />
            Ajouter
          </button>
        </section>
      }

      <section class="space-y-3">
        @if (inStock() > 0) {
          <button type="button" class="btn btn-danger w-full" (click)="reset()"><app-icon name="trash" [size]="18" /> Tout vider</button>
        }
        <p class="flex gap-3 rounded-3xl bg-card p-4 text-sm leading-relaxed text-muted">
          <app-icon name="info" [size]="20" class="mt-0.5" />
          <span>
            Le stock baisse tout seul à chaque repas validé et remonte après le Mode Courses. Le frais est ce qui se décale le plus vite : avant une grosse liste, vide-le puis scanne ce
            qu'il reste au frigo.
          </span>
        </p>
      </section>
    </div>

    @if (editingRow(); as e) {
      <app-sheet [title]="e.food.name" (closed)="editing.set(null)">
        <div class="space-y-5">
          <div class="flex items-center justify-center gap-5">
            <button type="button" class="grid size-12 place-items-center rounded-full bg-card" (click)="bump(e.food, -1)" aria-label="Moins"><app-icon name="minus" /></button>
            <p class="num min-w-32 text-center text-3xl font-bold tracking-tight" aria-live="polite">{{ e.grams > 0 ? e.label : 'Aucun' }}</p>
            <button type="button" class="grid size-12 place-items-center rounded-full bg-card" (click)="bump(e.food, 1)" aria-label="Plus"><app-icon name="plus" /></button>
          </div>
          <div class="flex flex-wrap justify-center gap-2">
            @for (pack of e.packs; track pack.grams) {
              <button type="button" class="chip bg-card" (click)="setTo(e.food, e.grams + pack.grams)">+ {{ pack.label }}</button>
            }
            @if (e.grams > 0) {
              <button type="button" class="chip bg-card" (click)="setTo(e.food, e.grams / 2)">Il en reste la moitié</button>
            }
          </div>
          <form class="flex items-end gap-2" (submit)="setExact($event, e.food, exact.value); exact.value = ''">
            <label class="block flex-1">
              <span class="label">Quantité exacte ({{ e.food.piece ? e.food.piece.plural : e.food.unit }})</span>
              <input #exact class="input num" type="number" inputmode="decimal" min="0" step="any" />
            </label>
            <button type="submit" class="btn btn-dark">Fixer</button>
          </form>
          @if (e.grams > 0) {
            <button type="button" class="btn btn-danger btn-lg" (click)="setTo(e.food, 0); editing.set(null)">Il n'y en a plus</button>
          }
        </div>
      </app-sheet>
    }

    @if (picker(); as zone) {
      <app-sheet title="Ajouter au stock" (closed)="closePicker()">
        <div class="space-y-4">
          <div class="relative">
            <app-icon name="search" [size]="18" class="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-faint" />
            <input class="input !pl-11" type="search" placeholder="Chercher un aliment" aria-label="Chercher un aliment" [value]="query()" (input)="query.set(text($event))" />
          </div>
          <div class="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Zone">
            <button type="button" role="tab" class="chip" [class.on]="zone === 'all'" [attr.aria-selected]="zone === 'all'" (click)="picker.set('all')">Tout</button>
            @for (z of zoneList; track z.key) {
              <button type="button" role="tab" class="chip" [class.on]="zone === z.key" [attr.aria-selected]="zone === z.key" (click)="picker.set(z.key)">{{ z.label }}</button>
            }
          </div>
          <ul class="card divide !py-1">
            @for (item of pickerFoods(); track item.food.id) {
              <li class="py-3">
                <div class="row">
                  <span class="min-w-0 truncate font-semibold">{{ item.food.name }}</span>
                  @if (item.grams > 0) {
                    <span class="badge badge-ok num shrink-0">{{ item.label }}</span>
                  } @else if (item.planned) {
                    <span class="badge shrink-0">au programme</span>
                  }
                </div>
                <div class="mt-2 flex flex-wrap gap-1.5">
                  @for (pack of item.packs; track pack.grams) {
                    <button type="button" class="chip" [attr.aria-label]="'Ajouter ' + pack.label + ' de ' + item.food.name" (click)="add(item.food, pack.grams)">+ {{ pack.label }}</button>
                  }
                  <button type="button" class="chip" (click)="closePicker(); openEdit(item.food)">Autre quantité</button>
                </div>
              </li>
            } @empty {
              <li class="py-4 text-sm text-muted">Aucun aliment trouvé.</li>
            }
          </ul>
          <button type="button" class="btn btn-dark btn-lg" (click)="closePicker()">Terminé</button>
        </div>
      </app-sheet>
    }

    @if (scanning()) {
      <app-scanner (code)="onScan($event)" (closed)="stopScan()" />
    }

    @if (draft(); as d) {
      <app-sheet [title]="d.loading ? 'Recherche du produit…' : d.product ? 'Produit scanné' : 'Produit inconnu'" [elevated]="true" (closed)="skip()">
        @if (d.loading) {
          <p class="num text-muted">Code {{ d.ean }}</p>
        } @else {
          <div class="space-y-5">
            <div>
              <p class="text-lg leading-snug font-bold">{{ title(d) }}</p>
              <p class="num mt-0.5 text-xs text-muted">Code {{ d.ean }}{{ d.product ? '' : ' · pas trouvé dans Open Food Facts' }}</p>
            </div>

            @if (d.choosing) {
              <div class="space-y-3">
                <div>
                  <p class="font-semibold">C'est quel aliment de ton programme ?</p>
                  <p class="mt-1 text-sm leading-relaxed text-muted">
                    {{ d.product ? 'Je ne le rattache à aucun aliment.' : 'Dis-le une fois : ce produit sera reconnu ensuite, en magasin aussi.' }}
                    Le stock ne suit que les aliments du programme : si ce produit n'en fait pas partie, ignore-le.
                  </p>
                </div>
                <div class="relative">
                  <app-icon name="search" [size]="18" class="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-faint" />
                  <input class="input !pl-11" type="search" placeholder="Chercher un aliment" aria-label="Chercher un aliment" [value]="draftQuery()" (input)="draftQuery.set(text($event))" />
                </div>
                <ul class="card divide max-h-64 overflow-y-auto !py-1">
                  @for (food of draftFoods(); track food.id) {
                    <li>
                      <button type="button" class="w-full py-3 text-left font-medium" (click)="chooseFood(food)">{{ food.name }}</button>
                    </li>
                  } @empty {
                    <li class="py-3 text-sm text-muted">Aucun aliment trouvé.</li>
                  }
                </ul>
              </div>
            } @else {
              @if (draftFood(); as food) {
                <div class="row rounded-2xl bg-card px-4 py-3">
                  <span class="min-w-0">
                    <span class="block text-xs font-semibold text-muted">Compté dans ton stock comme</span>
                    <span class="block truncate font-semibold">{{ food.name }}</span>
                  </span>
                  <button type="button" class="btn btn-sm shrink-0" (click)="rechoose()">Changer</button>
                </div>
                @if (d.origin === 'guess' && d.confidence < 0.7) {
                  <p class="rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn" role="alert">Je ne suis pas sûr de l'aliment : vérifie-le avant d'ajouter.</p>
                }
                <div class="grid grid-cols-2 gap-3">
                  <label class="block">
                    <span class="label">Poids du produit ({{ food.unit }})</span>
                    <input class="input num" type="number" inputmode="decimal" min="1" step="any" [value]="d.packGrams ?? ''" (input)="setPack($event)" />
                  </label>
                  <div>
                    <p class="label">Combien ?</p>
                    <div class="flex h-12 items-center justify-between rounded-[0.875rem] bg-card px-1.5">
                      <button type="button" class="grid size-9 place-items-center rounded-full bg-raised" (click)="setQty(d.qty - 1)" aria-label="Un de moins"><app-icon name="minus" [size]="16" /></button>
                      <span class="num font-semibold" aria-live="polite">× {{ d.qty }}</span>
                      <button type="button" class="grid size-9 place-items-center rounded-full bg-raised" (click)="setQty(d.qty + 1)" aria-label="Un de plus"><app-icon name="plus" [size]="16" /></button>
                    </div>
                  </div>
                </div>
                @if (d.variable) {
                  <p class="text-xs leading-relaxed text-muted">Produit vendu au poids : recopie le poids net indiqué sur l'étiquette.</p>
                } @else if (!d.product?.grams) {
                  <p class="text-xs leading-relaxed text-muted">Poids inconnu pour ce produit : j'ai mis le format habituel, corrige-le s'il diffère.</p>
                }
                @if (d.packGrams) {
                  <p class="num text-sm text-muted">
                    En stock : {{ label(food, current(food)) }} → <span class="font-semibold text-fg">{{ label(food, current(food) + d.packGrams * d.qty) }}</span>
                  </p>
                }
                <button type="button" class="btn btn-primary btn-lg" [disabled]="!d.packGrams" (click)="confirm()">
                  <app-icon name="check" [stroke]="2.4" />
                  Ajouter au stock
                </button>
              }
            }
            <button type="button" class="btn w-full bg-card" (click)="skip()">Ignorer ce produit</button>
          </div>
        }
      </app-sheet>
    }
  `,
})
export class StocksPage implements OnDestroy {
  protected readonly store = inject(Store);
  private readonly sessions = inject(ShoppingSessions);
  private readonly toasts = inject(Toasts);

  protected readonly zoneList = STORAGE_ZONES;
  protected readonly editing = signal<string | null>(null);
  protected readonly picker = signal<StorageZone | 'all' | null>(null);
  protected readonly query = signal('');
  protected readonly scanning = signal(false);
  protected readonly draft = signal<Draft | null>(null);
  protected readonly draftQuery = signal('');
  protected readonly undo = signal<Undo | null>(null);
  /** Au moins une modification a été enregistrée depuis l'ouverture de l'écran. */
  protected readonly saved = signal(false);

  private added = 0;
  /** Dernier code traité : le même produit reste devant la caméra quelques secondes. */
  private handled = { ean: '', at: 0 };

  private readonly entries = computed(() => this.store.state()?.inventory ?? []);
  protected readonly inStock = computed(() => this.entries().filter((e) => e.grams > 0).length);

  protected readonly zones = computed<ZoneView[]>(() => {
    const foods = this.store.foods();
    const rows = this.entries().flatMap((entry) => {
      const food = foods.get(entry.foodId);
      return food && entry.grams > 0 ? [{ food, grams: entry.grams, label: stockLabel(food, entry.grams) }] : [];
    });
    return STORAGE_ZONES.map((zone) => ({
      ...zone,
      rows: rows.filter((row) => storageZone(row.food) === zone.key).sort((a, b) => a.food.name.localeCompare(b.food.name, 'fr')),
    }));
  });

  /** Formats relevés en magasin par l'utilisateur, par aliment : proposés avant ceux du catalogue. */
  private readonly knownPacks = computed(() => {
    const packs = new Map<string, { grams: number }[]>();
    for (const product of this.store.state()?.retailProducts ?? []) {
      packs.set(product.foodKey, [...(packs.get(product.foodKey) ?? []), { grams: product.grams }]);
    }
    return packs;
  });

  /** Aliments des listes de courses en cours : ce sont eux qu'on cherche le plus souvent. */
  private readonly planned = computed(() => new Set((this.store.state()?.shoppingLists ?? []).flatMap((list) => list.items.map((item) => item.foodId))));

  protected readonly editingRow = computed(() => {
    const food = this.store.foods().get(this.editing() ?? '');
    if (!food) return null;
    const grams = this.current(food);
    return { food, grams, label: stockLabel(food, grams), packs: this.packs(food) };
  });

  protected readonly pickerFoods = computed(() => {
    const zone = this.picker();
    if (!zone) return [];
    const planned = this.planned();
    const stock = this.store.inventory();
    return this.search(this.query(), zone === 'all' ? undefined : zone)
      .map((food) => {
        const grams = stock[food.id] ?? 0;
        return { food, grams, label: stockLabel(food, grams), planned: planned.has(food.id), packs: this.packs(food) };
      })
      .sort((a, b) => Number(b.planned) - Number(a.planned));
  });

  protected readonly draftFood = computed(() => this.store.foods().get(this.draft()?.foodId ?? '') ?? null);
  protected readonly draftFoods = computed(() => this.search(this.draftQuery()).slice(0, 40));

  constructor() {
    // Les produits déjà connus se reconnaissent sans réseau.
    void this.sessions.cacheKnownBarcodes();
  }

  ngOnDestroy(): void {
    // Quitter l'écran ne doit pas perdre le dernier geste.
    void this.store.flushStock();
  }

  private search(query: string, zone?: StorageZone): Food[] {
    const q = normalize(query.trim());
    return this.store
      .foodList()
      .filter((food) => (!zone || storageZone(food) === zone) && (!q || normalize(`${food.name} ${food.shortName}`).includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }

  private packs(food: Food): StockPack[] {
    return stockPacks(food, this.knownPacks().get(food.id));
  }

  protected current(food: Food): number {
    return this.store.inventory()[food.id] ?? 0;
  }

  protected label(food: Food, grams: number): string {
    return grams > 0 ? stockLabel(food, grams) : 'rien';
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  // ───────────── Modifier ─────────────

  protected setTo(food: Food, grams: number): void {
    this.store.setStock({ [food.id]: Math.max(0, Math.round(grams)) });
    this.saved.set(true);
  }

  protected bump(food: Food, direction: 1 | -1): void {
    this.setTo(food, this.current(food) + direction * stockStep(food));
  }

  protected add(food: Food, grams: number): void {
    this.setTo(food, this.current(food) + grams);
  }

  protected setExact(event: Event, food: Food, raw: string): void {
    event.preventDefault();
    const value = Number(raw.replace(',', '.'));
    if (raw.trim() === '' || !Number.isFinite(value) || value < 0) return;
    this.setTo(food, food.piece ? value * food.piece.grams : value);
  }

  protected openEdit(food: Food): void {
    this.editing.set(food.id);
  }

  protected openPicker(zone: StorageZone | 'all'): void {
    this.query.set('');
    this.picker.set(zone);
  }

  protected closePicker(): void {
    this.picker.set(null);
  }

  // ───────────── Vider ─────────────

  /** Vide une zone, ou tout le stock sans argument. Toujours annulable tant qu'on reste sur l'écran. */
  protected reset(zone?: ZoneView): void {
    const removed = stockToReset(this.entries(), this.store.foods(), zone?.key);
    if (removed.length === 0) return;
    if (!zone && !confirm(`Vider tout le stock (${removed.length} produit${removed.length > 1 ? 's' : ''}) ?`)) return;
    this.store.setStock(Object.fromEntries(removed.map((entry) => [entry.foodId, 0])));
    this.saved.set(true);
    this.undo.set({
      label: `${zone ? zone.label : 'Stock'} : ${removed.length} produit${removed.length > 1 ? 's' : ''} retiré${removed.length > 1 ? 's' : ''}.`,
      stock: Object.fromEntries(removed.map((entry) => [entry.foodId, entry.grams])),
    });
  }

  protected restore(): void {
    const undo = this.undo();
    if (!undo) return;
    this.store.setStock(undo.stock);
    this.undo.set(null);
    this.toasts.success('Stock rétabli.');
  }

  // ───────────── Scanner ─────────────

  protected startScan(): void {
    this.added = 0;
    this.scanning.set(true);
  }

  protected stopScan(): void {
    this.scanning.set(false);
    this.draft.set(null);
    if (this.added > 0) this.toasts.success(`${this.added} produit${this.added > 1 ? 's' : ''} ajouté${this.added > 1 ? 's' : ''} au stock.`);
    this.added = 0;
  }

  protected async onScan(ean: string): Promise<void> {
    // Une confirmation est déjà ouverte, ou le produit qu'on vient de traiter est encore devant la caméra.
    if (this.draft() || (ean === this.handled.ean && Date.now() - this.handled.at < 4000)) return;
    const empty: Draft = { ean, loading: true, product: null, foodId: null, origin: 'none', confidence: 0, variable: false, packGrams: null, qty: 1, choosing: false };
    this.draft.set(empty);
    this.draftQuery.set('');
    const product = await this.sessions.lookup(ean);
    if (this.draft()?.ean !== ean) return;

    const variable = isVariableWeightEan(ean) || !!product?.variableWeight;
    const inferred = product ? inferFood(product, this.store.foodList()) : null;
    const food = inferred?.food ?? null;
    this.draft.set({
      ...empty,
      loading: false,
      product,
      foodId: food?.id ?? null,
      origin: food ? (product?.foodId === food.id ? 'known' : 'guess') : 'none',
      confidence: inferred?.confidence ?? 0,
      variable,
      packGrams: food ? scannedPackGrams({ grams: product?.grams, variableWeight: variable }, food) : variable ? null : (product?.grams ?? null),
      choosing: !food,
    });
  }

  protected title(draft: Draft): string {
    const product = draft.product;
    if (!product) return 'Produit pas encore connu';
    return product.brand && !normalize(product.name).includes(normalize(product.brand)) ? `${product.brand} — ${product.name}` : product.name;
  }

  protected rechoose(): void {
    this.draftQuery.set('');
    this.draft.update((d) => (d ? { ...d, choosing: true } : d));
  }

  protected chooseFood(food: Food): void {
    this.draft.update((d) =>
      d ? { ...d, foodId: food.id, origin: 'known', choosing: false, packGrams: d.packGrams ?? scannedPackGrams({ grams: d.product?.grams, variableWeight: d.variable }, food) } : d,
    );
  }

  protected setPack(event: Event): void {
    const value = Number(this.text(event).replace(',', '.'));
    this.draft.update((d) => (d ? { ...d, packGrams: Number.isFinite(value) && value > 0 ? Math.round(value) : null } : d));
  }

  protected setQty(qty: number): void {
    this.draft.update((d) => (d ? { ...d, qty: Math.max(1, Math.min(20, qty)) } : d));
  }

  protected skip(): void {
    const draft = this.draft();
    if (draft) this.handled = { ean: draft.ean, at: Date.now() };
    this.draft.set(null);
  }

  protected confirm(): void {
    const draft = this.draft();
    const food = this.draftFood();
    if (!draft || !food || !draft.packGrams) return;
    const added = Math.round(draft.packGrams * draft.qty);
    this.setTo(food, this.current(food) + added);

    // Le rattachement est retenu : la prochaine fois, ce produit est reconnu tout de suite, magasin compris.
    // (Sauf au rayon coupe, où chaque barquette porte son propre code.)
    if (!draft.variable) {
      const name = draft.product?.name ?? food.name;
      const brand = draft.product?.brand;
      void this.sessions.remember({ ...draft.product, ean: draft.ean, name, brand, grams: draft.packGrams, foodId: food.id, source: 'user' });
      void this.store.learnBarcode(draft.ean, { name: name.slice(0, 120), brand: brand?.slice(0, 60), grams: draft.packGrams, foodId: food.id });
    }
    this.added++;
    this.handled = { ean: draft.ean, at: Date.now() };
    this.draft.set(null);
    this.toasts.success(`${food.name} : + ${stockLabel(food, added)}`);
  }
}
