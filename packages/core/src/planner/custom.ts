/**
 * Recettes personnelles : l'utilisateur décrit son plat (ingrédients et rôles), le moteur en fait
 * un modèle de repas comme les autres — il dose ensuite les quantités pour tenir la cible.
 */
import type { FoodIndex } from '../nutrition.js';
import type { MealTemplate, TemplateSlot } from '../types.js';
import { normalize } from '../util.js';

export type IngredientRole = 'protein' | 'energy' | 'fixed';

export interface CustomIngredient {
  foodId: string;
  /**
   * `protein` : quantité ajustée pour atteindre les protéines (un seul par recette) ;
   * `energy`  : quantité ajustée pour atteindre les calories (un seul par recette) ;
   * `fixed`   : quantité de la recette, inchangée.
   */
  role: IngredientRole;
  /** Quantité en grammes pour un ingrédient fixe. */
  grams?: number;
}

export interface CustomRecipeInput {
  /** Identifiant existant en cas de modification. */
  id?: string;
  name: string;
  meal: 'main' | 'snack';
  /** Repas à emporter. */
  away: boolean;
  ingredients: CustomIngredient[];
  /** Ajouter un laitage et un fruit en fin de repas. */
  dessert: boolean;
  steps: string[];
  prepMin: number;
  cookMin: number;
}

const FRUITS_HOME = ['banane', 'pomme', 'clementine', 'kiwi', 'poire', 'compote'];
const FRUITS_PORTABLE = ['banane', 'pomme', 'clementine', 'poire'];

export function customRecipeId(name: string): string {
  return `perso-${normalize(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)}`;
}

/** Valide une recette personnelle et la convertit en modèle de repas. Lève une erreur lisible sinon. */
export function buildCustomTemplate(input: CustomRecipeInput, foods: FoodIndex): MealTemplate {
  const name = input.name?.trim();
  if (!name || name.length < 3) throw new Error('Donne un nom à ta recette (3 caractères minimum).');
  if (!Array.isArray(input.ingredients) || input.ingredients.length === 0) throw new Error('Ajoute au moins un ingrédient.');
  if (input.ingredients.length > 12) throw new Error('12 ingrédients maximum par recette.');

  const seen = new Set<string>();
  let hasProtein = false;
  let hasEnergy = false;
  let needsCooking = false;
  const items: TemplateSlot[] = input.ingredients.map((ingredient, index) => {
    const food = foods.get(ingredient.foodId);
    if (!food) throw new Error(`Aliment inconnu : ${ingredient.foodId}`);
    if (seen.has(food.id)) throw new Error(`${food.name} apparaît deux fois dans la recette.`);
    seen.add(food.id);
    if (!food.noCook) needsCooking = true;

    // Un seul levier de chaque type : les suivants deviennent des quantités fixes.
    let role = ingredient.role;
    if (role === 'protein') {
      if (hasProtein) role = 'fixed';
      hasProtein = true;
    }
    if (role === 'energy') {
      if (hasEnergy) role = 'fixed';
      hasEnergy = true;
    }
    if (role !== 'fixed') return { key: `i${index + 1}`, foods: [food.id], scaling: role };

    const grams = Number(ingredient.grams);
    if (!Number.isFinite(grams) || grams <= 0 || grams > 2000) throw new Error(`Indique une quantité en grammes pour ${food.name}.`);
    return { key: `i${index + 1}`, foods: [food.id], scaling: 'fixed', grams: Math.round(grams), min: Math.round(grams), max: Math.round(grams) };
  });

  if (input.dessert) {
    items.push({ key: 'dairy', foods: input.away ? ['skyr'] : ['skyr', 'fromage-blanc'], scaling: 'fixed', pieces: 1, grams: 150 });
    items.push({ key: 'fruit', foods: input.away ? FRUITS_PORTABLE : FRUITS_HOME, scaling: 'fixed', pieces: 1 });
  }

  // Les étapes sont du texte libre : les accolades ne doivent pas être prises pour des emplacements.
  const steps = (input.steps ?? [])
    .map((s) => String(s).replace(/[{}]/g, '').trim())
    .filter(Boolean)
    .slice(0, 20);
  if (input.dessert) steps.push('Dessert : {dairy}.', 'Fruit : {fruit}.');

  const minutes = (value: number) => Math.max(0, Math.min(600, Math.round(Number(value) || 0)));
  return {
    id: input.id?.startsWith('perso-') ? input.id : customRecipeId(name),
    name,
    kind: 'recette',
    slots: input.meal === 'snack' ? ['collation', 'petit-dejeuner'] : ['dejeuner', 'diner'],
    context: input.away ? 'away' : 'home',
    items,
    methods: [],
    levels: ['ultra-rapide', 'normal', 'meal-prep'],
    prepMin: minutes(input.prepMin),
    cookMin: minutes(input.cookMin),
    steps: steps.length ? steps : ['Préparer et assembler les ingrédients listés.'],
    batchFriendly: input.meal === 'main',
    // Une recette qu'on a pris la peine d'écrire doit sortir régulièrement.
    weight: 1.5,
    custom: true,
    prepAhead: input.away && needsCooking ? true : undefined,
  };
}
