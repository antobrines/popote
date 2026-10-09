import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { type CustomRecipeInput, type Food, type IngredientRole, buildCustomTemplate, ingredientLabel, itemFromSlot, itemsNutrition, normalize, solveMeal } from '@bouffe/core';
import { Store } from '../core/store';
import { Toasts } from '../core/toasts';
import { Icon, NumPipe, Sheet } from '../ui/ui';

interface Row {
  foodId: string;
  role: IngredientRole;
  grams: number | null;
}

interface Draft {
  id?: string;
  name: string;
  meal: 'main' | 'snack';
  away: boolean;
  dessert: boolean;
  rows: Row[];
  /** Une étape par ligne. */
  steps: string;
  prepMin: number;
  cookMin: number;
}

const ROLES: { value: IngredientRole; label: string }[] = [
  { value: 'protein', label: 'Protéine' },
  { value: 'energy', label: 'Féculent' },
  { value: 'fixed', label: 'Quantité fixe' },
];

const PROTEIN_CATEGORIES = new Set(['viande', 'poisson', 'oeuf', 'charcuterie']);
const ENERGY_CATEGORIES = new Set(['feculent', 'pain']);

function emptyDraft(): Draft {
  return { name: '', meal: 'main', away: false, dessert: true, rows: [], steps: '', prepMin: 10, cookMin: 15 };
}

/** « Mes recettes » : tu décris ton plat, le moteur dose les quantités pour tenir ta cible. */
@Component({
  selector: 'app-recipes-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, NumPipe, Sheet],
  template: `
    <div class="page space-y-6">
      <header>
        <a routerLink="/profil" class="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-accent"><app-icon name="chevron-left" [size]="16" /> Profil</a>
        <h1 class="title">Mes recettes</h1>
        <p class="mt-2 text-muted">Ajoute tes plats : ils entrent dans le tirage de la semaine et leurs quantités s'ajustent à ton objectif.</p>
      </header>

      <section class="space-y-3">
        @for (recipe of recipes(); track recipe.id) {
          <article class="card">
            <div class="row items-start">
              <div class="min-w-0">
                <h2 class="text-lg leading-snug font-bold">{{ recipe.name }}</h2>
                <div class="mt-1.5 flex flex-wrap gap-1.5">
                  <span class="badge">{{ recipe.meal === 'snack' ? 'Collation' : 'Plat' }}</span>
                  @if (recipe.away) {
                    <span class="badge badge-info"><app-icon name="bag" [size]="11" /> À emporter</span>
                  }
                  <span class="badge num">{{ recipe.prepMin + recipe.cookMin }} min</span>
                </div>
              </div>
              <div class="flex shrink-0 gap-1.5">
                <button type="button" class="grid size-10 place-items-center rounded-full bg-raised" (click)="edit(recipe)" [attr.aria-label]="'Modifier ' + recipe.name">
                  <app-icon name="edit" [size]="18" />
                </button>
                <button type="button" class="grid size-10 place-items-center rounded-full bg-danger-soft text-danger" (click)="remove(recipe)" [attr.aria-label]="'Supprimer ' + recipe.name">
                  <app-icon name="trash" [size]="18" />
                </button>
              </div>
            </div>
            <p class="mt-3 text-sm text-muted">{{ summary(recipe) }}</p>
          </article>
        } @empty {
          <div class="card text-center">
            <div class="mx-auto grid size-14 place-items-center rounded-full bg-accent-soft text-accent"><app-icon name="book" [size]="28" /></div>
            <h2 class="mt-4 text-xl font-bold">Aucune recette pour l'instant</h2>
            <p class="mt-2 text-muted">Ton chili, tes pâtes du dimanche, ta box du midi : écris-les une fois, l'application les programme et calcule les portions.</p>
          </div>
        }
        <button type="button" class="btn btn-primary btn-lg" (click)="create()"><app-icon name="plus" /> Nouvelle recette</button>
      </section>

      <p class="flex gap-3 rounded-3xl bg-card p-4 text-sm leading-relaxed text-muted">
        <app-icon name="info" [size]="20" class="mt-0.5" />
        <span>
          Une recette perso sort un peu plus souvent que les autres. Elle n'apparaît que dans les semaines générées après son ajout : régénère ta semaine pour la voir tout de suite.
        </span>
      </p>
    </div>

    @if (draft(); as d) {
      <app-sheet [title]="d.id ? 'Modifier la recette' : 'Nouvelle recette'" (closed)="close()">
        <div class="space-y-5">
          <div>
            <label class="label" for="r-name">Nom du plat</label>
            <input id="r-name" class="input" maxlength="60" placeholder="Chili maison" [value]="d.name" (input)="set({ name: text($event) })" />
          </div>

          <div class="flex flex-wrap gap-2">
            <button type="button" class="chip" [class.on]="d.meal === 'main'" (click)="set({ meal: 'main' })">Plat (midi / soir)</button>
            <button type="button" class="chip" [class.on]="d.meal === 'snack'" (click)="set({ meal: 'snack' })">Collation</button>
            <button type="button" class="chip" [class.on]="d.away" [attr.aria-pressed]="d.away" (click)="set({ away: !d.away })"><app-icon name="bag" [size]="14" /> À emporter</button>
          </div>

          <div>
            <p class="label">Ingrédients</p>
            <div class="space-y-2">
              @for (row of d.rows; track row.foodId; let i = $index) {
                <div class="rounded-2xl bg-card p-3">
                  <div class="row">
                    <span class="min-w-0 truncate font-semibold">{{ foodName(row.foodId) }}</span>
                    <button type="button" class="grid size-8 shrink-0 place-items-center rounded-full bg-raised text-muted" (click)="removeRow(i)" [attr.aria-label]="'Retirer ' + foodName(row.foodId)">
                      <app-icon name="x" [size]="14" />
                    </button>
                  </div>
                  <div class="mt-2 flex flex-wrap items-center gap-1.5">
                    @for (role of roles; track role.value) {
                      <button type="button" class="chip !min-h-8 !px-3 !text-[0.8125rem]" [class.on]="row.role === role.value" (click)="setRole(i, role.value)">{{ role.label }}</button>
                    }
                    @if (row.role === 'fixed') {
                      <label class="ml-auto flex items-center gap-1.5 text-sm text-muted">
                        <input
                          class="input num !min-h-9 w-20 !px-2 text-right"
                          type="number"
                          inputmode="numeric"
                          min="1"
                          [attr.aria-label]="'Quantité de ' + foodName(row.foodId)"
                          [value]="row.grams ?? ''"
                          (input)="setGrams(i, $event)"
                        />
                        {{ foodUnit(row.foodId) }}
                      </label>
                    }
                  </div>
                </div>
              }
            </div>

            @if (picking()) {
              <div class="mt-2 rounded-2xl bg-card p-3">
                <div class="relative">
                  <app-icon name="search" [size]="18" class="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-faint" />
                  <input class="input !pl-10" type="search" placeholder="Chercher un aliment" aria-label="Chercher un aliment" [value]="query()" (input)="query.set(text($event))" />
                </div>
                <ul class="mt-2 max-h-60 divide overflow-y-auto">
                  @for (food of matches(); track food.id) {
                    <li>
                      <button type="button" class="row w-full py-2.5 text-left" (click)="addRow(food)">
                        <span class="min-w-0 truncate">{{ food.name }}</span>
                        <span class="num shrink-0 text-xs text-muted">{{ food.per100.kcal | num }} kcal · {{ food.per100.protein | num }} g prot. / 100 {{ food.unit }}</span>
                      </button>
                    </li>
                  } @empty {
                    <li class="py-3 text-sm text-muted">Aucun aliment trouvé. Tu peux en créer un dans « Mes aliments ».</li>
                  }
                </ul>
              </div>
            } @else {
              <button type="button" class="btn mt-2 w-full bg-card" (click)="picking.set(true)"><app-icon name="plus" [size]="18" /> Ajouter un ingrédient</button>
            }
            <p class="mt-2 text-xs leading-relaxed text-muted">
              <strong>Protéine</strong> : la quantité s'ajuste pour atteindre tes protéines. <strong>Féculent</strong> : elle s'ajuste pour atteindre tes calories. <strong>Quantité fixe</strong> :
              celle de ta recette, jamais modifiée. Un seul ingrédient ajustable de chaque type.
            </p>
          </div>

          <button type="button" class="row w-full rounded-2xl bg-card px-4 py-3 text-left" [attr.aria-pressed]="d.dessert" (click)="set({ dessert: !d.dessert })">
            <span>
              <span class="block font-medium">Finir par un laitage et un fruit</span>
              <span class="text-sm text-muted">Comme les autres repas du programme.</span>
            </span>
            <span class="grid size-7 shrink-0 place-items-center rounded-full" [class]="d.dessert ? 'bg-accent text-on-accent' : 'bg-raised text-transparent'"><app-icon name="check" [size]="16" [stroke]="2.6" /></span>
          </button>

          <div>
            <label class="label" for="r-steps">Étapes (une par ligne)</label>
            <textarea id="r-steps" class="input !h-auto py-3 leading-relaxed" rows="5" placeholder="Faire revenir la viande 8 min.&#10;Ajouter la sauce et laisser mijoter 15 min." [value]="d.steps" (input)="set({ steps: text($event) })"></textarea>
            <p class="mt-1 text-xs text-muted">Écris les durées en minutes (« 15 min ») : le mode cuisine en fera des minuteurs.</p>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="label" for="r-prep">Préparation (min)</label>
              <input id="r-prep" class="input num" type="number" inputmode="numeric" min="0" [value]="d.prepMin" (input)="set({ prepMin: number($event) })" />
            </div>
            <div>
              <label class="label" for="r-cook">Cuisson (min)</label>
              <input id="r-cook" class="input num" type="number" inputmode="numeric" min="0" [value]="d.cookMin" (input)="set({ cookMin: number($event) })" />
            </div>
          </div>

          @if (preview(); as p) {
            @if (p.error) {
              <p class="rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn" role="alert">{{ p.error }}</p>
            } @else {
              <div class="rounded-2xl bg-card p-4">
                <p class="eyebrow">Exemple de portion pour ton objectif</p>
                <ul class="mt-2 space-y-1 text-sm">
                  @for (line of p.lines; track line) {
                    <li>{{ line }}</li>
                  }
                </ul>
                <p class="num mt-3 border-t border-line pt-3 text-sm">
                  <span class="font-semibold">{{ p.kcal | num }} kcal</span> · <span class="font-semibold text-protein">{{ p.protein | num }} g</span> de protéines
                  <span class="text-muted"> (visé : {{ p.targetKcal | num }} kcal, {{ p.targetProtein | num }} g)</span>
                </p>
                @if (p.note) {
                  <p class="mt-2 text-xs leading-relaxed text-muted">{{ p.note }}</p>
                }
              </div>
            }
          }

          <button type="button" class="btn btn-primary btn-lg" [disabled]="store.busy() || !preview() || !!preview()?.error" (click)="save()">
            {{ store.busy() ? 'Enregistrement…' : 'Enregistrer la recette' }}
          </button>
        </div>
      </app-sheet>
    }
  `,
})
export class RecipesPage {
  protected readonly store = inject(Store);
  private readonly toasts = inject(Toasts);

  protected readonly roles = ROLES;
  protected readonly recipes = computed(() => this.store.state()?.customRecipes ?? []);
  protected readonly draft = signal<Draft | null>(null);
  protected readonly picking = signal(false);
  protected readonly query = signal('');

  protected readonly matches = computed(() => {
    const used = new Set(this.draft()?.rows.map((r) => r.foodId));
    const q = normalize(this.query().trim());
    return this.store
      .foodList()
      .filter((f) => !used.has(f.id) && (!q || normalize(f.name).includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
      .slice(0, 30);
  });

  /**
   * Ce que le moteur ferait de la recette pour un repas type : il valide la saisie (mêmes règles que
   * le serveur) et montre les portions obtenues avant d'enregistrer.
   */
  protected readonly preview = computed(() => {
    const d = this.draft();
    const foods = this.store.foods();
    if (!d || foods.size === 0) return null;
    if (!d.name.trim() && d.rows.length === 0) return null;
    try {
      const template = buildCustomTemplate(this.toInput(d), foods);
      const items = template.items.map((slot) => itemFromSlot(slot, foods.get(slot.foods[0]!)!));
      const target = this.store.target();
      // Part habituelle d'un repas dans la journée : un plat ≈ 42 %, une collation ≈ 15 %.
      const share = d.meal === 'snack' ? 0.15 : 0.42;
      const targetKcal = Math.round((target.kcal * share) / 10) * 10;
      const targetProtein = Math.round(target.protein * share);
      solveMeal(items, foods, targetKcal, targetProtein);
      const nutrition = itemsNutrition(items, foods);
      const adjustable = items.some((i) => i.scaling !== 'fixed');
      const off = Math.abs(nutrition.kcal - targetKcal) > targetKcal * 0.15;
      return {
        error: null,
        lines: items.map((i) => ingredientLabel(foods.get(i.foodId)!, i.grams)),
        kcal: nutrition.kcal,
        protein: nutrition.protein,
        targetKcal,
        targetProtein,
        note: !adjustable
          ? 'Toutes les quantités sont fixes : le plat aura toujours ces valeurs, et les autres repas de la journée compenseront.'
          : off
            ? 'Les portions ne suffisent pas à atteindre la part visée : les autres repas de la journée compenseront. Un ingrédient « Protéine » et un « Féculent » donnent plus de marge.'
            : null,
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Recette incomplète.', lines: [], kcal: 0, protein: 0, targetKcal: 0, targetProtein: 0, note: null };
    }
  });

  private toInput(d: Draft): CustomRecipeInput {
    return {
      id: d.id,
      name: d.name,
      meal: d.meal,
      away: d.away,
      dessert: d.dessert,
      ingredients: d.rows.map((r) => ({ foodId: r.foodId, role: r.role, grams: r.role === 'fixed' ? (r.grams ?? undefined) : undefined })),
      steps: d.steps
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      prepMin: d.prepMin,
      cookMin: d.cookMin,
    };
  }

  protected foodName(id: string): string {
    return this.store.foods().get(id)?.name ?? id;
  }

  protected foodUnit(id: string): string {
    return this.store.foods().get(id)?.unit ?? 'g';
  }

  protected summary(recipe: CustomRecipeInput): string {
    return recipe.ingredients.map((i) => this.store.foods().get(i.foodId)?.shortName ?? i.foodId).join(' · ');
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  protected number(event: Event): number {
    const value = Number((event.target as HTMLInputElement).value);
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
  }

  protected set(patch: Partial<Draft>): void {
    this.draft.update((d) => (d ? { ...d, ...patch } : d));
  }

  protected create(): void {
    this.query.set('');
    this.picking.set(true);
    this.draft.set(emptyDraft());
  }

  protected edit(recipe: CustomRecipeInput & { id: string }): void {
    this.query.set('');
    this.picking.set(false);
    this.draft.set({
      id: recipe.id,
      name: recipe.name,
      meal: recipe.meal,
      away: recipe.away,
      dessert: recipe.dessert,
      rows: recipe.ingredients.map((i) => ({ foodId: i.foodId, role: i.role, grams: i.grams ?? null })),
      steps: recipe.steps.join('\n'),
      prepMin: recipe.prepMin,
      cookMin: recipe.cookMin,
    });
  }

  protected close(): void {
    this.draft.set(null);
    this.picking.set(false);
  }

  /** Rôle proposé d'après le type d'aliment — et seulement si le levier n'est pas déjà pris. */
  protected addRow(food: Food): void {
    const rows = this.draft()?.rows ?? [];
    const free = (role: IngredientRole) => !rows.some((r) => r.role === role);
    let role: IngredientRole = 'fixed';
    if (PROTEIN_CATEGORIES.has(food.category) && free('protein')) role = 'protein';
    else if (ENERGY_CATEGORIES.has(food.category) && free('energy')) role = 'energy';
    const grams = food.piece ? food.piece.grams : Math.round((food.portion.min + food.portion.max) / 2 / food.portion.step) * food.portion.step;
    this.set({ rows: [...rows, { foodId: food.id, role, grams }] });
    this.query.set('');
    this.picking.set(false);
  }

  protected removeRow(index: number): void {
    this.set({ rows: (this.draft()?.rows ?? []).filter((_, i) => i !== index) });
  }

  /** Un seul levier de chaque type : en choisir un nouveau rend l'ancien fixe. */
  protected setRole(index: number, role: IngredientRole): void {
    const rows = (this.draft()?.rows ?? []).map((row, i) => {
      if (i === index) return { ...row, role };
      return role !== 'fixed' && row.role === role ? { ...row, role: 'fixed' as const } : row;
    });
    this.set({ rows });
  }

  protected setGrams(index: number, event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    const grams = Number.isFinite(value) && value > 0 ? Math.round(value) : null;
    this.set({ rows: (this.draft()?.rows ?? []).map((row, i) => (i === index ? { ...row, grams } : row)) });
  }

  protected async save(): Promise<void> {
    const d = this.draft();
    if (!d || !this.preview() || this.preview()?.error) return;
    if (await this.store.saveRecipe(this.toInput(d))) {
      this.toasts.success(d.id ? 'Recette mise à jour.' : 'Recette ajoutée : elle entrera dans tes prochaines semaines.');
      this.close();
    }
  }

  protected async remove(recipe: CustomRecipeInput & { id: string }): Promise<void> {
    if (!confirm(`Supprimer « ${recipe.name} » ? Les repas déjà programmés ne changent pas.`)) return;
    if (await this.store.deleteRecipe(recipe.id)) this.toasts.success('Recette supprimée.');
  }
}
