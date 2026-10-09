import { describe, expect, it } from 'vitest';
import {
  DEMO_INVENTORY,
  DEMO_MEALS,
  DEMO_PREFS,
  DEMO_TARGET,
  SEED_FOODS,
  SEED_TEMPLATES,
  type Meal,
  type MealItem,
  type PlannerInput,
  balanceDay,
  bmr,
  countPossibleDishes,
  definedOnly,
  buildMealPrep,
  buildRecipe,
  calorieFloor,
  cookedGrams,
  dayNutrition,
  defaultStructure,
  foodAlternatives,
  generateWeek,
  indexFoods,
  itemsNutrition,
  itemsNutritionExact,
  mealAlternatives,
  nutrientsFor,
  planSignatures,
  rebalanceDay,
  replaceFood,
  replaceMeal,
  solveMeal,
} from '../src/index.js';

const foods = indexFoods(SEED_FOODS);

function makeInput(overrides: Partial<PlannerInput> = {}): PlannerInput {
  return {
    weekStart: '2026-10-12',
    seed: 1234,
    foods: SEED_FOODS,
    templates: SEED_TEMPLATES,
    target: DEMO_TARGET,
    structure: defaultStructure(DEMO_MEALS),
    prefs: DEMO_PREFS,
    away: ['none', 'none', 'none', 'none', 'none', 'none', 'none'],
    inventory: {},
    previousSignatures: [],
    ...overrides,
  };
}

describe('service de nutrition', () => {
  it('calcule les valeurs à partir des grammes et des valeurs pour 100 g', () => {
    const chicken = foods.get('poulet')!;
    const n = nutrientsFor(chicken, 250);
    expect(n.kcal).toBeCloseTo(chicken.per100.kcal * 2.5, 5);
    expect(n.protein).toBeCloseTo(chicken.per100.protein * 2.5, 5);
    expect(n.fat).toBeCloseTo(chicken.per100.fat * 2.5, 5);
    // Blanc de poulet cru : 110 kcal et 23,4 g de protéines pour 100 g (table Ciqual).
    expect(n.kcal).toBeCloseTo(275, 5);
    expect(n.protein).toBeCloseTo(58.5, 5);
  });

  it("additionne les ingrédients d'un repas (exemple du cahier des charges)", () => {
    const n = itemsNutrition(
      [
        { foodId: 'poulet', grams: 250 },
        { foodId: 'riz', grams: 100 },
        { foodId: 'beurre', grams: 10 },
        { foodId: 'skyr', grams: 140 },
        { foodId: 'compote', grams: 100 },
      ],
      foods,
    );
    const kcal = (id: string, grams: number) => (foods.get(id)!.per100.kcal * grams) / 100;
    expect(n.kcal).toBe(Math.round(kcal('poulet', 250) + kcal('riz', 100) + kcal('beurre', 10) + kcal('skyr', 140) + kcal('compote', 100)));
    // Poulet 275 + riz 353 + beurre 75 + skyr 84 + compote 59 : l'ordre de grandeur du cahier des charges.
    expect(n.kcal).toBeGreaterThan(820);
    expect(n.kcal).toBeLessThan(870);
    expect(n.protein).toBeGreaterThan(78);
    expect(n.protein).toBeLessThan(84);
  });

  it('compte le beurre, l’huile et le fromage comme les autres ingrédients', () => {
    const without = itemsNutritionExact([{ foodId: 'pates', grams: 100 }], foods).kcal;
    const withFat = itemsNutritionExact(
      [
        { foodId: 'pates', grams: 100 },
        { foodId: 'huile-olive', grams: 10 },
        { foodId: 'parmesan', grams: 15 },
      ],
      foods,
    ).kcal;
    expect(withFat - without).toBeCloseTo(foods.get('huile-olive')!.per100.kcal * 0.1 + foods.get('parmesan')!.per100.kcal * 0.15, 5);
    expect(withFat - without).toBeGreaterThan(140);
  });

  it('distingue poids cru et poids cuit', () => {
    expect(cookedGrams(foods.get('riz')!, 100)).toBe(280);
    expect(cookedGrams(foods.get('poulet')!, 200)).toBe(150);
    expect(cookedGrams(foods.get('skyr')!, 140)).toBeUndefined();
  });

  it('calcule le métabolisme de base (Mifflin-St Jeor) et un plancher calorique prudent', () => {
    const profile = { sex: 'male' as const, age: 27, heightCm: 184, weightKg: 116 };
    expect(bmr(profile)).toBe(2180);
    expect(calorieFloor(profile)).toBe(1960);
    expect(calorieFloor({ ...profile, weightKg: 60, heightCm: 160 })).toBe(1600);
  });
});

describe('solveur de quantités', () => {
  const item = (foodId: string, scaling: MealItem['scaling'], grams: number): MealItem => {
    const f = foods.get(foodId)!;
    return { slotKey: foodId, foodId, grams, scaling, min: f.portion.min, max: f.portion.max, step: f.portion.step };
  };

  it('résout protéine + féculent pour viser calories et protéines', () => {
    const items = [item('poulet', 'protein', 200), item('riz', 'energy', 80), item('beurre', 'fixed', 10), item('skyr', 'fixed', 140)];
    solveMeal(items, foods, 850, 72);
    const n = itemsNutritionExact(items, foods);
    expect(Math.abs(n.kcal - 850)).toBeLessThan(20);
    expect(Math.abs(n.protein - 72)).toBeLessThan(4);
    expect(items[2]!.grams).toBe(10);
  });

  it('respecte les bornes et les pas de portion', () => {
    const items = [item('poulet', 'protein', 200), item('riz', 'energy', 80)];
    solveMeal(items, foods, 3000, 300);
    expect(items[0]!.grams).toBeLessThanOrEqual(300);
    expect(items[1]!.grams).toBeLessThanOrEqual(150);
    solveMeal(items, foods, 100, 5);
    expect(items[0]!.grams).toBeGreaterThanOrEqual(120);
    expect(items[1]!.grams).toBeGreaterThanOrEqual(40);
    expect(items[0]!.grams % 10).toBe(0);
    expect(items[1]!.grams % 5).toBe(0);
  });

  it('équilibre une journée dans la tolérance', () => {
    const meal = (id: string, items: MealItem[]): Meal => ({
      id,
      slot: 'dejeuner',
      templateId: 't',
      name: id,
      signature: id,
      context: 'home',
      items,
      nutrition: itemsNutrition(items, foods),
      status: 'planned',
    });
    const meals = [
      meal('a', [item('poulet', 'protein', 150), item('riz', 'energy', 60), item('beurre', 'fixed', 10)]),
      meal('b', [item('dinde', 'protein', 150), item('pates', 'energy', 60), item('huile-olive', 'fixed', 10)]),
      meal('c', [item('skyr', 'protein', 140), item('amandes', 'energy', 20), item('banane', 'fixed', 120)]),
    ];
    const result = balanceDay(meals, foods, DEMO_TARGET);
    expect(result.withinTolerance).toBe(true);
    expect(Math.abs(result.kcalGap)).toBeLessThanOrEqual(15);
    expect(result.proteinGap).toBeLessThanOrEqual(2);
  });
});

describe('génération de la semaine', () => {
  const seeds = [1, 7, 42, 99, 2026, 31337];

  it.each(seeds)('respecte la cible calorique et protéique chaque jour (graine %i)', (seed) => {
    const plan = generateWeek(makeInput({ seed }));
    expect(plan.days).toHaveLength(7);
    for (const day of plan.days) {
      expect(day.meals.map((m) => m.slot)).toEqual(['dejeuner', 'collation', 'diner']);
      expect(Math.abs(day.nutrition.kcal - 2300)).toBeLessThanOrEqual(50);
      expect(day.nutrition.protein).toBeGreaterThanOrEqual(175);
    }
  });

  it('dérive toujours les totaux des ingrédients', () => {
    const plan = generateWeek(makeInput());
    for (const day of plan.days) {
      for (const meal of day.meals) {
        expect(meal.nutrition).toEqual(itemsNutrition(meal.items, foods));
        for (const i of meal.items) {
          expect(i.grams).toBeGreaterThanOrEqual(i.min);
          expect(i.grams).toBeLessThanOrEqual(i.max);
        }
      }
      expect(day.nutrition).toEqual(dayNutrition(day.meals, foods));
    }
  });

  it('est déterministe pour une même graine', () => {
    expect(generateWeek(makeInput())).toEqual(generateWeek(makeInput()));
  });

  it('ne propose jamais un aliment refusé ni de légumes', () => {
    const excluded = ['saumon', 'thon', 'sauce-tomate', 'oeufs'];
    const plan = generateWeek(makeInput({ prefs: { ...DEMO_PREFS, excludedFoods: excluded } }));
    const used = new Set(plan.days.flatMap((d) => d.meals.flatMap((m) => m.items.map((i) => i.foodId))));
    for (const id of excluded) expect(used.has(id)).toBe(false);
    for (const id of used) expect(foods.get(id)!.category).not.toBe('legume');
  });

  it('ne propose que du transportable sans cuisine les jours hors domicile', () => {
    const plan = generateWeek(makeInput({ away: ['none', 'lunch', 'none', 'full', 'none', 'none', 'none'] }));
    const tuesday = plan.days[1]!;
    const thursday = plan.days[3]!;
    const awayMeals = [...tuesday.meals.filter((m) => m.slot !== 'diner'), ...thursday.meals];
    expect(tuesday.meals.find((m) => m.slot === 'diner')!.context).toBe('home');
    for (const meal of awayMeals) {
      expect(meal.context).toBe('away');
      for (const i of meal.items) {
        const f = foods.get(i.foodId)!;
        expect(f.portable && f.noCook, `${f.name} doit être transportable sans cuisine`).toBe(true);
      }
    }
    for (const day of [tuesday, thursday]) {
      expect(Math.abs(day.nutrition.kcal - 2300)).toBeLessThanOrEqual(50);
    }
  });

  it('évite de répéter les mêmes repas dans la semaine', () => {
    const plan = generateWeek(makeInput());
    const mains = plan.days.flatMap((d) => d.meals.filter((m) => m.slot !== 'collation').map((m) => m.signature));
    const counts = new Map<string, number>();
    for (const s of mains) counts.set(s, (counts.get(s) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(2);
    expect(counts.size).toBeGreaterThanOrEqual(9);
  });

  it('varie les fruits et laitages au sein d’une même journée', () => {
    const plan = generateWeek(makeInput({ seed: 4242 }));
    const repeats = plan.days.filter((d) => {
      const fruits = d.meals.flatMap((m) => m.items.filter((i) => foods.get(i.foodId)!.category === 'fruit').map((i) => i.foodId));
      return fruits.length === 3 && new Set(fruits).size === 1;
    });
    expect(repeats.length).toBeLessThanOrEqual(1);
  });

  it('évite le même féculent et la même famille de viande midi et soir', () => {
    let sameStarch = 0;
    let days = 0;
    for (const seed of [2, 12, 22, 32]) {
      const plan = generateWeek(makeInput({ seed }));
      for (const day of plan.days) {
        const [lunch, dinner] = day.meals.filter((m) => m.slot !== 'collation');
        const starch = (m: typeof lunch) => m?.items.find((i) => i.scaling === 'energy')?.foodId;
        days++;
        if (starch(lunch) && starch(lunch) === starch(dinner)) sameStarch++;
      }
    }
    expect(sameStarch / days).toBeLessThan(0.2);
  });

  it('produit une semaine différente de la précédente', () => {
    const first = generateWeek(makeInput({ weekStart: '2026-10-12', seed: 5 }));
    const second = generateWeek(makeInput({ weekStart: '2026-10-19', seed: 5, previousSignatures: planSignatures(first) }));
    const a = planSignatures(first);
    const b = planSignatures(second);
    const sameSlot = a.flatMap((day, d) => day.filter((sig, m) => b[d]![m] === sig)).length;
    expect(sameSlot).toBeLessThanOrEqual(3);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('utilise en priorité les stocks disponibles', () => {
    const withStock = generateWeek(makeInput({ inventory: { ...DEMO_INVENTORY, 'poisson-blanc': 2000, semoule: 1000 } }));
    const count = (id: string) => withStock.days.flatMap((d) => d.meals).filter((m) => m.items.some((i) => i.foodId === id)).length;
    expect(count('poisson-blanc')).toBeGreaterThanOrEqual(1);
  });

  it('regroupe les plats en mode meal prep', () => {
    const plan = generateWeek(makeInput({ prefs: { ...DEMO_PREFS, level: 'meal-prep' } }));
    const lunches = plan.days.map((d) => d.meals.find((m) => m.slot === 'dejeuner')!.signature);
    expect(new Set(lunches).size).toBeLessThanOrEqual(5);
  });

  it('gère une structure avec petit-déjeuner', () => {
    const plan = generateWeek(makeInput({ structure: defaultStructure(['petit-dejeuner', 'dejeuner', 'collation', 'diner']) }));
    for (const day of plan.days) {
      expect(day.meals).toHaveLength(4);
      expect(Math.abs(day.nutrition.kcal - 2300)).toBeLessThanOrEqual(50);
    }
  });

  it('signale les limites nutritionnelles sans avis médical', () => {
    const plan = generateWeek(makeInput());
    const codes = plan.warnings.map((w) => w.code);
    expect(codes).toContain('no-vegetables');
    expect(plan.warnings.find((w) => w.code === 'no-vegetables')!.message).toMatch(/médecin|diététicien/);
  });
});

describe('catalogue de recettes', () => {
  const NO_FISH = { ...DEMO_PREFS, excludedTags: ['legume', 'poisson'] };

  it('ne référence que des aliments existants', () => {
    for (const template of SEED_TEMPLATES) {
      for (const slot of template.items) {
        for (const id of slot.foods) expect(foods.has(id), `${template.id} → ${id}`).toBe(true);
        if (slot.when) expect(template.items.some((s) => s.key === slot.when!.slot), `${template.id} → when ${slot.when.slot}`).toBe(true);
      }
      const keys = template.items.map((s) => s.key);
      expect(new Set(keys).size, `${template.id} : rôles en double`).toBe(keys.length);
      // Chaque étape ne cite que des rôles du modèle.
      for (const step of template.steps) {
        for (const [, key] of step.matchAll(/\{(\w+)(?::\w+)?\}/g)) expect(keys, `${template.id} : étape « ${step.slice(0, 40)} »`).toContain(key);
      }
    }
  });

  it('chaque plat principal peut approcher la cible du déjeuner', () => {
    // Chaque modèle, forcé sur toute une semaine, doit donner des journées dans la tolérance.
    const mains = SEED_TEMPLATES.filter((t) => t.slots.includes('dejeuner'));
    for (const template of mains) {
      const others = mains.filter((t) => t.context === template.context && t.id !== template.id).map((t) => t.id);
      const away = template.context === 'away';
      const plan = generateWeek(
        makeInput({ seed: 9, away: Array(7).fill(away ? 'full' : 'none'), prefs: { ...DEMO_PREFS, bannedTemplates: others, awayPrepAhead: !!template.prepAhead } }),
      );
      const off = plan.days.filter((d) => Math.abs(d.nutrition.kcal - 2300) > 50);
      expect(off.length, `${template.id} : ${plan.days.map((d) => d.nutrition.kcal).join(' ')}`).toBe(0);
      // Pire cas (le même plat midi et soir, ce que le moteur ne fait jamais de lui-même) : les calories
      // doivent tenir, et les protéines rester élevées même avec un plat aux œufs.
      const lowProtein = plan.days.filter((d) => d.nutrition.protein < 155);
      expect(lowProtein.length, `${template.id} protéines : ${plan.days.map((d) => d.nutrition.protein).join(' ')}`).toBe(0);
    }
  });

  it('reste varié sans poisson', () => {
    const count = countPossibleDishes(SEED_FOODS, SEED_TEMPLATES, { ...NO_FISH, bannedTemplates: [] });
    expect(count.mainsHome).toBeGreaterThanOrEqual(60);
    expect(count.mainsAway).toBeGreaterThanOrEqual(4);
    const all = countPossibleDishes(SEED_FOODS, SEED_TEMPLATES, { excludedFoods: [], excludedTags: [], bannedTemplates: [] });
    expect(all.mainsHome).toBeGreaterThan(count.mainsHome);

    for (const seed of [3, 17, 2026]) {
      const plan = generateWeek(makeInput({ seed, prefs: NO_FISH }));
      for (const day of plan.days) {
        expect(Math.abs(day.nutrition.kcal - 2300)).toBeLessThanOrEqual(50);
        expect(day.nutrition.protein).toBeGreaterThanOrEqual(175);
        for (const meal of day.meals) for (const i of meal.items) expect(foods.get(i.foodId)!.category).not.toBe('poisson');
      }
      const mains = plan.days.flatMap((d) => d.meals.filter((m) => m.slot !== 'collation').map((m) => m.signature));
      expect(new Set(mains).size).toBeGreaterThanOrEqual(12);
    }
  });

  it('ne propose un aliment « rarement » qu’une fois par semaine au plus', () => {
    for (const level of ['normal', 'meal-prep'] as const) {
      for (const seed of [1, 8, 15, 22, 29, 36]) {
        const plan = generateWeek(makeInput({ seed, prefs: { ...NO_FISH, level, limitedFoods: ['dinde'] } }));
        const withTurkey = plan.days.flatMap((d) => d.meals).filter((m) => m.items.some((i) => i.foodId === 'dinde'));
        expect(withTurkey.length, `${level}, graine ${seed}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('fusionne une mise à jour partielle sans effacer le reste', () => {
    class Dto {
      likedFoods?: string[] = undefined;
      level?: string = undefined;
    }
    const partial = Object.assign(new Dto(), { level: 'meal-prep' });
    const current = { likedFoods: ['poulet'], level: 'normal', excludedTags: ['legume'] };
    expect({ ...current, ...partial }.likedFoods).toBeUndefined();
    expect({ ...current, ...definedOnly(partial) }).toEqual({ likedFoods: ['poulet'], level: 'meal-prep', excludedTags: ['legume'] });
  });
});

describe('remplacements', () => {
  const input = makeInput({ seed: 77 });
  const plan = generateWeek(input);

  it('« je n’aime pas ce repas » : change le repas et garde la journée sur la cible', () => {
    const before = plan.days[2]!.meals[0]!;
    const next = replaceMeal(input, plan, 2, before.id);
    const after = next.days[2]!.meals[0]!;
    expect(after.signature).not.toBe(before.signature);
    expect(after.slot).toBe(before.slot);
    expect(after.swapped).toBe(true);
    expect(after.rejectedSignatures).toContain(before.signature);
    expect(Math.abs(next.days[2]!.nutrition.kcal - 2300)).toBeLessThanOrEqual(50);
    expect(next.days[2]!.nutrition.protein).toBeGreaterThanOrEqual(175);
    // Le programme d'origine n'est pas modifié.
    expect(plan.days[2]!.meals[0]!.id).toBe(before.id);
    // Les autres jours ne bougent pas.
    expect(next.days[3]).toEqual(plan.days[3]);
  });

  it('ne repropose pas un repas déjà refusé', () => {
    const first = plan.days[0]!.meals[2]!;
    const once = replaceMeal(input, plan, 0, first.id);
    const second = once.days[0]!.meals[2]!;
    const twice = replaceMeal(input, once, 0, second.id);
    const third = twice.days[0]!.meals[2]!;
    expect([first.signature, second.signature]).not.toContain(third.signature);
  });

  it('propose plusieurs variantes équivalentes et distinctes', () => {
    const meal = plan.days[1]!.meals[2]!;
    const options = mealAlternatives(input, plan, 1, meal.id, 3);
    expect(options.length).toBe(3);
    expect(new Set(options.map((o) => o.signature)).size).toBe(3);
    for (const option of options) {
      expect(option.signature).not.toBe(meal.signature);
      expect(Math.abs(option.nutrition.kcal - meal.nutrition.kcal)).toBeLessThan(120);
    }
    const applied = replaceMeal(input, plan, 1, meal.id, undefined, options[1]);
    expect(applied.days[1]!.meals[2]!.signature).toBe(options[1]!.signature);
    expect(Math.abs(applied.days[1]!.nutrition.kcal - 2300)).toBeLessThanOrEqual(50);
  });

  it('« remplacer uniquement cet aliment » : garde le reste du repas et recalcule', () => {
    const dayIndex = plan.days.findIndex((d) => d.meals.some((m) => m.items.some((i) => i.slotKey === 'starch')));
    const meal = plan.days[dayIndex]!.meals.find((m) => m.items.some((i) => i.slotKey === 'starch'))!;
    const options = foodAlternatives(input, plan, dayIndex, meal.id, 'protein');
    const starchOptions = foodAlternatives(input, plan, dayIndex, meal.id, 'starch');
    expect(options.length + starchOptions.length).toBeGreaterThan(0);

    const slotKey = starchOptions.length ? 'starch' : 'protein';
    const choice = (starchOptions.length ? starchOptions : options)[0]!;
    const next = replaceFood(input, plan, dayIndex, meal.id, slotKey, choice.foodId);
    const updated = next.days[dayIndex]!.meals.find((m) => m.id === meal.id)!;
    expect(updated.items.find((i) => i.slotKey === slotKey)!.foodId).toBe(choice.foodId);
    for (const original of meal.items.filter((i) => i.slotKey !== slotKey)) {
      expect(updated.items.find((i) => i.slotKey === original.slotKey)!.foodId).toBe(original.foodId);
    }
    expect(Math.abs(next.days[dayIndex]!.nutrition.kcal - 2300)).toBeLessThanOrEqual(50);
  });

  it('recalcule le reste de la journée après un repas réellement plus copieux', () => {
    const day = plan.days[4]!;
    const lunch = day.meals[0]!;
    const consumed = { ...lunch.nutrition, kcal: lunch.nutrition.kcal + 250, protein: lunch.nutrition.protein + 5 };
    const next = rebalanceDay(input, plan, 4, { lockedMealIds: [lunch.id], consumed });
    const rest = next.days[4]!.meals.filter((m) => m.id !== lunch.id);
    const restKcal = rest.reduce((sum, m) => sum + m.nutrition.kcal, 0);
    expect(next.days[4]!.meals[0]).toEqual(lunch);
    expect(Math.abs(consumed.kcal + restKcal - 2300)).toBeLessThanOrEqual(50);
  });
});

describe('recettes et meal prep', () => {
  const input = makeInput({ seed: 11 });
  const plan = generateWeek(input);
  const options = { level: 'normal' as const, equipment: DEMO_PREFS.equipment };

  it('génère une recette avec ingrédients exacts, étapes et temps', () => {
    const meal = plan.days.flatMap((d) => d.meals).find((m) => m.slot === 'dejeuner' && m.context === 'home')!;
    const template = SEED_TEMPLATES.find((t) => t.id === meal.templateId);
    const recipe = buildRecipe(meal, template, foods, options);
    expect(recipe.ingredients).toHaveLength(meal.items.length);
    expect(recipe.steps.length).toBeGreaterThanOrEqual(3);
    expect(recipe.steps.join(' ')).not.toMatch(/[{}]/);
    expect(recipe.steps.join(' ')).not.toMatch(/poids cru/);
    expect(recipe.nutrition).toEqual(meal.nutrition);
    expect(recipe.prepMin + recipe.cookMin).toBeGreaterThan(0);
    const starch = recipe.ingredients.find((i) => i.cookedGrams);
    if (starch) expect(starch.label).toMatch(/poids cru, ≈ \d+ g cuit/);
  });

  it('regroupe les quantités pour 3 jours de meal prep', () => {
    const prep = buildMealPrep(plan, foods, 0, 3, options);
    expect(prep.portions.length).toBe(6);
    for (const total of prep.totals) {
      const sum = prep.portions.flatMap((p) => p.items).filter((i) => i.foodId === total.foodId).reduce((s, i) => s + i.rawGrams, 0);
      expect(total.rawGrams).toBe(sum);
    }
    expect(prep.totals.some((t) => t.foodId === 'skyr')).toBe(false);
    expect(prep.steps.length).toBeGreaterThan(2);
  });
});
