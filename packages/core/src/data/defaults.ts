/**
 * Valeurs par défaut et profil de démonstration.
 */
import type { ActivityLevel, MealSlotKind, MealStructureEntry, NutritionTarget, PlannerPreferences, PrepMode, Sex } from '../types.js';

/** Répartition des calories selon les repas choisis. */
export function defaultStructure(slots: MealSlotKind[]): MealStructureEntry[] {
  const weights: Record<MealSlotKind, number> = {
    'petit-dejeuner': 0.22,
    dejeuner: 0.4,
    collation: 0.15,
    diner: 0.45,
  };
  const order: MealSlotKind[] = ['petit-dejeuner', 'dejeuner', 'collation', 'diner'];
  const chosen = order.filter((s) => slots.includes(s));
  const total = chosen.reduce((sum, s) => sum + weights[s], 0);
  return chosen.map((slot) => ({ slot, share: Math.round((weights[slot] / total) * 1000) / 1000 }));
}

export const DEFAULT_EQUIPMENT: PrepMode[] = ['air-fryer', 'poele', 'rice-cooker', 'four', 'casserole', 'one-pot'];

/** Repère de fibres (g/jour) utilisé pour les alertes — ordre de grandeur des recommandations adultes. */
export const FIBER_GUIDE = 25;

export const DEMO_PROFILE = {
  sex: 'male' as Sex,
  age: 27,
  heightCm: 184,
  startWeightKg: 116,
  goalWeightKg: 90,
  activity: 'light' as ActivityLevel,
};

export const DEMO_TARGET: NutritionTarget = {
  kcal: 2300,
  protein: 180,
  toleranceKcal: 50,
  fiberGuide: FIBER_GUIDE,
};

export const DEMO_MEALS: MealSlotKind[] = ['dejeuner', 'collation', 'diner'];

export const DEMO_LIKED_FOODS = [
  'poulet',
  'dinde',
  'steak-hache-5',
  'oeufs',
  'saumon',
  'poisson-blanc',
  'thon',
  'riz',
  'pates',
  'pommes-de-terre',
  'semoule',
  'skyr',
  'fromage-blanc',
  'banane',
  'pomme',
  'compote',
  'pain-complet',
  'amandes',
  'noix',
  'parmesan',
  'emmental',
];

export const DEMO_PREFS: PlannerPreferences = {
  excludedFoods: [],
  /** « Je ne veux pas de légumes » : toute la catégorie est exclue. */
  excludedTags: ['legume'],
  likedFoods: DEMO_LIKED_FOODS,
  limitedFoods: [],
  bannedSignatures: [],
  bannedTemplates: [],
  favoriteSignatures: [],
  ratings: {},
  level: 'normal',
  equipment: DEFAULT_EQUIPMENT,
};

/** Stocks de démonstration (exemple du cahier des charges). */
export const DEMO_INVENTORY: Record<string, number> = {
  riz: 650,
  pates: 400,
  poulet: 500,
  oeufs: 330,
  compote: 900,
};

export const DEMO_STORE = {
  name: 'E.Leclerc',
  chain: 'leclerc',
  city: '',
};
