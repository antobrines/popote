/**
 * Mode recette et meal prep : ingrédients exacts (cru / cuit), étapes et temps,
 * entièrement dérivés des quantités du repas.
 */
import { type FoodIndex, cookedGrams, itemsNutrition, nutrientsFor, requireFood, roundNutrients } from '../nutrition.js';
import type {
  CookingInstruction,
  Food,
  Meal,
  MealPrepPlan,
  MealPrepPortion,
  MealSlotKind,
  MealTemplate,
  PrepLevel,
  PrepMode,
  Recipe,
  RecipeIngredient,
  WeekPlan,
} from '../types.js';
import { DAY_LABELS } from '../util.js';

export interface RecipeOptions {
  level: PrepLevel;
  /** Appareils disponibles, par ordre de préférence. Vide = pas de contrainte. */
  equipment: PrepMode[];
}

export const PREP_MODE_LABELS: Record<PrepMode, string> = {
  'air-fryer': 'Air fryer',
  poele: 'Poêle',
  four: 'Four',
  'rice-cooker': 'Rice cooker',
  casserole: 'Casserole',
  'one-pot': 'One-pot',
  'micro-ondes': 'Micro-ondes',
  aucune: 'Sans cuisson',
};

export const SLOT_LABELS: Record<MealSlotKind, string> = {
  'petit-dejeuner': 'Petit-déjeuner',
  dejeuner: 'Déjeuner',
  collation: 'Collation',
  diner: 'Dîner',
};

/** Nom en cours de phrase : seule l'initiale passe en minuscule (« Steak haché 5 % MG » garde « MG »). */
export function lowerName(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

function elide(name: string): string {
  return /^[aeiouyhéèêàâîôûœ]/i.test(name) ? `d'${name}` : `de ${name}`;
}

/**
 * « 100 g de riz basmati (poids cru, ≈ 280 g cuit) », « 3 œufs (165 g) »…
 * En version courte (étapes de recette) : « 100 g de riz basmati », « 3 œufs ».
 */
export function ingredientLabel(food: Food, grams: number, short = false): string {
  if (food.piece) {
    const count = Math.round((grams / food.piece.grams) * 10) / 10;
    const noun = count > 1 ? food.piece.plural : food.piece.label;
    const base = `${count.toLocaleString('fr-FR')} ${noun}`;
    return short ? base : `${base} (${Math.round(grams)} ${food.unit})`;
  }
  const base = `${Math.round(grams)} ${food.unit} ${elide(lowerName(food.name))}`;
  if (food.measure) {
    // « 3 g d'épices cajun (≈ 1 c. à café) » : plus parlant qu'un poids pour une épice.
    const count = Math.round((grams / food.measure.grams) * 2) / 2;
    if (count >= 0.5) return `${base} (≈ ${count.toLocaleString('fr-FR')} ${food.measure.label})`;
  }
  const cooked = short ? undefined : cookedGrams(food, grams);
  return cooked ? `${base} (poids cru, ≈ ${cooked} g cuit)` : base;
}

export function recipeIngredient(food: Food, grams: number): RecipeIngredient {
  return {
    foodId: food.id,
    name: food.name,
    grams,
    pieces: food.piece ? Math.round((grams / food.piece.grams) * 10) / 10 : undefined,
    pieceLabel: food.piece?.label,
    cookedGrams: cookedGrams(food, grams),
    unit: food.unit,
    nutrition: roundNutrients(nutrientsFor(food, grams)),
    label: ingredientLabel(food, grams),
  };
}

/** Choisit la consigne de cuisson selon l'équipement et le niveau de préparation. */
export function pickCooking(food: Food, options: RecipeOptions): CookingInstruction | undefined {
  const all = food.cooking ?? [];
  if (all.length === 0) return undefined;
  const usable = options.equipment.length > 0 ? all.filter((c) => c.mode === 'aucune' || options.equipment.includes(c.mode)) : all;
  const pool = usable.length > 0 ? usable : all;
  if (options.level === 'ultra-rapide') {
    return [...pool].sort((a, b) => a.minutes - b.minutes)[0];
  }
  if (options.equipment.length > 0) {
    return [...pool].sort((a, b) => rank(options.equipment, a.mode) - rank(options.equipment, b.mode))[0];
  }
  return pool[0];
}

function rank(equipment: PrepMode[], mode: PrepMode): number {
  const i = equipment.indexOf(mode);
  return i < 0 ? equipment.length : i;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function buildRecipe(meal: Meal, template: MealTemplate | undefined, foods: FoodIndex, options: RecipeOptions): Recipe {
  const ingredients = meal.items.map((i) => recipeIngredient(requireFood(foods, i.foodId), i.grams));
  const methods = new Set<PrepMode>();
  let cookFromFoods = 0;
  const bySlot = new Map(meal.items.map((i) => [i.slotKey, i]));

  const render = (step: string): string | null => {
    let missing = false;
    const text = step.replace(/\{(\w+)(?::(\w+))?\}/g, (_, key: string, mod?: string) => {
      const item = bySlot.get(key);
      if (!item) {
        missing = true;
        return '';
      }
      const food = requireFood(foods, item.foodId);
      const label = ingredientLabel(food, item.grams, true);
      if (mod === 'cook') {
        const cooking = pickCooking(food, options);
        if (!cooking) return `Préparer ${label}.`;
        methods.add(cooking.mode);
        cookFromFoods = Math.max(cookFromFoods, cooking.minutes);
        return cooking.text.replace('{qty}', label);
      }
      if (mod === 'name') return lowerName(food.name);
      return label;
    });
    return missing ? null : capitalize(text.trim());
  };

  const sourceSteps = template?.steps ?? ['Préparer et assembler les ingrédients listés.'];
  const steps = sourceSteps.map(render).filter((s): s is string => !!s);
  for (const mode of template?.methods ?? []) {
    if (template?.kind === 'one-pot' || template?.cookMin) methods.add(mode);
  }
  if (methods.size === 0) methods.add('aucune');

  return {
    title: meal.name,
    prepMin: template?.prepMin ?? 5,
    cookMin: template?.cookMin || cookFromFoods,
    methods: [...methods],
    ingredients,
    steps,
    nutrition: itemsNutrition(meal.items, foods),
  };
}

// ───────────────────────────── Meal prep ─────────────────────────────

const NOT_PREPPED_SLOTS = new Set(['dairy', 'fruit', 'compote', 'drink', 'nuts', 'sweet']);

/** Ingrédients à cuisiner d'un repas (hors laitage, fruit et accompagnements servis à part). */
export function cookedItems<T extends { slotKey: string }>(items: T[]): T[] {
  return items.filter((i) => !NOT_PREPPED_SLOTS.has(i.slotKey));
}

/**
 * « Préparer mes repas pour N jours » : regroupe les quantités des plats maison à cuisiner,
 * puis explique comment les préparer et les répartir par portion.
 */
export function buildMealPrep(
  plan: Pick<WeekPlan, 'days'>,
  foods: FoodIndex,
  fromDay: number,
  days: number,
  options: RecipeOptions,
): MealPrepPlan {
  const portions: MealPrepPortion[] = [];
  const totals = new Map<string, number>();

  for (const day of plan.days.filter((d) => d.index >= fromDay && d.index < fromDay + days)) {
    for (const meal of day.meals) {
      if (meal.context !== 'home' || (meal.slot !== 'dejeuner' && meal.slot !== 'diner')) continue;
      if (meal.status !== 'planned') continue;
      const items = meal.items.filter((i) => !NOT_PREPPED_SLOTS.has(i.slotKey));
      if (items.length === 0) continue;
      portions.push({
        dayIndex: day.index,
        date: day.date,
        slot: meal.slot,
        mealName: meal.name,
        items: items.map((i) => {
          const food = requireFood(foods, i.foodId);
          return { foodId: food.id, name: food.name, rawGrams: i.grams, cookedGrams: cookedGrams(food, i.grams) };
        }),
      });
      for (const item of items) totals.set(item.foodId, (totals.get(item.foodId) ?? 0) + item.grams);
    }
  }

  const totalList = [...totals.entries()]
    .map(([foodId, rawGrams]) => {
      const food = requireFood(foods, foodId);
      return { foodId, name: food.name, rawGrams, cookedGrams: cookedGrams(food, rawGrams), label: ingredientLabel(food, rawGrams) };
    })
    .sort((a, b) => b.rawGrams - a.rawGrams);

  const steps: string[] = [];
  const batchOptions: RecipeOptions = { ...options, level: 'meal-prep' };
  for (const total of totalList) {
    const food = requireFood(foods, total.foodId);
    const cooking = pickCooking(food, batchOptions);
    if (!cooking) continue;
    steps.push(cooking.text.replace('{qty}', total.label));
    const shares = portions
      .map((p) => ({ p, item: p.items.find((i) => i.foodId === total.foodId) }))
      .filter((x): x is { p: MealPrepPortion; item: NonNullable<MealPrepPortion['items'][number]> } => !!x.item)
      .map(({ p, item }) => `${DAY_LABELS[p.dayIndex]} ${SLOT_LABELS[p.slot].toLowerCase()} : ${item.cookedGrams ?? item.rawGrams} g${item.cookedGrams ? ' cuit' : ''}`);
    if (shares.length > 1) {
      steps.push(`Répartir ${lowerName(food.name)} une fois cuit — ${shares.join(' · ')}.`);
    }
  }
  const uncooked = totalList.filter((t) => !requireFood(foods, t.foodId).cooking?.length);
  if (uncooked.length > 0) {
    steps.push(
      `Ajouter au moment de servir (ou directement dans chaque boîte), selon les quantités de chaque repas : ${uncooked.map((t) => t.label).join(', ')}.`,
    );
  }
  if (portions.length > 0) {
    steps.push(`Répartir dans ${portions.length} boîte${portions.length > 1 ? 's' : ''} hermétique${portions.length > 1 ? 's' : ''} et étiqueter (jour + repas).`);
  }

  return {
    fromDay,
    days,
    totals: totalList,
    portions,
    steps,
    storageNote:
      'Refroidir rapidement, conserver au réfrigérateur (4 °C max) et consommer dans les 3 jours. Au-delà, congeler les portions. Réchauffer à cœur avant de manger.',
  };
}
