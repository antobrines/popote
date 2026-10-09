/**
 * Moteur de génération de menus, piloté par des règles.
 *
 * Pour chaque repas : on tire plusieurs candidats (modèle × aliments), on résout leurs
 * quantités, on les note (variété, stocks, préférences, anti-gaspillage, écart à la cible…)
 * et on garde le meilleur. La journée est ensuite équilibrée par `balanceDay`.
 */
import { type FoodIndex, ZERO, dayNutrition, indexFoods, itemsNutritionExact, mealNutrition, requireFood, roundNutrients, sumNutrients } from '../nutrition.js';
import { optimizePackages } from '../shopping/pricing.js';
import type {
  Food,
  Meal,
  MealContext,
  MealItem,
  MealPlanDay,
  MealSlotKind,
  MealTemplate,
  NutritionTarget,
  Nutrients,
  PlannerInput,
  PlannerPreferences,
  TemplateSlot,
  WeekPlan,
} from '../types.js';
import { Rng, addDays, clamp, hashString } from '../util.js';
import { analyzePlan } from './analysis.js';
import { balanceDay, solveMeal } from './solver.js';
import { cyclingTargets, dayTarget, dayTargetKcal } from './targets.js';

const MAIN_SLOTS: MealSlotKind[] = ['dejeuner', 'diner'];
const CANDIDATES_PER_TEMPLATE = 6;
const MAX_BATCH = 3;
/** Rôles à quantité fixe qui changent pourtant l'identité du plat (« poulet cajun » ≠ « poulet paprika »). */
const FLAVOR_SLOTS = new Set(['seasoning']);
/** Viandes et poissons frais : on ajuste les portions pour tomber sur des barquettes entières. */
const PACK_ROUNDED = new Set(['viande', 'poisson', 'charcuterie']);

interface WeekState {
  signatureCount: Map<string, number>;
  /** Même plat, quel que soit l'assaisonnement. */
  baseCount: Map<string, number>;
  proteinCount: Map<string, number>;
  foodUse: Map<string, number>;
  stockLeft: Map<string, number>;
  /** Reste (g) du conditionnement entamé de chaque produit périssable. */
  opened: Map<string, number>;
}

interface Context {
  input: PlannerInput;
  foods: FoodIndex;
  allowed: Set<string>;
  templates: Map<string, MealTemplate>;
  week: WeekState;
  lastWeek: Set<string>;
}

function isAllowed(food: Food, input: Pick<PlannerInput, 'prefs'>): boolean {
  if (input.prefs.excludedFoods.includes(food.id)) return false;
  if (food.tags.some((t) => input.prefs.excludedTags.includes(t))) return false;
  if (input.prefs.excludedTags.includes(food.category)) return false;
  return true;
}

function createContext(input: PlannerInput): Context {
  const foods = indexFoods(input.foods);
  return {
    input,
    foods,
    allowed: new Set(input.foods.filter((f) => isAllowed(f, input)).map((f) => f.id)),
    templates: new Map(input.templates.map((t) => [t.id, t])),
    week: {
      signatureCount: new Map(),
      baseCount: new Map(),
      proteinCount: new Map(),
      foodUse: new Map(),
      stockLeft: new Map(Object.entries(input.inventory)),
      opened: new Map(),
    },
    lastWeek: new Set(input.previousSignatures.flat()),
  };
}

function bump(map: Map<string, number>, key: string, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

function mainProtein(meal: Pick<Meal, 'items'>): string | undefined {
  return meal.items.find((i) => i.scaling === 'protein')?.foodId;
}

/** Conditionnements à prix fixe connus pour un aliment (prix relevés, sinon estimations du catalogue). */
function fixedPacks(ctx: Context, food: Food) {
  const known = ctx.input.packages?.[food.id];
  return (known?.length ? known : food.packages).filter((p) => !p.variableWeight && p.grams > 0);
}

/** Plus petit conditionnement d'un produit périssable, ou `null` s'il se conserve ou se vend au poids. */
function packUnit(ctx: Context, food: Food): number | null {
  if (!food.perishable) return null;
  const packs = fixedPacks(ctx, food);
  return packs.length ? Math.min(...packs.map((p) => p.grams)) : null;
}

function registerMeal(ctx: Context, meal: Meal): void {
  bump(ctx.week.signatureCount, meal.signature);
  bump(ctx.week.baseCount, baseSignature(meal.templateId, meal.items));
  const protein = mainProtein(meal);
  if (protein) bump(ctx.week.proteinCount, protein);
  for (const item of meal.items) {
    bump(ctx.week.foodUse, item.foodId, item.grams);
    const stock = ctx.week.stockLeft.get(item.foodId) ?? 0;
    if (stock > 0) ctx.week.stockLeft.set(item.foodId, Math.max(0, stock - item.grams));

    // Suivi des paquets entamés : ce qui dépasse le stock ouvre (ou vide) un conditionnement.
    const food = ctx.foods.get(item.foodId);
    const unit = food ? packUnit(ctx, food) : null;
    if (!unit) continue;
    let need = Math.max(0, item.grams - stock);
    let left = ctx.week.opened.get(item.foodId) ?? 0;
    if (need <= left) left -= need;
    else {
      need -= left;
      left = (unit - (need % unit)) % unit;
    }
    ctx.week.opened.set(item.foodId, left);
  }
}

/** Identité d'un plat sans son assaisonnement : modèle + ingrédients ajustables. */
export function baseSignature(templateId: string, items: Pick<MealItem, 'foodId' | 'scaling'>[]): string {
  const main = items
    .filter((i) => i.scaling !== 'fixed')
    .map((i) => i.foodId)
    .sort();
  return `${templateId}:${main.join('+')}`;
}

/** Identité complète d'un plat, assaisonnement compris. */
export function mealSignature(templateId: string, items: MealItem[]): string {
  const flavors = items.filter((i) => i.scaling === 'fixed' && FLAVOR_SLOTS.has(i.slotKey)).map((i) => i.foodId);
  const base = baseSignature(templateId, items);
  return flavors.length ? `${base}~${flavors.sort().join('+')}` : base;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function mealName(template: Pick<MealTemplate, 'name'>, items: MealItem[], foods: FoodIndex): string {
  const name = template.name.replace(/\{(\w+)\}/g, (_, key: string) => {
    const item = items.find((i) => i.slotKey === key);
    return item ? requireFood(foods, item.foodId).shortName : '';
  });
  return capitalize(
    name
      .replace(/\s*&\s*$/, '')
      .replace(/,\s*&/, ' &')
      .replace(/\s{2,}/g, ' ')
      .trim(),
  );
}

/** Construit un ingrédient à partir d'un rôle de modèle et de l'aliment choisi. */
export function itemFromSlot(slot: TemplateSlot, food: Food): MealItem {
  const min = Math.max(slot.min ?? food.portion.min, 0);
  const max = Math.max(min, slot.max ?? food.portion.max);
  const step = slot.step ?? food.portion.step;
  let grams: number;
  if (slot.scaling === 'fixed') {
    let wanted = food.piece && slot.pieces ? slot.pieces * food.piece.grams : (slot.grams ?? food.portion.min);
    // Un fruit compte pour une vraie portion : 2 clémentines plutôt qu'une seule.
    if (food.category === 'fruit') wanted = Math.max(wanted, food.portion.min);
    // Un rôle fixe garde sa quantité de recette, mais reste ajustable dans les bornes de l'aliment.
    const lo = Math.min(wanted, min);
    const hi = Math.max(wanted, max);
    grams = clamp(wanted, lo, hi);
    return { slotKey: slot.key, foodId: food.id, grams, scaling: 'fixed', min: lo, max: hi, step };
  }
  grams = min + Math.round((max - min) / 2 / step) * step;
  return { slotKey: slot.key, foodId: food.id, grams, scaling: slot.scaling, min, max, step };
}

/**
 * Aliments utilisables pour un rôle. Hors domicile, seuls les aliments transportables sans cuisine
 * passent — sauf pour un repas « préparé la veille », dont l'auteur a choisi les ingrédients.
 */
function slotCandidates(ctx: Context, slot: TemplateSlot, context: MealContext, prepAhead = false): Food[] {
  return slot.foods
    .filter((id) => ctx.allowed.has(id))
    .map((id) => ctx.foods.get(id))
    .filter((f): f is Food => !!f)
    .filter((f) => context === 'home' || prepAhead || (f.portable && f.noCook));
}

function isLimited(ctx: Context, foodId: string): boolean {
  return ctx.input.prefs.limitedFoods?.includes(foodId) ?? false;
}

function foodWeight(ctx: Context, food: Food, scaling: TemplateSlot['scaling'], dayFoods?: Set<string>): number {
  let w = 1;
  // « Pas trop souvent » : rarement tiré, et quasiment jamais deux fois dans la semaine.
  if (isLimited(ctx, food.id)) w *= (ctx.week.foodUse.get(food.id) ?? 0) > 0 ? 0.02 : 0.25;
  // Déjà au menu aujourd'hui : on varie (surtout les fruits et laitages de fin de repas).
  if (dayFoods?.has(food.id)) w *= scaling === 'fixed' ? 0.2 : 0.5;
  if (ctx.input.prefs.likedFoods.includes(food.id)) w *= 1.5;
  if ((ctx.week.stockLeft.get(food.id) ?? 0) >= food.portion.min) w *= 1.8;
  const used = ctx.week.foodUse.get(food.id) ?? 0;
  if (scaling === 'protein') {
    w /= 1 + (ctx.week.proteinCount.get(food.id) ?? 0);
  } else if (used > 0) {
    // Réutiliser un produit déjà entamé limite le nombre de paquets ouverts.
    w *= 1.35;
  }
  // Un paquet périssable entamé cette semaine : on cherche à le finir.
  if ((ctx.week.opened.get(food.id) ?? 0) > 0) w *= 1.6;
  return w;
}

/** Tire les aliments d'un modèle. Retourne `null` si un rôle obligatoire n'a aucun candidat. */
function instantiate(ctx: Context, template: MealTemplate, context: MealContext, rng: Rng, dayFoods?: Set<string>): MealItem[] | null {
  const items: MealItem[] = [];
  for (const slot of template.items) {
    if (slot.when) {
      const ref = items.find((i) => i.slotKey === slot.when!.slot);
      if (!ref || !slot.when.in.includes(ref.foodId)) continue;
    }
    const candidates = slotCandidates(ctx, slot, context, template.prepAhead);
    if (candidates.length === 0) {
      if (slot.optional) continue;
      return null;
    }
    if (slot.optional && rng.next() > 0.6) continue;
    const food = rng.weighted(candidates, (f) => foodWeight(ctx, f, slot.scaling, dayFoods));
    items.push(itemFromSlot(slot, food));
  }
  return items;
}

interface PickRequest {
  slot: MealSlotKind;
  context: MealContext;
  targetKcal: number;
  targetProtein: number;
  dayMeals: Meal[];
  exclude: Set<string>;
  /** Plats de base à écarter, quel que soit l'assaisonnement. */
  excludeBases?: Set<string>;
  lastWeekSameSlot?: string;
  /** Ce dîner sera aussi le déjeuner du lendemain (« cuisiner une fois, manger deux fois »). */
  cookForTomorrow?: boolean;
  rng: Rng;
}

function estimateCost(ctx: Context, items: MealItem[]): number {
  const prices = ctx.input.pricePerKg;
  if (!prices) return 0;
  return items.reduce((sum, i) => sum + ((prices[i.foodId] ?? 0) * i.grams) / 1000, 0);
}

function scoreMeal(ctx: Context, meal: Meal, template: MealTemplate, req: PickRequest): number {
  const { prefs } = ctx.input;
  const isMain = MAIN_SLOTS.includes(req.slot);
  let score = 0;

  // Variété dans la semaine et par rapport à la semaine précédente.
  score -= 60 * (ctx.week.signatureCount.get(meal.signature) ?? 0);
  // Le même plat avec une autre épice reste le même plat : une fois par semaine suffit.
  score -= 28 * (ctx.week.baseCount.get(baseSignature(meal.templateId, meal.items)) ?? 0);
  const protein = mainProtein(meal);
  if (protein) {
    score -= (isMain ? 9 : 3) * (ctx.week.proteinCount.get(protein) ?? 0);
    if (isMain && req.dayMeals.some((m) => MAIN_SLOTS.includes(m.slot) && mainProtein(m) === protein)) score -= 25;
  }
  if (isMain) {
    const group = (foodId: string | undefined) => (foodId ? (ctx.foods.get(foodId)?.substitutionGroup ?? foodId) : undefined);
    const starch = (m: Pick<Meal, 'items'>) => m.items.find((i) => i.scaling === 'energy')?.foodId;
    for (const other of req.dayMeals.filter((m) => MAIN_SLOTS.includes(m.slot))) {
      // Steak haché le midi et steak de bœuf le soir, ou pommes de terre aux deux repas : on évite.
      if (protein && mainProtein(other) !== protein && group(mainProtein(other)) === group(protein)) score -= 14;
      if (starch(meal) && starch(other) === starch(meal)) score -= 12;
    }
  }
  if (req.dayMeals.some((m) => m.templateId === meal.templateId)) score -= 15;
  if (req.lastWeekSameSlot === meal.signature) score -= 35;
  else if (ctx.lastWeek.has(meal.signature)) score -= 10;

  // Préférences, notes et favoris.
  for (const item of meal.items) {
    if (item.scaling !== 'fixed' && prefs.likedFoods.includes(item.foodId)) score += 5;
    if (isLimited(ctx, item.foodId)) {
      const alreadyThisWeek = (ctx.week.foodUse.get(item.foodId) ?? 0) > 0 || req.dayMeals.some((m) => m.items.some((i) => i.foodId === item.foodId));
      score -= alreadyThisWeek ? 150 : 14;
    }
  }
  const rating = prefs.ratings[meal.signature];
  if (rating) score += (rating - 3) * 10;
  if (prefs.favoriteSignatures.includes(meal.signature)) score += 12;

  // Stocks : on consomme d'abord ce qui est déjà dans les placards.
  let covered = 0;
  let needed = 0;
  for (const item of meal.items) {
    needed += item.grams;
    covered += Math.min(item.grams, ctx.week.stockLeft.get(item.foodId) ?? 0);
  }
  if (needed > 0) score += 14 * (covered / needed);

  // Anti-gaspillage : produits déjà utilisés cette semaine (hors protéine principale)…
  const reused = meal.items.filter((i) => i.foodId !== protein && (ctx.week.foodUse.get(i.foodId) ?? 0) > 0).length;
  score += 2.5 * reused;
  // …et surtout paquets périssables entamés à finir, plutôt qu'en ouvrir un pour trois cuillères.
  for (const item of meal.items) {
    const food = ctx.foods.get(item.foodId);
    const unit = food ? packUnit(ctx, food) : null;
    if (!unit || (ctx.week.stockLeft.get(item.foodId) ?? 0) >= item.grams) continue;
    const left = ctx.week.opened.get(item.foodId) ?? 0;
    if (left > 0) score += 8 * Math.min(1, item.grams / left);
    else if (item.scaling === 'fixed') score -= 5 * (1 - Math.min(1, item.grams / unit));
  }

  // Qualité nutritionnelle du repas.
  score -= Math.abs(meal.nutrition.kcal - req.targetKcal) / 8;
  score -= Math.max(0, req.targetProtein - meal.nutrition.protein) * 1.2;
  score += meal.nutrition.fiber * 0.9;
  const fatShare = (meal.nutrition.fat * 9) / Math.max(1, meal.nutrition.kcal);
  if (fatShare < 0.15) score -= 6;
  if (fatShare > 0.42) score -= 8;

  // Niveau de préparation souhaité.
  if (template.levels.includes(prefs.level)) score += 8;
  if (prefs.level === 'ultra-rapide') score -= Math.max(0, template.prepMin + template.cookMin - 15) * 0.6;
  if (prefs.level === 'meal-prep' && template.batchFriendly) score += 6;
  if (prefs.equipment.length > 0 && template.methods.some((m) => m !== 'aucune' && prefs.equipment.includes(m))) score += 4;
  // Un dîner qui servira aussi demain midi doit bien se garder et se réchauffer.
  if (req.cookForTomorrow) score += template.batchFriendly ? 10 : -6;

  // Pression budgétaire éventuelle.
  if (ctx.input.weeklyBudget) {
    const mealsPerWeek = 7 * ctx.input.structure.length;
    const budgetPerMeal = ctx.input.weeklyBudget / mealsPerWeek;
    score -= Math.max(0, estimateCost(ctx, meal.items) - budgetPerMeal * (isMain ? 1.6 : 0.5)) * 6;
  }

  score += (template.weight ?? 1) * 4;
  // Une recette que l'utilisateur a écrite doit sortir : net coup de pouce tant qu'elle n'est pas
  // dans la semaine, dégressif pour que dix recettes perso n'écrasent pas tout le reste.
  if (template.custom) {
    const used = [...ctx.week.baseCount.keys()];
    if (!used.some((key) => key.startsWith(`${template.id}:`))) {
      const customIds = ctx.input.templates.filter((t) => t.custom).map((t) => `${t.id}:`);
      const customMeals = used.filter((key) => customIds.some((id) => key.startsWith(id))).length;
      score += 30 / (1 + customMeals);
    }
  }
  score += req.rng.next() * 7;
  return score;
}

function buildMeal(ctx: Context, template: MealTemplate, items: MealItem[], req: Pick<PickRequest, 'slot' | 'context' | 'rng'>): Meal {
  return {
    id: req.rng.id('m'),
    slot: req.slot,
    templateId: template.id,
    name: mealName(template, items, ctx.foods),
    signature: mealSignature(template.id, items),
    context: req.context,
    items,
    nutrition: mealNutrition({ items }, ctx.foods),
    status: 'planned',
  };
}

function eligibleTemplates(ctx: Context, slot: MealSlotKind, context: MealContext): MealTemplate[] {
  const { prefs } = ctx.input;
  return ctx.input.templates.filter(
    (t) =>
      t.slots.includes(slot) &&
      (t.context === 'any' || t.context === context) &&
      // Les repas à emporter cuisinés la veille ne sont proposés que si l'utilisateur l'accepte.
      (!t.prepAhead || prefs.awayPrepAhead === true) &&
      !prefs.bannedTemplates.includes(t.id),
  );
}

/** Retourne les meilleurs candidats (signatures distinctes), du meilleur au moins bon. */
function rankCandidates(ctx: Context, req: PickRequest, limit: number): Meal[] {
  const scored: { meal: Meal; score: number }[] = [];
  const { prefs } = ctx.input;
  const dayFoods = new Set(req.dayMeals.flatMap((m) => m.items.map((i) => i.foodId)));
  for (const template of eligibleTemplates(ctx, req.slot, req.context)) {
    for (let k = 0; k < CANDIDATES_PER_TEMPLATE; k++) {
      const items = instantiate(ctx, template, req.context, req.rng, dayFoods);
      if (!items) break;
      if (req.excludeBases?.has(baseSignature(template.id, items))) continue;
      solveMeal(items, ctx.foods, req.targetKcal, req.targetProtein);
      const meal = buildMeal(ctx, template, items, req);
      if (req.exclude.has(meal.signature) || prefs.bannedSignatures.includes(meal.signature)) continue;
      scored.push({ meal, score: scoreMeal(ctx, meal, template, req) });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const result: Meal[] = [];
  for (const { meal } of scored) {
    if (seen.has(meal.signature)) continue;
    seen.add(meal.signature);
    result.push(meal);
    if (result.length >= limit) break;
  }
  return result;
}

function contextFor(away: PlannerInput['away'][number], slot: MealSlotKind): MealContext {
  if (away === 'full') return 'away';
  if (away === 'lunch' && (slot === 'dejeuner' || slot === 'collation')) return 'away';
  return 'home';
}

function cloneMeal(meal: Meal, rng: Rng): Meal {
  const { locked: _locked, free: _free, ...rest } = meal;
  return { ...rest, id: rng.id('m'), items: meal.items.map((i) => ({ ...i })), status: 'planned' };
}

function summarize(target: NutritionTarget, days: MealPlanDay[], foods: FoodIndex): Pick<WeekPlan, 'averages' | 'warnings'> {
  const total = sumNutrients(days.map((d) => d.nutrition));
  const count = Math.max(1, days.length);
  const averages = roundNutrients({
    kcal: total.kcal / count,
    protein: total.protein / count,
    carbs: total.carbs / count,
    fat: total.fat / count,
    fiber: total.fiber / count,
  });
  return { averages, warnings: analyzePlan(days, target, foods, averages) };
}

/**
 * Ajuste les portions de viande et de poisson frais pour tomber sur des barquettes entières :
 * on mange le petit surplus plutôt que de le jeter, ou on achète une barquette de moins quand
 * il ne manque presque rien. Les journées concernées sont ensuite rééquilibrées.
 */
function roundProteinsToPacks(ctx: Context, days: MealPlanDay[], targetOf: (day: MealPlanDay) => NutritionTarget): void {
  const uses = new Map<string, { item: MealItem; day: MealPlanDay }[]>();
  for (const day of days) {
    for (const meal of day.meals) {
      if (meal.status !== 'planned') continue;
      for (const item of meal.items) {
        const food = ctx.foods.get(item.foodId);
        if (item.scaling !== 'protein' || !food?.perishable || !PACK_ROUNDED.has(food.category)) continue;
        const list = uses.get(food.id) ?? [];
        list.push({ item, day });
        uses.set(food.id, list);
      }
    }
  }

  const frozen = new Map<MealPlanDay, MealItem[]>();
  for (const [foodId, list] of uses) {
    const food = ctx.foods.get(foodId)!;
    const packs = fixedPacks(ctx, food);
    if (packs.length === 0) continue;
    const total = list.reduce((sum, u) => sum + u.item.grams, 0);
    const toBuy = total - (ctx.input.inventory[foodId] ?? 0);
    if (toBuy <= 0) continue;

    const unit = Math.min(...packs.map((p) => p.grams));
    const surplus = optimizePackages(toBuy, packs, 'cheapest', true).boughtG - toBuy;
    const deficit = toBuy - Math.floor(toBuy / unit) * unit;
    const step = Math.min(...list.map((u) => u.item.step));
    if (surplus < step) continue;

    const headroom = list.reduce((sum, u) => sum + (u.item.max - u.item.grams), 0);
    const slack = list.reduce((sum, u) => sum + (u.item.grams - u.item.min), 0);
    const canEatMore = surplus <= headroom && surplus <= total * 0.2;
    // Acheter une barquette de moins ferait baisser les protéines de la semaine : on ne le fait que
    // pour un écart infime (moins de 3 % de la quantité).
    const canBuyLess = toBuy > unit && deficit <= slack && deficit <= total * 0.03;
    let delta = 0;
    if (canEatMore && (!canBuyLess || surplus <= deficit * 1.5)) delta = surplus;
    else if (canBuyLess) delta = -deficit;
    if (delta === 0) continue;

    // Répartition pas à pas, à tour de rôle, pour ne pas charger un seul repas.
    let remaining = Math.abs(delta);
    const direction = Math.sign(delta);
    let moved = true;
    while (remaining >= step && moved) {
      moved = false;
      for (const { item } of list) {
        if (remaining < item.step) continue;
        const next = item.grams + direction * item.step;
        if (next > item.max || next < item.min) continue;
        item.grams = next;
        remaining -= item.step;
        moved = true;
      }
    }
    for (const { item, day } of list) frozen.set(day, [...(frozen.get(day) ?? []), item]);
  }

  // Rééquilibrage : les portions arrondies ne bougent plus, le reste de la journée compense.
  for (const [day, items] of frozen) {
    for (const item of items) item.scaling = 'fixed';
    balanceDay(day.meals, ctx.foods, targetOf(day));
    for (const item of items) item.scaling = 'protein';
    day.nutrition = dayNutrition(day.meals, ctx.foods);
  }
}

/** Génère un programme complet de 7 jours. Déterministe pour une graine donnée. */
export function generateWeek(input: PlannerInput): WeekPlan {
  const ctx = createContext(input);
  const rng = new Rng(input.seed ^ hashString(input.weekStart));
  const days: MealPlanDay[] = [];
  const batchRun = new Map<MealSlotKind, number>();
  const { prefs } = input;
  const baseKcal = input.training ? cyclingTargets(input.target, input.training) : null;
  const kcalOf = (dayIndex: number) => baseKcal?.[dayIndex] ?? input.target.kcal;
  const isHomeLunch = (dayIndex: number) => dayIndex < 7 && contextFor(input.away[dayIndex] ?? 'none', 'dejeuner') === 'home';
  const cookOnce = prefs.cookOnce === true && prefs.level !== 'meal-prep';

  // Les repas verrouillés comptent d'emblée pour la variété du reste de la semaine.
  for (const kept of input.keep?.flat() ?? []) {
    if (kept) registerMeal(ctx, kept);
  }

  for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
    const away = input.away[dayIndex] ?? 'none';
    const dayKcal = kcalOf(dayIndex);
    const meals: Meal[] = [];
    const fresh: Meal[] = [];
    input.structure.forEach((entry, slotIndex) => {
      const context = contextFor(away, entry.slot);
      const kept = input.keep?.[dayIndex]?.[slotIndex];
      if (kept) {
        // Repas verrouillé par l'utilisateur : le plat est conservé, ses quantités restent ajustables.
        meals.push({ ...kept, items: kept.items.map((i) => ({ ...i })) });
        batchRun.set(entry.slot, 0);
        return;
      }
      const yesterday = days[dayIndex - 1];
      const previousSame = yesterday?.meals.find((m) => m.slot === entry.slot);
      const reusable = (m: Meal | undefined): m is Meal =>
        !!m && !m.locked && m.context === 'home' && ctx.templates.get(m.templateId)?.batchFriendly === true && !m.items.some((i) => isLimited(ctx, i.foodId));

      let meal: Meal | undefined;
      // Cuisiner une fois, manger deux fois : le dîner d'hier devient le déjeuner d'aujourd'hui.
      const dinnerYesterday = yesterday?.meals.find((m) => m.slot === 'diner');
      if (cookOnce && entry.slot === 'dejeuner' && context === 'home' && reusable(dinnerYesterday)) {
        meal = { ...cloneMeal(dinnerYesterday, rng), slot: 'dejeuner' };
      }

      // Mode meal prep : on reconduit le même plat jusqu'à 3 jours de suite pour cuisiner en une fois.
      const run = batchRun.get(entry.slot) ?? 0;
      if (!meal && prefs.level === 'meal-prep' && MAIN_SLOTS.includes(entry.slot) && context === 'home' && reusable(previousSame) && run > 0 && run < MAX_BATCH) {
        meal = cloneMeal(previousSame, rng);
        batchRun.set(entry.slot, run + 1);
      }

      if (!meal) {
        meal = rankCandidates(
          ctx,
          {
            slot: entry.slot,
            context,
            targetKcal: dayKcal * entry.share,
            targetProtein: input.target.protein * entry.share,
            dayMeals: meals,
            exclude: new Set(),
            lastWeekSameSlot: input.previousSignatures[dayIndex]?.[slotIndex],
            cookForTomorrow: cookOnce && entry.slot === 'diner' && context === 'home' && isHomeLunch(dayIndex + 1) && !input.keep?.[dayIndex + 1]?.[input.structure.findIndex((s) => s.slot === 'dejeuner')],
            rng,
          },
          1,
        )[0];
        batchRun.set(entry.slot, 1);
      }
      if (!meal) {
        throw new Error(`Aucun repas possible pour « ${entry.slot} » (${context === 'away' ? 'hors domicile' : 'maison'}) avec les préférences actuelles.`);
      }
      meals.push(meal);
      fresh.push(meal);
    });

    balanceDay(meals, ctx.foods, { ...input.target, kcal: dayKcal });
    for (const meal of fresh) registerMeal(ctx, meal);
    days.push({
      index: dayIndex,
      date: addDays(input.weekStart, dayIndex),
      away,
      meals,
      nutrition: dayNutrition(meals, ctx.foods),
      ...(input.training ? { training: !!input.training.days[dayIndex] } : {}),
      ...(dayKcal !== input.target.kcal ? { baseKcal: dayKcal } : {}),
    });
  }

  if (input.roundToPacks !== false) {
    roundProteinsToPacks(ctx, days, (day) => ({ ...input.target, kcal: day.baseKcal ?? input.target.kcal }));
  }

  return {
    weekStart: input.weekStart,
    seed: input.seed,
    level: prefs.level,
    target: input.target,
    structure: input.structure,
    days,
    ...summarize(input.target, days, ctx.foods),
  };
}

// ───────────────────────────── Remplacements ─────────────────────────────

export interface DayLock {
  /** Identifiants des repas à ne pas modifier (déjà mangés). */
  lockedMealIds: string[];
  /** Apport réel déjà consommé sur la journée (repas mangés + extras). */
  consumed: Nutrients;
}

const NO_LOCK: DayLock = { lockedMealIds: [], consumed: { ...ZERO } };

function contextFromPlan(input: PlannerInput, plan: WeekPlan, skipMealId?: string): Context {
  const ctx = createContext(input);
  for (const day of plan.days) {
    for (const meal of day.meals) {
      if (meal.id !== skipMealId) registerMeal(ctx, meal);
    }
  }
  return ctx;
}

function clonePlan(plan: WeekPlan): WeekPlan {
  return {
    ...plan,
    days: plan.days.map((d) => ({ ...d, meals: d.meals.map((m) => ({ ...m, items: m.items.map((i) => ({ ...i })) })) })),
  };
}

function locate(plan: WeekPlan, dayIndex: number, mealId: string): { day: MealPlanDay; meal: Meal; position: number } {
  const day = plan.days[dayIndex];
  if (!day) throw new Error(`Jour inconnu : ${dayIndex}`);
  const position = day.meals.findIndex((m) => m.id === mealId);
  if (position < 0) throw new Error(`Repas inconnu : ${mealId}`);
  return { day, meal: day.meals[position]!, position };
}

/** Rééquilibre les repas encore modifiables d'un jour sur sa cible du jour. */
function balancePlanDay(plan: WeekPlan, day: MealPlanDay, foods: FoodIndex, lock: DayLock): void {
  const free = day.meals.filter((m) => m.status === 'planned' && !lock.lockedMealIds.includes(m.id));
  balanceDay(free, foods, dayTarget(plan, day), lock.consumed);
  day.nutrition = dayNutrition(day.meals, foods);
}

/** Rééquilibre un jour puis recalcule les totaux et alertes du programme. */
function finalize(plan: WeekPlan, dayIndex: number, foods: FoodIndex, lock: DayLock): WeekPlan {
  balancePlanDay(plan, plan.days[dayIndex]!, foods, lock);
  return { ...plan, ...summarize(plan.target, plan.days, foods) };
}

function alternativesRequest(ctx: Context, plan: WeekPlan, dayIndex: number, meal: Meal, lock: DayLock, salt: number): PickRequest {
  const day = plan.days[dayIndex]!;
  const target = dayTarget(plan, day);
  const others = day.meals.filter((m) => m.id !== meal.id && !lock.lockedMealIds.includes(m.id));
  const othersTotal = itemsNutritionExact(
    others.flatMap((m) => m.items),
    ctx.foods,
  );
  const remainingKcal = target.kcal - lock.consumed.kcal - othersTotal.kcal;
  const remainingProtein = target.protein - lock.consumed.protein - othersTotal.protein;
  const share = plan.structure.find((s) => s.slot === meal.slot)?.share ?? 0.33;
  return {
    slot: meal.slot,
    context: meal.context,
    // On vise ce qu'il reste de la journée, sans s'éloigner déraisonnablement de la part habituelle du repas.
    targetKcal: clamp(remainingKcal, target.kcal * share * 0.6, target.kcal * share * 1.4),
    targetProtein: clamp(remainingProtein, target.protein * share * 0.5, target.protein * share * 1.5),
    dayMeals: day.meals.filter((m) => m.id !== meal.id),
    exclude: new Set([meal.signature, ...(meal.rejectedSignatures ?? [])]),
    // « Je n'aime pas ce repas » ne doit pas reproposer le même plat avec une autre épice.
    excludeBases: new Set([meal.signature, ...(meal.rejectedSignatures ?? [])].map((s) => s.split('~')[0]!)),
    rng: new Rng(plan.seed ^ hashString(`${meal.id}:${salt}`)),
  };
}

/** Propose plusieurs variantes équivalentes pour un repas (même créneau, mêmes cibles). */
export function mealAlternatives(input: PlannerInput, plan: WeekPlan, dayIndex: number, mealId: string, count = 3, lock: DayLock = NO_LOCK): Meal[] {
  const { meal } = locate(plan, dayIndex, mealId);
  const ctx = contextFromPlan(input, plan, mealId);
  const salt = (meal.rejectedSignatures ?? []).length;
  const ranked = rankCandidates(ctx, alternativesRequest(ctx, plan, dayIndex, meal, lock, salt), count * 3);
  // Des variantes vraiment différentes : pas trois fois le même plat avec une autre épice.
  const seen = new Set<string>();
  const distinct = ranked.filter((m) => {
    const base = baseSignature(m.templateId, m.items);
    if (seen.has(base)) return false;
    seen.add(base);
    return true;
  });
  return distinct.slice(0, count);
}

/**
 * « Je n'aime pas ce repas » : remplace le repas (par `replacement` s'il est fourni, sinon par le
 * meilleur candidat) puis rééquilibre le reste de la journée.
 */
export function replaceMeal(
  input: PlannerInput,
  plan: WeekPlan,
  dayIndex: number,
  mealId: string,
  lock: DayLock = NO_LOCK,
  replacement?: Pick<Meal, 'templateId' | 'items'>,
): WeekPlan {
  const next = clonePlan(plan);
  const { day, meal, position } = locate(next, dayIndex, mealId);
  const ctx = contextFromPlan(input, next, mealId);
  const rejected = [...new Set([...(meal.rejectedSignatures ?? []), meal.signature])];

  let fresh: Meal | undefined;
  if (replacement) {
    const template = ctx.templates.get(replacement.templateId);
    if (!template) throw new Error(`Modèle de repas inconnu : ${replacement.templateId}`);
    const items = replacement.items.map((i) => {
      const food = requireFood(ctx.foods, i.foodId);
      if (!ctx.allowed.has(food.id)) throw new Error(`Aliment exclu par les préférences : ${food.name}`);
      const slot = template.items.find((s) => s.key === i.slotKey);
      const base = slot ? itemFromSlot(slot, food) : { ...i };
      return { ...base, grams: clamp(i.grams, base.min, base.max) };
    });
    fresh = buildMeal(ctx, template, items, { slot: meal.slot, context: meal.context, rng: new Rng(hashString(mealId)) });
  } else {
    fresh = rankCandidates(ctx, alternativesRequest(ctx, next, dayIndex, meal, lock, rejected.length), 1)[0];
  }
  if (!fresh) throw new Error('Aucune alternative disponible pour ce repas avec les préférences actuelles.');

  day.meals[position] = { ...fresh, swapped: true, rejectedSignatures: rejected };
  return finalize(next, dayIndex, ctx.foods, lock);
}

export interface FoodAlternative {
  foodId: string;
  name: string;
  grams: number;
  mealNutrition: Nutrients;
}

function swapFood(ctx: Context, meal: Meal, slotKey: string, toFood: Food): Meal {
  const template = ctx.templates.get(meal.templateId);
  const current = meal.items.find((i) => i.slotKey === slotKey);
  if (!current) throw new Error(`Ingrédient inconnu : ${slotKey}`);
  const before = itemsNutritionExact(meal.items, ctx.foods);
  const slot = template?.items.find((s) => s.key === slotKey);
  const swapped: MealItem = slot
    ? itemFromSlot(slot, toFood)
    : { ...current, foodId: toFood.id, min: toFood.portion.min, max: toFood.portion.max, step: toFood.portion.step, grams: toFood.portion.min };

  if (swapped.scaling === 'fixed' && !toFood.piece && current.scaling === 'fixed' && !FLAVOR_SLOTS.has(slotKey)) {
    // À rôle fixe, on conserve l'apport calorique de l'ingrédient remplacé.
    const kcal = (requireFood(ctx.foods, current.foodId).per100.kcal * current.grams) / 100;
    const grams = (kcal / toFood.per100.kcal) * 100;
    swapped.grams = clamp(Math.round(grams / swapped.step) * swapped.step, swapped.min, swapped.max);
  }
  const items = meal.items.map((i) => (i.slotKey === slotKey ? swapped : { ...i }));
  solveMeal(items, ctx.foods, before.kcal, before.protein);
  return {
    ...meal,
    items,
    name: template ? mealName(template, items, ctx.foods) : meal.name,
    signature: mealSignature(meal.templateId, items),
    nutrition: mealNutrition({ items }, ctx.foods),
    swapped: true,
  };
}

function swapCandidates(ctx: Context, meal: Meal, slotKey: string): Food[] {
  const template = ctx.templates.get(meal.templateId);
  const current = meal.items.find((i) => i.slotKey === slotKey);
  if (!current) return [];
  const slot = template?.items.find((s) => s.key === slotKey);
  const currentFood = requireFood(ctx.foods, current.foodId);
  const fits = (f: Food) => ctx.allowed.has(f.id) && (meal.context === 'home' || template?.prepAhead === true || (f.portable && f.noCook));
  const pool = slot ? slotCandidates(ctx, slot, meal.context, template?.prepAhead) : ctx.input.foods.filter((f) => f.category === currentFood.category && fits(f));
  const sameGroup = ctx.input.foods.filter((f) => !!currentFood.substitutionGroup && f.substitutionGroup === currentFood.substitutionGroup && fits(f));
  const merged = new Map([...pool, ...sameGroup].map((f) => [f.id, f]));
  merged.delete(current.foodId);
  return [...merged.values()];
}

/** Liste les aliments pouvant remplacer un ingrédient, avec le repas recalculé pour chacun. */
export function foodAlternatives(input: PlannerInput, plan: WeekPlan, dayIndex: number, mealId: string, slotKey: string): FoodAlternative[] {
  const { meal } = locate(plan, dayIndex, mealId);
  const ctx = contextFromPlan(input, plan, mealId);
  return swapCandidates(ctx, meal, slotKey).map((food) => {
    const swapped = swapFood(ctx, meal, slotKey, food);
    return {
      foodId: food.id,
      name: food.name,
      grams: swapped.items.find((i) => i.slotKey === slotKey)!.grams,
      mealNutrition: swapped.nutrition,
    };
  });
}

/** « Remplacer uniquement cet aliment » : change un ingrédient et recalcule le repas puis la journée. */
export function replaceFood(
  input: PlannerInput,
  plan: WeekPlan,
  dayIndex: number,
  mealId: string,
  slotKey: string,
  toFoodId?: string,
  lock: DayLock = NO_LOCK,
): WeekPlan {
  const next = clonePlan(plan);
  const { day, meal, position } = locate(next, dayIndex, mealId);
  const ctx = contextFromPlan(input, next, mealId);
  const candidates = swapCandidates(ctx, meal, slotKey);
  const rng = new Rng(plan.seed ^ hashString(`${mealId}:${slotKey}:${meal.signature}`));
  const target = toFoodId ? candidates.find((f) => f.id === toFoodId) : candidates.length ? rng.weighted(candidates, (f) => foodWeight(ctx, f, 'fixed')) : undefined;
  if (!target) throw new Error("Aucun aliment de remplacement compatible n'est disponible.");
  day.meals[position] = swapFood(ctx, meal, slotKey, target);
  return finalize(next, dayIndex, ctx.foods, lock);
}

/**
 * Régénère les repas d'un seul jour (par exemple quand on déclare une absence après coup),
 * en tenant compte du reste de la semaine pour la variété.
 */
export function regenerateDay(input: PlannerInput, plan: WeekPlan, dayIndex: number, away: PlannerInput['away'][number]): WeekPlan {
  const next = clonePlan(plan);
  const day = next.days[dayIndex];
  if (!day) throw new Error(`Jour inconnu : ${dayIndex}`);
  const ctx = createContext(input);
  for (const other of next.days) {
    if (other.index === dayIndex) continue;
    for (const meal of other.meals) registerMeal(ctx, meal);
  }
  const rng = new Rng(plan.seed ^ hashString(`day:${dayIndex}:${away}:${day.meals.map((m) => m.id).join(',')}`));
  const previous = new Set(day.meals.map((m) => m.signature));
  const target = dayTarget(plan, day);
  const meals: Meal[] = [];
  for (const entry of plan.structure) {
    const context = contextFor(away, entry.slot);
    const meal = rankCandidates(
      ctx,
      {
        slot: entry.slot,
        context,
        targetKcal: target.kcal * entry.share,
        targetProtein: target.protein * entry.share,
        dayMeals: meals,
        exclude: previous,
        rng,
      },
      1,
    )[0];
    if (!meal) throw new Error(`Aucun repas possible pour « ${entry.slot} » avec les préférences actuelles.`);
    meals.push(meal);
  }
  balanceDay(meals, ctx.foods, target);
  day.away = away;
  day.meals = meals;
  day.nutrition = dayNutrition(meals, ctx.foods);
  return { ...next, ...summarize(plan.target, next.days, ctx.foods) };
}

/** Recalcule moyennes et alertes d'un programme dont on a modifié les jours. */
export function summarizePlan(plan: WeekPlan, foods: Food[]): WeekPlan {
  const index = indexFoods(foods);
  const days = plan.days.map((d) => ({
    ...d,
    meals: d.meals.map((m) => ({ ...m, nutrition: mealNutrition(m, index) })),
    nutrition: dayNutrition(d.meals, index),
  }));
  return { ...plan, days, ...summarize(plan.target, days, index) };
}

/** Recalcule le reste d'une journée à partir de ce qui a réellement été mangé. */
export function rebalanceDay(input: PlannerInput, plan: WeekPlan, dayIndex: number, lock: DayLock): WeekPlan {
  return finalize(clonePlan(plan), dayIndex, indexFoods(input.foods), lock);
}

/** Copie un repas aimé vers un autre créneau (« répéter ce repas »). */
export function repeatMeal(
  input: PlannerInput,
  plan: WeekPlan,
  from: { dayIndex: number; mealId: string },
  to: { dayIndex: number; mealId: string },
  lock: DayLock = NO_LOCK,
): WeekPlan {
  const next = clonePlan(plan);
  const source = locate(next, from.dayIndex, from.mealId).meal;
  const target = locate(next, to.dayIndex, to.mealId);
  target.day.meals[target.position] = {
    ...cloneMeal(source, new Rng(hashString(`${to.mealId}:${source.id}`))),
    slot: target.meal.slot,
    context: target.meal.context,
    swapped: true,
  };
  return finalize(next, to.dayIndex, indexFoods(input.foods), lock);
}

/** Échange deux repas du programme (par exemple le dîner de mardi contre celui de jeudi). */
export function swapMeals(
  input: PlannerInput,
  plan: WeekPlan,
  a: { dayIndex: number; mealId: string },
  b: { dayIndex: number; mealId: string },
  locks: Record<number, DayLock> = {},
): WeekPlan {
  const next = clonePlan(plan);
  const first = locate(next, a.dayIndex, a.mealId);
  const second = locate(next, b.dayIndex, b.mealId);
  if (first.meal.id === second.meal.id) return next;
  if (first.meal.status !== 'planned' || second.meal.status !== 'planned') throw new Error('Un repas déjà déclaré ne peut pas être échangé.');
  const isMain = (slot: MealSlotKind) => MAIN_SLOTS.includes(slot);
  if (isMain(first.meal.slot) !== isMain(second.meal.slot)) throw new Error('On échange un repas principal avec un repas principal, ou deux collations.');
  if (first.meal.context !== second.meal.context) throw new Error("Impossible d'échanger un repas à emporter avec un repas cuisiné à la maison.");

  first.day.meals[first.position] = { ...second.meal, slot: first.meal.slot, swapped: true };
  second.day.meals[second.position] = { ...first.meal, slot: second.meal.slot, swapped: true };
  const foods = indexFoods(input.foods);
  for (const dayIndex of new Set([a.dayIndex, b.dayIndex])) {
    balancePlanDay(next, next.days[dayIndex]!, foods, locks[dayIndex] ?? NO_LOCK);
  }
  return { ...next, ...summarize(next.target, next.days, foods) };
}

// ───────────────────────────── Repas libre lissé sur la semaine ─────────────────────────────

export interface SpreadReport {
  /** Écart total au-dessus de la cible, les jours de repas libre (kcal). */
  surplusKcal: number;
  /** Part de cet écart répartie sur les jours suivants. */
  absorbedKcal: number;
  days: { index: number; deltaKcal: number }[];
}

export interface SpreadOptions {
  /** Réduction maximale par jour. */
  maxPerDayKcal: number;
  /** Aucun jour ne descend sous ce plancher. */
  floorKcal: number;
}

/**
 * Lisse l'excédent d'un « repas libre » (restaurant, soirée…) sur les jours suivants de la semaine,
 * par petites touches bornées. Recalculé entièrement à chaque appel : annuler le repas libre annule
 * aussi le lissage. Les jours passés ne sont jamais modifiés.
 */
export function applyWeekSpread(
  input: PlannerInput,
  plan: WeekPlan,
  intake: Record<number, DayLock>,
  today: string,
  options: SpreadOptions,
): { plan: WeekPlan; report: SpreadReport } {
  const next = clonePlan(plan);
  const foods = indexFoods(input.foods);
  const delta = next.days.map(() => 0);
  const report: SpreadReport = { surplusKcal: 0, absorbedKcal: 0, days: [] };
  const lockOf = (day: MealPlanDay) => intake[day.index] ?? NO_LOCK;
  const adjustable = (day: MealPlanDay) => day.date >= today && day.meals.some((m) => m.status === 'planned' && !lockOf(day).lockedMealIds.includes(m.id));

  for (const day of next.days) {
    const before = day.spreadKcal ?? 0;
    const spread = -Math.round(delta[day.index]!);
    if (spread !== 0) day.spreadKcal = spread;
    else delete day.spreadKcal;
    const lock = lockOf(day);
    const plannedKcal = () =>
      itemsNutritionExact(
        day.meals.filter((m) => m.status === 'planned' && !lock.lockedMealIds.includes(m.id)).flatMap((m) => m.items),
        foods,
      ).kcal;
    // On ne retouche une journée que si sa cible a bougé, si elle porte un repas libre, ou si elle
    // n'est plus sur sa cible (cas d'un repas libre qu'on vient d'annuler).
    const offTarget = Math.abs(lock.consumed.kcal + plannedKcal() - dayTargetKcal(next, day)) > next.target.toleranceKcal;
    if (adjustable(day) && (spread !== before || offTarget || day.meals.some((m) => m.free))) balancePlanDay(next, day, foods, lock);

    if (!day.meals.some((m) => m.free)) continue;
    let surplus = lock.consumed.kcal + plannedKcal() - dayTargetKcal(next, day);
    if (surplus <= next.target.toleranceKcal) continue;
    report.surplusKcal += Math.round(surplus);

    // Partage égal entre les jours restants, dans la limite de chacun.
    const later = next.days.filter((d) => d.index > day.index && adjustable(d));
    const room = (d: MealPlanDay) => Math.max(0, Math.min(options.maxPerDayKcal - delta[d.index]!, (d.baseKcal ?? next.target.kcal) - delta[d.index]! - options.floorKcal));
    for (let pass = 0; pass < 4 && surplus >= 10; pass++) {
      const open = later.filter((d) => room(d) >= 10);
      if (open.length === 0) break;
      const share = surplus / open.length;
      for (const d of open) {
        const take = Math.min(room(d), Math.ceil(share / 10) * 10, Math.floor(surplus / 10) * 10);
        if (take <= 0) continue;
        delta[d.index] = delta[d.index]! + take;
        surplus -= take;
        report.absorbedKcal += take;
      }
    }
  }

  report.days = next.days.filter((d) => d.spreadKcal).map((d) => ({ index: d.index, deltaKcal: d.spreadKcal! }));
  return { plan: { ...next, ...summarize(next.target, next.days, foods) }, report };
}

// ───────────────────────────── Cuisiner une fois, manger deux fois ─────────────────────────────

export interface CookOncePair {
  /** Le dîner à cuisiner en double… */
  cookDay: number;
  cookMealId: string;
  /** …et le déjeuner du lendemain qui en est la seconde portion. */
  eatDay: number;
  eatMealId: string;
}

/** Repère les dîners dont le déjeuner du lendemain est le même plat (déduit du programme, rien n'est stocké). */
export function cookOncePairs(plan: Pick<WeekPlan, 'days'>): CookOncePair[] {
  const pairs: CookOncePair[] = [];
  for (let d = 1; d < plan.days.length; d++) {
    const dinner = plan.days[d - 1]!.meals.find((m) => m.slot === 'diner');
    const lunch = plan.days[d]!.meals.find((m) => m.slot === 'dejeuner');
    if (!dinner || !lunch || dinner.context !== 'home' || lunch.context !== 'home') continue;
    if (dinner.signature === lunch.signature) pairs.push({ cookDay: d - 1, cookMealId: dinner.id, eatDay: d, eatMealId: lunch.id });
  }
  return pairs;
}

// ───────────────────────────── Variété possible ─────────────────────────────

export interface DishCount {
  /** Plats principaux différents à la maison (recette + protéine + féculent). */
  mainsHome: number;
  /** Les mêmes, en comptant chaque assaisonnement comme une variante. */
  mainsHomeFlavored: number;
  snacksHome: number;
  /** Formules de repas à emporter. */
  mainsAway: number;
  snacksAway: number;
}

/**
 * Compte les plats réellement différents que le moteur peut composer avec des préférences données.
 * Deux plats sont différents quand la recette ou un ingrédient principal change ; un autre fruit,
 * un autre laitage ou une garniture facultative ne comptent pas.
 */
export function countPossibleDishes(
  foods: Food[],
  templates: MealTemplate[],
  prefs: Pick<PlannerPreferences, 'excludedFoods' | 'excludedTags' | 'bannedTemplates'> & Pick<Partial<PlannerPreferences>, 'awayPrepAhead'>,
): DishCount {
  const index = indexFoods(foods);
  const allowed = new Set(foods.filter((f) => isAllowed(f, { prefs: prefs as PlannerPreferences })).map((f) => f.id));

  const dishes = (template: MealTemplate, context: MealContext, withFlavors: boolean): Set<string> => {
    const found = new Set<string>();
    const walk = (position: number, chosen: Map<string, string>, identity: string[]): void => {
      const slot = template.items[position];
      if (!slot) {
        found.add(`${template.id}:${[...identity].sort().join('+')}`);
        return;
      }
      if (slot.when) {
        const ref = chosen.get(slot.when.slot);
        if (!ref || !slot.when.in.includes(ref)) return walk(position + 1, chosen, identity);
      }
      const candidates = slot.foods.filter((id) => {
        const food = index.get(id);
        return !!food && allowed.has(id) && (context === 'home' || template.prepAhead === true || (food.portable && food.noCook));
      });
      if (candidates.length === 0) {
        // Rôle obligatoire sans aliment autorisé : la recette est impossible.
        if (slot.optional) walk(position + 1, chosen, identity);
        return;
      }
      const flavor = withFlavors && FLAVOR_SLOTS.has(slot.key);
      const defines = (slot.scaling !== 'fixed' && !slot.optional) || flavor;
      const conditions = template.items.some((other) => other.when?.slot === slot.key);
      if (!defines && !conditions) return walk(position + 1, chosen, identity);
      if (slot.optional) walk(position + 1, chosen, identity);
      for (const id of candidates) {
        walk(position + 1, new Map(chosen).set(slot.key, id), defines ? [...identity, id] : identity);
      }
    };
    walk(0, new Map(), []);
    return found;
  };

  const count = (slot: MealSlotKind, context: MealContext, withFlavors = false): number => {
    const all = new Set<string>();
    for (const template of templates) {
      if (!template.slots.includes(slot) || prefs.bannedTemplates.includes(template.id)) continue;
      if (template.context !== 'any' && template.context !== context) continue;
      if (template.prepAhead && prefs.awayPrepAhead !== true) continue;
      for (const dish of dishes(template, context, withFlavors)) all.add(dish);
    }
    return all.size;
  };

  return {
    mainsHome: count('dejeuner', 'home'),
    mainsHomeFlavored: count('dejeuner', 'home', true),
    snacksHome: count('collation', 'home'),
    mainsAway: count('dejeuner', 'away'),
    snacksAway: count('collation', 'away'),
  };
}

/** Signatures d'un programme, par jour — à fournir comme `previousSignatures` la semaine suivante. */
export function planSignatures(plan: Pick<WeekPlan, 'days'>): string[][] {
  return plan.days.map((d) => d.meals.map((m) => m.signature));
}
