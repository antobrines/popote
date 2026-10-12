/**
 * Mes aliments : ce que j'aime, ce que je veux rarement, ce que je refuse.
 * Chaque aliment a trois boutons explicites ; l'effet sur la variété des repas est affiché en direct.
 */
import { ChangeDetectionStrategy, Component, type OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CIQUAL_SOURCE, type Food, type FoodCategory, type ResolveOutcome, countPossibleDishes, normalize } from '@bouffe/core';
import { Api, OfflineError } from '../core/api';
import { ScannerComponent } from '../core/scanner';
import { Store } from '../core/store';
import { Toasts } from '../core/toasts';
import { Icon, type IconName, NumPipe, Sheet } from '../ui/ui';

type Level = 'liked' | 'limited' | 'excluded';
type Filter = 'all' | Level;

interface Group {
  label: string;
  categories: FoodCategory[];
  /** Catégorie que l'on peut refuser en bloc (régime rapide). */
  diet?: { tag: string; label: string };
}

const GROUPS: Group[] = [
  { label: 'Viandes & œufs', categories: ['viande', 'oeuf', 'charcuterie'] },
  { label: 'Poissons', categories: ['poisson'], diet: { tag: 'poisson', label: 'Sans poisson' } },
  { label: 'Légumes', categories: ['legume'], diet: { tag: 'legume', label: 'Sans légumes' } },
  { label: 'Féculents & pains', categories: ['feculent', 'pain'] },
  { label: 'Laitages & fromages', categories: ['laitier', 'fromage'] },
  { label: 'Fruits & compotes', categories: ['fruit'] },
  { label: 'Sauces & matières grasses', categories: ['sauce', 'matiere-grasse', 'sucrant'] },
  { label: 'Épices & condiments', categories: ['epice'] },
  { label: 'Oléagineux, boissons & compléments', categories: ['oleagineux', 'boisson', 'supplement', 'autre'] },
];

const LEVELS: { value: Level; label: string; icon: IconName; active: string }[] = [
  { value: 'liked', label: "J'aime", icon: 'heart', active: 'bg-accent text-on-accent' },
  { value: 'limited', label: 'Rarement', icon: 'half', active: 'bg-warn text-white' },
  { value: 'excluded', label: 'Jamais', icon: 'ban', active: 'bg-danger text-white' },
];

/** Fiche d'un aliment : valeurs de l'étiquette pour un aliment existant, ou nouvel aliment. */
interface FoodForm {
  id: string | null;
  name: string;
  category: FoodCategory;
  unit: 'g' | 'ml';
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  pieceLabel: string | null;
  pieceGrams: number | null;
  productName: string;
  packGrams: number | null;
  packPrice: number | null;
  /** Valeurs déjà personnalisées. */
  custom: boolean;
  /** Aliment créé par l'utilisateur (et non un aliment du catalogue ajusté). */
  own: boolean;
  /** D'où viennent les valeurs affichées. */
  source: string;
}

const CATEGORIES: { value: FoodCategory; label: string }[] = [
  { value: 'viande', label: 'Viande' },
  { value: 'poisson', label: 'Poisson' },
  { value: 'oeuf', label: 'Œuf' },
  { value: 'charcuterie', label: 'Charcuterie' },
  { value: 'feculent', label: 'Féculent' },
  { value: 'pain', label: 'Pain' },
  { value: 'laitier', label: 'Laitage' },
  { value: 'fromage', label: 'Fromage' },
  { value: 'fruit', label: 'Fruit' },
  { value: 'oleagineux', label: 'Oléagineux' },
  { value: 'sauce', label: 'Sauce' },
  { value: 'boisson', label: 'Boisson' },
  { value: 'supplement', label: 'Complément' },
  { value: 'autre', label: 'Autre' },
];

const round1 = (value: number): number => Math.round(value * 10) / 10;

@Component({
  selector: 'app-food-prefs-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FormsModule, Icon, NumPipe, Sheet, ScannerComponent],
  template: `
    <div class="page space-y-5">
      <header>
        <a routerLink="/profil" class="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-accent"><app-icon name="chevron-left" [size]="16" /> Profil</a>
        <div class="row items-end">
          <h1 class="title">Mes aliments</h1>
          <p class="pb-1 text-xs font-semibold" [class]="status() === 'error' ? 'text-danger' : 'text-muted'" aria-live="polite">{{ statusLabel() }}</p>
        </div>
      </header>

      <section class="card" aria-live="polite">
        <div class="flex items-baseline gap-2">
          <p class="num text-4xl font-bold tracking-tight" [class]="dishes().mainsHome < 14 ? 'text-warn' : ''">{{ dishes().mainsHome | num }}</p>
          <p class="font-semibold">{{ simpleStyle() ? 'assiettes différentes possibles' : 'plats différents possibles' }}</p>
        </div>
        <p class="num mt-1 text-sm text-muted">{{ dishes().snacksHome }} collations · {{ dishes().mainsAway }} repas à emporter · {{ dishes().snacksAway }} collations nomades</p>
        @if (dishes().mainsHomeFlavored > dishes().mainsHome) {
          <p class="num mt-1 text-sm text-muted">{{ dishes().mainsHomeFlavored | num }} en comptant les assaisonnements (cajun, paprika fumé, curry…).</p>
        }
        @if (dishes().mainsHome < 14) {
          <p class="mt-3 rounded-2xl bg-warn-soft px-3 py-2 text-sm text-warn">
            Moins de 14 plats : il n'y a plus de quoi remplir une semaine sans répétition. Autorise quelques aliments de plus.
          </p>
        }
      </section>

      <section>
        <h2 class="eyebrow mb-2">En un geste</h2>
        <div class="flex flex-wrap gap-2">
          @for (diet of diets; track diet.tag) {
            <button type="button" class="chip" [class.on]="tags().has(diet.tag)" [attr.aria-pressed]="tags().has(diet.tag)" (click)="toggleTag(diet.tag)">
              @if (tags().has(diet.tag)) {
                <app-icon name="check" [size]="16" />
              }
              {{ diet.label }}
            </button>
          }
        </div>
      </section>

      <section class="sticky top-0 z-10 -mx-5 space-y-3 bg-bg/90 px-5 py-3 backdrop-blur-xl">
        <label class="relative block">
          <span class="sr-only">Rechercher un aliment</span>
          <app-icon name="search" [size]="18" class="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-faint" />
          <input class="input !pl-11" type="search" placeholder="Rechercher un aliment" [ngModel]="query()" (ngModelChange)="query.set($event)" />
        </label>
        <div class="grid grid-cols-4 gap-1.5" role="tablist" aria-label="Filtrer les aliments">
          @for (f of filters(); track f.value) {
            <button
              type="button"
              role="tab"
              class="chip !min-h-9 justify-center !gap-1 !px-0 !text-[0.8125rem]"
              [class.on]="filter() === f.value"
              [attr.aria-selected]="filter() === f.value"
              (click)="filter.set(f.value)"
            >
              {{ f.label }} <span class="num opacity-60">{{ f.count }}</span>
            </button>
          }
        </div>
      </section>

      <p class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        @for (level of levels; track level.value) {
          <span class="inline-flex items-center gap-1.5"><app-icon [name]="level.icon" [size]="14" /> {{ level.label }}</span>
        }
        <span>· retouche un bouton pour revenir à neutre</span>
      </p>

      @for (group of visibleGroups(); track group.label) {
        <section>
          <div class="row mb-2">
            <h2 class="eyebrow">{{ group.label }}</h2>
            @if (group.diet && tags().has(group.diet.tag)) {
              <button type="button" class="text-xs font-semibold text-accent" (click)="toggleTag(group.diet.tag)">Réautoriser</button>
            }
          </div>
          <ul class="card divide !py-1">
            @for (food of group.foods; track food.id) {
              <li class="flex items-center gap-3 py-3" [class.opacity-50]="group.blocked">
                <button type="button" class="min-w-0 flex-1 text-left" [attr.aria-label]="'Valeurs de ' + food.name" (click)="open(food)">
                  <span class="block leading-snug font-semibold" [class.line-through]="group.blocked || level(food.id) === 'excluded'">{{ food.name }}</span>
                  <span class="num mt-0.5 block text-xs text-muted">
                    {{ food.per100.kcal | num }} kcal · {{ food.per100.protein | num }} g prot. / 100 {{ food.unit }}
                    @if (food.custom) {
                      <span class="font-semibold text-accent"> · {{ food.id.startsWith('mon-') ? 'mon aliment' : 'mon produit' }}</span>
                    }
                  </span>
                </button>
                @if (group.blocked) {
                  <span class="badge badge-warn shrink-0">{{ group.diet?.label }}</span>
                } @else {
                  <div class="flex shrink-0 gap-1.5" role="group" [attr.aria-label]="'Préférence pour ' + food.name">
                    @for (option of levels; track option.value) {
                      <button
                        type="button"
                        class="grid size-10 place-items-center rounded-full transition-colors"
                        [class]="level(food.id) === option.value ? option.active : 'bg-raised text-faint'"
                        [attr.aria-pressed]="level(food.id) === option.value"
                        [attr.aria-label]="option.label + ' : ' + food.name"
                        [title]="option.label"
                        (click)="set(food.id, option.value)"
                      >
                        <app-icon [name]="option.icon" [size]="19" />
                      </button>
                    }
                  </div>
                }
              </li>
            }
          </ul>
        </section>
      } @empty {
        <section class="card text-center text-muted">
          <app-icon name="search" [size]="26" />
          <p class="mt-2">Aucun aliment ne correspond.</p>
        </section>
      }

      <section class="card space-y-3">
        <h2 class="text-lg font-bold">Mes vrais produits</h2>
        <p class="text-sm leading-relaxed text-muted">
          Les valeurs affichées sont des moyennes. Touche un aliment pour les remplacer par celles de ton produit (étiquette ou scan) : les grammages de ton programme deviennent exacts.
        </p>
        <button type="button" class="btn w-full" (click)="create()"><app-icon name="plus" [size]="18" /> Ajouter un aliment</button>
        <p class="text-xs leading-relaxed text-muted">
          Valeurs moyennes : {{ ciqual.name }}, {{ ciqual.publisher }} (<a class="underline" [href]="ciqual.url" target="_blank" rel="noopener">ciqual.anses.fr</a>),
          {{ ciqual.license }}. Les quelques aliments absents de cette table sont signalés dans leur fiche.
        </p>
      </section>

      <section class="card space-y-3">
        <p class="text-sm leading-relaxed text-muted">
          <strong class="text-fg">J'aime</strong> : revient plus souvent. <strong class="text-fg">Rarement</strong> : une fois par semaine au plus.
          <strong class="text-fg">Jamais</strong> : n'apparaît dans aucun repas. Tes choix s'appliquent à la prochaine semaine générée et aux prochains remplacements de repas.
        </p>
        <a routerLink="/programme" class="btn btn-dark w-full"><app-icon name="refresh" [size]="18" /> Aller régénérer ma semaine</a>
      </section>
    </div>

    @if (form(); as f) {
      <app-sheet [title]="f.id ? f.name : 'Nouvel aliment'" (closed)="form.set(null)">
        <form class="space-y-5" (ngSubmit)="saveFood()">
          @if (!f.id) {
            <div>
              <label class="label" for="f-name">Nom</label>
              <input id="f-name" class="input" name="name" maxlength="80" placeholder="Galettes de maïs" required [(ngModel)]="f.name" />
            </div>
            <div>
              <p class="label">Famille</p>
              <div class="flex flex-wrap gap-1.5">
                @for (c of categories; track c.value) {
                  <button type="button" class="chip" [class.on]="f.category === c.value" (click)="f.category = c.value">{{ c.label }}</button>
                }
              </div>
            </div>
          } @else if (f.productName) {
            <p class="rounded-2xl bg-accent-soft px-4 py-3 text-sm text-accent">Valeurs de ton produit : <strong>{{ f.productName }}</strong></p>
          } @else if (f.source) {
            <p class="flex gap-2.5 rounded-2xl bg-card px-4 py-3 text-sm leading-relaxed text-muted">
              <app-icon name="info" [size]="18" class="mt-0.5" />
              <span>{{ f.source }}</span>
            </p>
          }

          <button type="button" class="btn btn-dark w-full" [disabled]="looking()" (click)="scanning.set(true)">
            <app-icon name="scan" [size]="18" />
            {{ looking() ? 'Recherche du produit…' : 'Scanner mon produit' }}
          </button>

          <div>
            <p class="label">Pour 100 {{ f.unit }} (produit tel qu'acheté, cru)</p>
            <div class="grid grid-cols-2 gap-3">
              <label class="block">
                <span class="mb-1 block text-xs text-muted">Calories (kcal)</span>
                <input class="input num" name="kcal" type="number" inputmode="decimal" min="0" step="any" required [(ngModel)]="f.kcal" />
              </label>
              <label class="block">
                <span class="mb-1 block text-xs text-muted">Protéines (g)</span>
                <input class="input num" name="protein" type="number" inputmode="decimal" min="0" step="any" required [(ngModel)]="f.protein" />
              </label>
              <label class="block">
                <span class="mb-1 block text-xs text-muted">Glucides (g)</span>
                <input class="input num" name="carbs" type="number" inputmode="decimal" min="0" step="any" required [(ngModel)]="f.carbs" />
              </label>
              <label class="block">
                <span class="mb-1 block text-xs text-muted">Lipides (g)</span>
                <input class="input num" name="fat" type="number" inputmode="decimal" min="0" step="any" required [(ngModel)]="f.fat" />
              </label>
              <label class="block">
                <span class="mb-1 block text-xs text-muted">Fibres (g)</span>
                <input class="input num" name="fiber" type="number" inputmode="decimal" min="0" step="any" [(ngModel)]="f.fiber" />
              </label>
              @if (f.pieceLabel || !f.id) {
                <label class="block">
                  <span class="mb-1 block text-xs text-muted">{{ f.pieceLabel ? 'Poids : 1 ' + f.pieceLabel + ' (g)' : 'Poids d’une pièce (g), si utile' }}</span>
                  <input class="input num" name="piece" type="number" inputmode="decimal" min="1" step="any" [(ngModel)]="f.pieceGrams" />
                </label>
              }
            </div>
          </div>

          @if (mismatch(f); as m) {
            <p class="rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn" role="alert">
              Ces protéines, glucides et lipides donnent environ {{ m | num }} kcal, pas {{ f.kcal | num }}. Vérifie la saisie (valeurs pour 100 g, pas par portion).
            </p>
          }

          @if (!f.id) {
            <div class="grid grid-cols-2 gap-3">
              <label class="block">
                <span class="mb-1 block text-xs text-muted">Poids du paquet (g)</span>
                <input class="input num" name="packGrams" type="number" inputmode="decimal" min="1" step="any" [(ngModel)]="f.packGrams" />
              </label>
              <label class="block">
                <span class="mb-1 block text-xs text-muted">Prix du paquet (€)</span>
                <input class="input num" name="packPrice" type="number" inputmode="decimal" min="0" step="any" [(ngModel)]="f.packPrice" />
              </label>
            </div>
            <p class="text-xs leading-relaxed text-muted">Un aliment ajouté apparaît dans tes stocks et tes recettes perso (« Mes recettes »). Les modèles de repas existants ne l'utilisent pas d'eux-mêmes.</p>
          } @else {
            <p class="text-xs leading-relaxed text-muted">Tes programmes en cours sont recalculés avec ces valeurs : les quantités peuvent bouger de quelques grammes.</p>
          }

          <button type="submit" class="btn btn-primary btn-lg" [disabled]="store.busy()">{{ store.busy() ? 'Enregistrement…' : 'Enregistrer' }}</button>
          @if (f.custom && f.id) {
            <button type="button" class="btn btn-danger w-full" [disabled]="store.busy()" (click)="resetFood(f)">
              {{ f.own ? 'Supprimer cet aliment' : 'Revenir aux valeurs moyennes' }}
            </button>
          }
        </form>
      </app-sheet>
    }

    @if (scanning()) {
      <app-scanner (code)="onScan($event)" (closed)="scanning.set(false)" />
    }
  `,
})
export class FoodPrefsPage implements OnDestroy {
  protected readonly store = inject(Store);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);

  protected readonly categories = CATEGORIES;
  protected readonly simpleStyle = computed(() => (this.store.user()?.preferences.style ?? 'simple') === 'simple');
  protected readonly ciqual = CIQUAL_SOURCE;
  protected readonly form = signal<FoodForm | null>(null);
  protected readonly scanning = signal(false);
  protected readonly looking = signal(false);

  protected readonly levels = LEVELS;
  protected readonly diets = GROUPS.flatMap((g) => (g.diet ? [g.diet] : []));
  protected readonly query = signal('');
  protected readonly filter = signal<Filter>('all');
  protected readonly status = signal<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Brouillon local : chaque geste est immédiat à l'écran, l'enregistrement suit en arrière-plan.
  private readonly prefs = this.store.user()?.preferences;
  private readonly liked = signal(new Set(this.prefs?.likedFoods ?? []));
  private readonly limited = signal(new Set(this.prefs?.limitedFoods ?? []));
  private readonly excluded = signal(new Set(this.prefs?.excludedFoods ?? []));
  protected readonly tags = signal(new Set(this.prefs?.excludedTags ?? []));
  private timer: ReturnType<typeof setTimeout> | null = null;

  protected readonly statusLabel = computed(() => {
    switch (this.status()) {
      case 'saving':
        return 'Enregistrement…';
      case 'saved':
        return 'Enregistré';
      case 'error':
        return 'Non enregistré — réessaie';
      default:
        return '';
    }
  });

  protected readonly dishes = computed(() =>
    countPossibleDishes(this.store.foodList(), this.store.templates(), {
      excludedFoods: [...this.excluded()],
      excludedTags: [...this.tags()],
      bannedTemplates: [],
      style: this.store.user()?.preferences.style ?? 'simple',
    }),
  );

  private blocked(food: Food): boolean {
    return this.tags().has(food.category) || food.tags.some((t) => this.tags().has(t));
  }

  protected level(id: string): Level | null {
    if (this.excluded().has(id)) return 'excluded';
    if (this.limited().has(id)) return 'limited';
    if (this.liked().has(id)) return 'liked';
    return null;
  }

  protected readonly filters = computed(() => {
    const foods = this.store.foodList();
    const blocked = foods.filter((f) => this.blocked(f)).length;
    return [
      { value: 'all' as Filter, label: 'Tous', count: foods.length },
      { value: 'liked' as Filter, label: "J'aime", count: foods.filter((f) => !this.blocked(f) && this.level(f.id) === 'liked').length },
      { value: 'limited' as Filter, label: 'Rarement', count: foods.filter((f) => !this.blocked(f) && this.level(f.id) === 'limited').length },
      { value: 'excluded' as Filter, label: 'Jamais', count: blocked + foods.filter((f) => !this.blocked(f) && this.level(f.id) === 'excluded').length },
    ];
  });

  protected readonly visibleGroups = computed(() => {
    const query = normalize(this.query());
    const filter = this.filter();
    const matches = (food: Food): boolean => {
      if (query && !normalize(`${food.name} ${food.shortName}`).includes(query)) return false;
      if (filter === 'all') return true;
      if (filter === 'excluded') return this.blocked(food) || this.level(food.id) === 'excluded';
      return !this.blocked(food) && this.level(food.id) === filter;
    };
    return GROUPS.map((group) => ({
      ...group,
      blocked: !!group.diet && this.tags().has(group.diet.tag),
      foods: this.store
        .foodList()
        .filter((f) => group.categories.includes(f.category) && matches(f))
        .sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    })).filter((group) => group.foods.length > 0);
  });

  /** Active un niveau pour un aliment ; retoucher le niveau actif revient à neutre. */
  protected set(id: string, target: Level): void {
    const current = this.level(id);
    const without = (set: Set<string>) => {
      const next = new Set(set);
      next.delete(id);
      return next;
    };
    this.liked.update(without);
    this.limited.update(without);
    this.excluded.update(without);
    if (current !== target) {
      const bucket = target === 'liked' ? this.liked : target === 'limited' ? this.limited : this.excluded;
      bucket.update((set) => new Set(set).add(id));
    }
    this.scheduleSave();
  }

  protected toggleTag(tag: string): void {
    this.tags.update((set) => {
      const next = new Set(set);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
    this.scheduleSave();
  }

  private scheduleSave(): void {
    this.status.set('saving');
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.save(), 700);
  }

  private async save(): Promise<void> {
    this.timer = null;
    const ok = await this.store.updateMe({
      preferences: {
        likedFoods: [...this.liked()],
        limitedFoods: [...this.limited()],
        excludedFoods: [...this.excluded()],
        excludedTags: [...this.tags()],
      },
    });
    // Un nouveau geste a pu arriver pendant l'envoi : on ne conclut que s'il n'y a rien en attente.
    if (!this.timer) this.status.set(ok ? 'saved' : 'error');
  }

  // ───────────── Mes vrais produits ─────────────

  protected open(food: Food): void {
    this.form.set({
      id: food.id,
      name: food.name,
      category: food.category,
      unit: food.unit,
      kcal: food.per100.kcal,
      protein: food.per100.protein,
      carbs: food.per100.carbs,
      fat: food.per100.fat,
      fiber: food.per100.fiber,
      pieceLabel: food.piece?.label ?? null,
      pieceGrams: food.piece?.grams ?? null,
      productName: food.productName ?? '',
      packGrams: null,
      packPrice: null,
      custom: !!food.custom,
      own: food.id.startsWith('mon-'),
      source: this.sourceOf(food),
    });
  }

  private sourceOf(food: Food): string {
    if (food.custom) return food.id.startsWith('mon-') ? '' : 'Valeurs saisies par toi, à la place de la moyenne du catalogue.';
    if (!food.ciqual) return "Valeurs moyennes relevées sur des étiquettes : cet aliment n'est pas dans la table Ciqual. Remplace-les par celles de ton produit.";
    const parts = [`Valeurs moyennes de la table Ciqual 2020 (Anses) : « ${food.ciqual.label} ».`];
    if (food.ciqual.note) parts.push(food.ciqual.note);
    if (food.ciqual.energyComputed) parts.push("Calories calculées à partir des protéines, glucides, lipides et fibres : la table ne les donne pas pour cet aliment.");
    return parts.join(' ');
  }

  protected create(): void {
    this.form.set({
      id: null,
      name: '',
      category: 'autre',
      unit: 'g',
      kcal: null,
      protein: null,
      carbs: null,
      fat: null,
      fiber: null,
      pieceLabel: null,
      pieceGrams: null,
      productName: '',
      packGrams: null,
      packPrice: null,
      custom: false,
      own: true,
      source: '',
    });
  }

  /**
   * Garde-fou de saisie : 4 kcal par gramme de protéines et de glucides, 9 par gramme de lipides.
   * Renvoie les calories attendues quand elles s'écartent nettement de la valeur saisie.
   */
  protected mismatch(f: FoodForm): number | null {
    if (f.kcal === null || f.protein === null || f.carbs === null || f.fat === null) return null;
    const expected = 4 * +f.protein + 4 * +f.carbs + 9 * +f.fat;
    return Math.abs(expected - +f.kcal) > Math.max(25, +f.kcal * 0.2) ? Math.round(expected) : null;
  }

  protected async onScan(ean: string): Promise<void> {
    this.scanning.set(false);
    const f = this.form();
    if (!f) return;
    this.looking.set(true);
    try {
      const { product } = await this.api.get<ResolveOutcome>(`/barcodes/${ean}`);
      const n = product?.per100;
      if (!product || n?.kcal == null || n.protein == null || n.carbs == null || n.fat == null) {
        this.toasts.info(product ? 'Produit trouvé, mais sans valeurs nutritionnelles complètes : recopie celles de l’étiquette.' : 'Produit inconnu : recopie les valeurs de l’étiquette.');
        return;
      }
      this.form.set({
        ...f,
        name: f.id || f.name.trim() ? f.name : product.name,
        kcal: round1(n.kcal),
        protein: round1(n.protein),
        carbs: round1(n.carbs),
        fat: round1(n.fat),
        fiber: n.fiber == null ? f.fiber : round1(n.fiber),
        // « Nutella — Nutella » n'apprend rien : la marque n'est ajoutée que si le nom ne la contient pas.
        productName: (product.brand && !normalize(product.name).includes(normalize(product.brand)) ? `${product.brand} — ${product.name}` : product.name).slice(0, 120),
        packGrams: f.packGrams ?? product.grams ?? null,
        packPrice: f.packPrice ?? product.price ?? null,
      });
      this.toasts.success('Valeurs du produit récupérées : compare avec ton étiquette avant d’enregistrer.');
    } catch (error) {
      this.toasts.error(error instanceof OfflineError ? 'Connexion requise pour identifier un produit.' : 'Recherche impossible pour ce code-barres.');
    } finally {
      this.looking.set(false);
    }
  }

  protected async saveFood(): Promise<void> {
    const f = this.form();
    if (!f) return;
    const required = [f.kcal, f.protein, f.carbs, f.fat];
    if (required.some((v) => v === null || (v as unknown) === '' || !Number.isFinite(+v) || +v < 0)) {
      this.toasts.error('Renseigne calories, protéines, glucides et lipides pour 100 g.');
      return;
    }
    if (!f.id && f.name.trim().length < 2) {
      this.toasts.error("Donne un nom à l'aliment.");
      return;
    }
    const saved = await this.store.saveFood({
      id: f.id ?? undefined,
      name: f.id ? undefined : f.name.trim(),
      category: f.id ? undefined : f.category,
      per100: { kcal: +f.kcal!, protein: +f.protein!, carbs: +f.carbs!, fat: +f.fat!, fiber: f.fiber ? +f.fiber : 0 },
      pieceGrams: f.pieceGrams ? +f.pieceGrams : undefined,
      productName: f.productName || undefined,
      packGrams: !f.id && f.packGrams ? +f.packGrams : undefined,
      packPrice: !f.id && f.packGrams && f.packPrice !== null ? +f.packPrice : undefined,
    });
    if (saved) {
      this.toasts.success(f.id ? 'Valeurs enregistrées, programmes recalculés.' : 'Aliment ajouté.');
      this.form.set(null);
    }
  }

  protected async resetFood(f: FoodForm): Promise<void> {
    if (!f.id) return;
    if (f.own && !confirm(`Supprimer « ${f.name} » de tes aliments ?`)) return;
    if (await this.store.resetFood(f.id)) {
      this.toasts.success(f.own ? 'Aliment supprimé.' : 'Valeurs moyennes rétablies, programmes recalculés.');
      this.form.set(null);
    }
  }

  ngOnDestroy(): void {
    // Quitter l'écran pendant le délai ne doit pas perdre le dernier geste.
    if (this.timer) {
      clearTimeout(this.timer);
      void this.save();
    }
  }
}
