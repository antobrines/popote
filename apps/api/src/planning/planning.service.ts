/**
 * Programme hebdomadaire : génération, remplacements, suivi « prévu / réel ».
 * Toute la logique de calcul vit dans `@bouffe/core` ; ce service assemble les données
 * (préférences, stocks, semaine précédente) et persiste le résultat.
 */
import { randomInt } from 'node:crypto';
import {
  type AwayMode,
  CATALOG_VERSION,
  type DayLock,
  type Food,
  type Meal,
  type MealStatus,
  type PlannerInput,
  type PrepLevel,
  type SpreadReport,
  type WeekPlan,
  ZERO,
  addDays,
  addNutrients,
  addToInventory,
  applyWeekSpread,
  bestPricePerKg,
  buildMealPrep,
  buildRecipe,
  calorieFloor,
  consumeFromInventory,
  defaultStructure,
  foodAlternatives,
  generateWeek,
  indexFoods,
  mealAlternatives,
  mondayOf,
  nutrientsFor,
  planSignatures,
  rebalanceDay,
  regenerateDay,
  repeatMeal,
  replaceFood,
  replaceMeal,
  snapshotNutrients,
  summarizePlan,
  swapMeals,
  toISODate,
} from '@bouffe/core';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { CatalogService } from '../catalog/catalog.service.js';
import { domain } from '../common/domain.js';
import { type FoodEntryDoc, M, type MealPlanDoc, type UserDoc, type WeightEntryDoc } from '../db/schemas.js';
import { ShoppingService } from '../shopping/shopping.service.js';

/** Réduction maximale par jour quand un repas libre est lissé sur la semaine. */
const SPREAD_MAX_PER_DAY = 150;
const FREE_MEAL_KEY = 'repas-libre';

export function toWeekPlan(doc: MealPlanDoc): WeekPlan {
  const o = doc.toObject({ versionKey: false }) as unknown as WeekPlan;
  return {
    weekStart: o.weekStart,
    seed: o.seed,
    level: o.level,
    target: o.target,
    structure: o.structure,
    days: o.days,
    averages: o.averages,
    warnings: o.warnings,
  };
}

export function serverToday(): string {
  return toISODate(new Date());
}

@Injectable()
export class PlanningService {
  constructor(
    @InjectModel(M.MealPlan) private readonly plans: Model<MealPlanDoc>,
    @InjectModel(M.FoodEntry) private readonly entries: Model<FoodEntryDoc>,
    @InjectModel(M.WeightEntry) private readonly weights: Model<WeightEntryDoc>,
    private readonly catalog: CatalogService,
    private readonly shopping: ShoppingService,
  ) {}

  // ───────────── Assemblage des entrées du moteur ─────────────

  /** Plancher calorique du compte : aucun jour n'est planifié en dessous. */
  private async floorKcal(userId: string, user: UserDoc): Promise<number> {
    const profile = user.profile;
    if (!profile) return 0;
    const latest = await this.weights.findOne({ userId }).sort({ date: -1 });
    return calorieFloor({
      sex: profile.sex,
      age: new Date().getFullYear() - profile.birthYear,
      heightCm: profile.heightCm,
      weightKg: latest?.kg ?? profile.startWeightKg,
    });
  }

  async plannerInput(
    userId: string,
    weekStart: string,
    overrides: { away?: AwayMode[]; level?: PrepLevel; plan?: WeekPlan } = {},
  ): Promise<PlannerInput> {
    const [user, foods, templates, inventory, store, previous] = await Promise.all([
      this.catalog.user(userId),
      this.catalog.foods(userId),
      this.catalog.templates(userId),
      this.catalog.inventoryMap(userId),
      this.catalog.store(userId),
      this.plans.findOne({ userId, weekStart: addDays(weekStart, -7) }),
    ]);
    const prefs = user.preferences;
    const target = overrides.plan?.target ?? (await this.catalog.target(userId));
    const packages = await this.catalog.packages(userId, store);
    const pricePerKg: Record<string, number> = {};
    for (const food of foods) {
      const price = bestPricePerKg(packages[food.id]?.length ? packages[food.id]! : food.packages);
      if (price !== null) pricePerKg[food.id] = price;
    }
    const feedback = prefs.mealFeedback ?? [];
    const trainingDays = prefs.trainingDays?.length === 7 ? prefs.trainingDays : [];
    return {
      weekStart,
      seed: overrides.plan?.seed ?? randomInt(1, 2 ** 31 - 1),
      foods,
      templates,
      target,
      structure: overrides.plan?.structure ?? defaultStructure(prefs.meals?.length ? prefs.meals : ['dejeuner', 'collation', 'diner']),
      prefs: {
        excludedFoods: prefs.excludedFoods ?? [],
        excludedTags: prefs.excludedTags ?? [],
        likedFoods: prefs.likedFoods ?? [],
        limitedFoods: prefs.limitedFoods ?? [],
        cookOnce: prefs.cookOnce === true,
        awayPrepAhead: prefs.awayPrepAhead === true,
        bannedSignatures: feedback.filter((f) => f.banned).map((f) => f.signature),
        bannedTemplates: [],
        favoriteSignatures: feedback.filter((f) => f.favorite).map((f) => f.signature),
        ratings: Object.fromEntries(feedback.filter((f) => f.rating).map((f) => [f.signature, f.rating!])),
        level: overrides.level ?? overrides.plan?.level ?? prefs.level ?? 'normal',
        equipment: prefs.equipment ?? [],
      },
      away: overrides.away ?? overrides.plan?.days.map((d) => d.away) ?? (prefs.awayDays?.length === 7 ? prefs.awayDays : Array(7).fill('none')),
      inventory,
      previousSignatures: previous ? planSignatures(toWeekPlan(previous)) : [],
      pricePerKg,
      weeklyBudget: prefs.weeklyBudget ?? undefined,
      packages,
      training: trainingDays.some(Boolean)
        ? { days: trainingDays, bonusKcal: prefs.trainingBonusKcal ?? 200, floorKcal: await this.floorKcal(userId, user) }
        : undefined,
    };
  }

  private async load(userId: string, planId: string): Promise<MealPlanDoc> {
    const plan = await this.plans.findOne({ _id: planId, userId }).catch(() => null);
    if (!plan) throw new NotFoundException('Programme introuvable.');
    return plan;
  }

  private find(plan: WeekPlan, mealId: string): { dayIndex: number; meal: Meal } {
    for (const day of plan.days) {
      const meal = day.meals.find((m) => m.id === mealId);
      if (meal) return { dayIndex: day.index, meal };
    }
    throw new NotFoundException('Repas introuvable.');
  }

  /** Ce qui est déjà figé dans chaque journée : repas déclarés + tout ce qui a réellement été mangé. */
  private async weekLocks(userId: string, plan: WeekPlan): Promise<Record<number, DayLock>> {
    const eaten = await this.entries.find({ userId, date: { $gte: plan.weekStart, $lte: addDays(plan.weekStart, 6) } });
    const locks: Record<number, DayLock> = {};
    for (const day of plan.days) {
      locks[day.index] = {
        lockedMealIds: day.meals.filter((m) => m.status !== 'planned').map((m) => m.id),
        consumed: eaten.filter((e) => e.date === day.date).reduce((sum, e) => addNutrients(sum, e.nutrition), { ...ZERO }),
      };
    }
    return locks;
  }

  private async dayLock(userId: string, plan: WeekPlan, dayIndex: number): Promise<DayLock> {
    return (await this.weekLocks(userId, plan))[dayIndex]!;
  }

  private async persist(userId: string, doc: MealPlanDoc, plan: WeekPlan, today: string): Promise<MealPlanDoc> {
    doc.set({ days: plan.days, averages: plan.averages, warnings: plan.warnings, catalogVersion: CATALOG_VERSION });
    await doc.save();
    await this.shopping.refreshList(userId, doc, { today });
    return doc;
  }

  // ───────────── Génération ─────────────

  /**
   * « Générer ma semaine ». Si un programme existe déjà pour cette semaine :
   *  - les jours passés et ceux qui contiennent des repas déclarés sont conservés tels quels ;
   *  - les repas verrouillés (cadenas) sont gardés, le reste est régénéré autour d'eux.
   */
  async generate(userId: string, options: { weekStart?: string; away?: AwayMode[]; level?: PrepLevel; today: string }): Promise<MealPlanDoc> {
    const weekStart = mondayOf(options.weekStart ?? options.today);
    const existing = await this.plans.findOne({ userId, weekStart });
    const input = await this.plannerInput(userId, weekStart, { away: options.away, level: options.level });
    const old = existing ? toWeekPlan(existing) : null;
    const sameStructure = !!old && old.structure.map((s) => s.slot).join() === input.structure.map((s) => s.slot).join();
    if (old && sameStructure) {
      input.keep = old.days.map((d) => d.meals.map((m) => (m.locked && m.status === 'planned' ? m : null)));
    }
    let plan = domain(() => generateWeek(input));

    if (old) {
      const frozen = new Map(old.days.filter((d) => d.date < options.today || d.meals.some((m) => m.status !== 'planned')).map((d) => [d.index, d]));
      if (frozen.size > 0) {
        plan = summarizePlan({ ...plan, days: plan.days.map((d) => frozen.get(d.index) ?? d) }, input.foods);
      }
    }

    const doc = await this.plans.findOneAndUpdate(
      { userId, weekStart },
      { $set: { ...plan, userId, catalogVersion: CATALOG_VERSION }, $inc: { generation: 1 } },
      { upsert: true, returnDocument: 'after' },
    );
    await this.shopping.refreshList(userId, doc!, { today: options.today, force: true });
    return doc!;
  }

  async history(userId: string, limit = 12) {
    const docs = await this.plans.find({ userId }).sort({ weekStart: -1 }).limit(limit);
    return docs.map((d) => ({
      id: d.id,
      weekStart: d.weekStart,
      averages: d.averages,
      target: d.target,
      level: d.level,
      meals: d.days.flatMap((day) => day.meals.filter((m) => m.slot !== 'collation').map((m) => m.name)).slice(0, 6),
    }));
  }

  async get(userId: string, planId: string): Promise<MealPlanDoc> {
    return this.load(userId, planId);
  }

  // ───────────── Remplacements ─────────────

  async alternatives(userId: string, planId: string, mealId: string): Promise<Meal[]> {
    const doc = await this.load(userId, planId);
    const plan = toWeekPlan(doc);
    const { dayIndex } = this.find(plan, mealId);
    const [input, lock] = await Promise.all([this.plannerInput(userId, plan.weekStart, { plan }), this.dayLock(userId, plan, dayIndex)]);
    return domain(() => mealAlternatives(input, plan, dayIndex, mealId, 3, lock));
  }

  async replaceMeal(userId: string, planId: string, mealId: string, replacement: Pick<Meal, 'templateId' | 'items'> | undefined, today: string) {
    const doc = await this.load(userId, planId);
    const plan = toWeekPlan(doc);
    const { dayIndex, meal } = this.find(plan, mealId);
    if (meal.status !== 'planned') throw new BadRequestException('Ce repas est déjà déclaré : annule la déclaration avant de le remplacer.');
    const [input, lock] = await Promise.all([this.plannerInput(userId, plan.weekStart, { plan }), this.dayLock(userId, plan, dayIndex)]);
    return this.persist(userId, doc, domain(() => replaceMeal(input, plan, dayIndex, mealId, lock, replacement)), today);
  }

  async foodAlternatives(userId: string, planId: string, mealId: string, slotKey: string) {
    const doc = await this.load(userId, planId);
    const plan = toWeekPlan(doc);
    const { dayIndex } = this.find(plan, mealId);
    const input = await this.plannerInput(userId, plan.weekStart, { plan });
    return domain(() => foodAlternatives(input, plan, dayIndex, mealId, slotKey));
  }

  async replaceFood(userId: string, planId: string, mealId: string, slotKey: string, toFoodId: string | undefined, today: string) {
    const doc = await this.load(userId, planId);
    const plan = toWeekPlan(doc);
    const { dayIndex, meal } = this.find(plan, mealId);
    if (meal.status !== 'planned') throw new BadRequestException('Ce repas est déjà déclaré.');
    const [input, lock] = await Promise.all([this.plannerInput(userId, plan.weekStart, { plan }), this.dayLock(userId, plan, dayIndex)]);
    return this.persist(userId, doc, domain(() => replaceFood(input, plan, dayIndex, mealId, slotKey, toFoodId, lock)), today);
  }

  async repeat(userId: string, planId: string, mealId: string, targetMealId: string, today: string) {
    const doc = await this.load(userId, planId);
    const plan = toWeekPlan(doc);
    const from = this.find(plan, mealId);
    const to = this.find(plan, targetMealId);
    if (to.meal.status !== 'planned') throw new BadRequestException('Le repas cible est déjà déclaré.');
    const [input, lock] = await Promise.all([this.plannerInput(userId, plan.weekStart, { plan }), this.dayLock(userId, plan, to.dayIndex)]);
    const next = domain(() => repeatMeal(input, plan, { dayIndex: from.dayIndex, mealId }, { dayIndex: to.dayIndex, mealId: targetMealId }, lock));
    return this.persist(userId, doc, next, today);
  }

  /** Échange deux repas du programme (vue semaine). */
  async swap(userId: string, planId: string, mealId: string, otherMealId: string, today: string) {
    const doc = await this.load(userId, planId);
    const plan = toWeekPlan(doc);
    const a = this.find(plan, mealId);
    const b = this.find(plan, otherMealId);
    const [input, locks] = await Promise.all([this.plannerInput(userId, plan.weekStart, { plan }), this.weekLocks(userId, plan)]);
    const next = domain(() => swapMeals(input, plan, { dayIndex: a.dayIndex, mealId }, { dayIndex: b.dayIndex, mealId: otherMealId }, locks));
    return this.persist(userId, doc, next, today);
  }

  /** Pose ou retire le cadenas : un repas verrouillé est conservé quand on régénère la semaine. */
  async setLocked(userId: string, planId: string, mealId: string, locked: boolean) {
    const doc = await this.load(userId, planId);
    const plan = toWeekPlan(doc);
    const { meal } = this.find(plan, mealId);
    if (locked) meal.locked = true;
    else delete meal.locked;
    doc.set({ days: plan.days });
    await doc.save();
    return doc;
  }

  async rebalance(userId: string, planId: string, dayIndex: number, today: string) {
    const doc = await this.load(userId, planId);
    const plan = toWeekPlan(doc);
    if (!plan.days[dayIndex]) throw new NotFoundException('Jour introuvable.');
    const [input, lock] = await Promise.all([this.plannerInput(userId, plan.weekStart, { plan }), this.dayLock(userId, plan, dayIndex)]);
    return this.persist(userId, doc, domain(() => rebalanceDay(input, plan, dayIndex, lock)), today);
  }

  /** Déclare (ou annule) une absence pour un jour : les repas du jour sont régénérés. */
  async setAway(userId: string, planId: string, dayIndex: number, away: AwayMode, today: string) {
    const doc = await this.load(userId, planId);
    const plan = toWeekPlan(doc);
    const day = plan.days[dayIndex];
    if (!day) throw new NotFoundException('Jour introuvable.');
    if (day.meals.some((m) => m.status !== 'planned')) {
      throw new BadRequestException('Des repas de ce jour sont déjà déclarés : impossible de régénérer la journée.');
    }
    const input = await this.plannerInput(userId, plan.weekStart, { plan });
    return this.persist(userId, doc, domain(() => regenerateDay(input, plan, dayIndex, away)), today);
  }

  /**
   * Après un changement de valeurs nutritionnelles (« mes vrais produits »), recalcule les programmes
   * en cours : totaux à jour, puis quantités des jours à venir réajustées sur leur cible.
   */
  async recomputePlans(userId: string, today: string): Promise<void> {
    const docs = await this.plans.find({ userId, weekStart: { $gte: mondayOf(today) } });
    for (const doc of docs) {
      let plan = toWeekPlan(doc);
      const input = await this.plannerInput(userId, plan.weekStart, { plan });
      const locks = await this.weekLocks(userId, plan);
      plan = summarizePlan(plan, input.foods);
      for (const day of plan.days) {
        if (day.date < today || !day.meals.some((m) => m.status === 'planned')) continue;
        plan = domain(() => rebalanceDay(input, plan, day.index, locks[day.index]!));
      }
      await this.persist(userId, doc, plan, today);
    }
  }

  /**
   * Le catalogue a changé (nouvelles valeurs nutritionnelles) depuis le calcul d'un programme en
   * cours ou à venir : on le recalcule, une seule fois, pour que les quantités restent justes.
   */
  async syncCatalog(userId: string, today: string): Promise<void> {
    const stale = await this.plans.exists({ userId, weekStart: { $gte: mondayOf(today) }, catalogVersion: { $ne: CATALOG_VERSION } });
    if (stale) await this.recomputePlans(userId, today);
  }

  /** Vrai si un programme en cours ou à venir contient cet aliment. */
  async usesFood(userId: string, foodId: string, today: string): Promise<boolean> {
    return !!(await this.plans.exists({ userId, weekStart: { $gte: mondayOf(today) }, 'days.meals.items.foodId': foodId }));
  }

  // ───────────── Prévu / réel ─────────────

  private async clearMealLog(userId: string, planId: string, mealId: string): Promise<void> {
    const previous = await this.entries.find({ userId, planId, mealId });
    if (previous.length === 0) return;
    // Annuler une déclaration remet les quantités dans les stocks théoriques.
    const consumed = previous.filter((e) => e.foodKey !== FREE_MEAL_KEY);
    if (consumed.length > 0) {
      const inventory = await this.catalog.inventoryMap(userId);
      const { changes } = addToInventory(
        inventory,
        consumed.map((e) => ({ foodId: e.foodKey, grams: e.grams })),
      );
      await this.catalog.setInventory(userId, Object.fromEntries(changes.map((c) => [c.foodId, c.grams])));
    }
    await this.entries.deleteMany({ userId, planId, mealId });
  }

  /**
   * Recalcule le lissage des repas libres sur la semaine (et le reste des journées concernées).
   * `spread = false` rééquilibre seulement le jour même, sans toucher aux jours suivants.
   */
  private async respread(userId: string, plan: WeekPlan, today: string, spread = true): Promise<{ plan: WeekPlan; report: SpreadReport }> {
    const [user, input, locks] = await Promise.all([this.catalog.user(userId), this.plannerInput(userId, plan.weekStart, { plan }), this.weekLocks(userId, plan)]);
    const floorKcal = await this.floorKcal(userId, user);
    return domain(() => applyWeekSpread(input, plan, locks, today, { maxPerDayKcal: spread ? SPREAD_MAX_PER_DAY : 0, floorKcal }));
  }

  /**
   * Déclare ce qui a réellement été mangé pour un repas.
   * - `eaten`    : le repas tel que prévu ;
   * - `partial`  : une partie seulement (`items` = quantités réelles) ;
   * - `replaced` : autre chose a été mangé (`items` = aliments réels) ;
   * - `skipped`  : repas sauté ;
   * - `planned`  : annule la déclaration.
   * Les stocks théoriques sont mis à jour, et le reste de la journée peut être recalculé.
   */
  async logMeal(
    userId: string,
    planId: string,
    mealId: string,
    body: { status: MealStatus; items?: { foodId: string; grams: number }[]; rebalance?: boolean },
    today: string,
  ) {
    const doc = await this.load(userId, planId);
    let plan = toWeekPlan(doc);
    const { dayIndex, meal } = this.find(plan, mealId);
    const day = plan.days[dayIndex]!;
    const foods = indexFoods(await this.catalog.foods(userId));

    await this.clearMealLog(userId, planId, mealId);

    let eaten: { foodId: string; grams: number }[] = [];
    if (body.status === 'eaten') eaten = meal.items.map((i) => ({ foodId: i.foodId, grams: i.grams }));
    if (body.status === 'partial' || body.status === 'replaced') {
      eaten = (body.items ?? []).filter((i) => i.grams > 0);
      if (eaten.length === 0) throw new BadRequestException('Indique au moins un aliment réellement mangé.');
    }
    const resolved = eaten.map((item) => {
      const food: Food | undefined = foods.get(item.foodId);
      if (!food) throw new BadRequestException(`Aliment inconnu : ${item.foodId}`);
      return { food, grams: Math.round(item.grams) };
    });

    if (resolved.length > 0) {
      await this.entries.insertMany(
        resolved.map(({ food, grams }) => ({
          userId,
          date: day.date,
          slot: meal.slot,
          planId: doc._id,
          mealId,
          foodKey: food.id,
          name: food.name,
          grams,
          nutrition: snapshotNutrients(nutrientsFor(food, grams)),
          source: 'plan',
        })),
      );
      const inventory = await this.catalog.inventoryMap(userId);
      const { changes } = consumeFromInventory(
        inventory,
        resolved.map(({ food, grams }) => ({ foodId: food.id, grams })),
      );
      await this.catalog.setInventory(userId, Object.fromEntries(changes.map((c) => [c.foodId, c.grams])));
    }

    // Un repas libre remplacé par une autre déclaration (ou annulé) : son lissage est recalculé.
    const hadSpread = !!meal.free || plan.days.some((d) => d.spreadKcal);
    delete meal.free;
    meal.status = body.status;
    if (hadSpread) {
      plan = (await this.respread(userId, plan, today)).plan;
    } else if (body.rebalance) {
      const [input, lock] = await Promise.all([this.plannerInput(userId, plan.weekStart, { plan }), this.dayLock(userId, plan, dayIndex)]);
      plan = domain(() => rebalanceDay(input, plan, dayIndex, lock));
    }
    return this.persist(userId, doc, plan, today);
  }

  /**
   * « Repas libre » (restaurant, soirée…) : on ne sait pas ce qui a été mangé, seulement à peu près
   * combien. Le reste de la journée est réduit autant que possible et, si demandé, l'excédent est
   * lissé sur les jours suivants par petites touches bornées — jamais sous le plancher du compte.
   */
  async freeMeal(
    userId: string,
    planId: string,
    mealId: string,
    body: { kcal: number; protein?: number; label?: string; spread?: boolean },
    today: string,
  ): Promise<SpreadReport> {
    const doc = await this.load(userId, planId);
    const plan = toWeekPlan(doc);
    const { dayIndex, meal } = this.find(plan, mealId);
    const day = plan.days[dayIndex]!;
    const kcal = Math.round(body.kcal);
    // Sans précision, on retient 18 % de protéines : l'ordre de grandeur d'un repas de restaurant.
    const protein = Math.round(body.protein ?? (kcal * 0.18) / 4);
    const label = (body.label ?? '').trim().slice(0, 60) || 'Repas libre';

    await this.clearMealLog(userId, planId, mealId);
    await this.entries.create({
      userId,
      date: day.date,
      slot: meal.slot,
      planId: doc._id,
      mealId,
      foodKey: FREE_MEAL_KEY,
      name: label,
      grams: 0,
      nutrition: { kcal, protein, carbs: 0, fat: 0, fiber: 0 },
      source: 'manual',
    });
    meal.status = 'replaced';
    meal.free = { kcal, protein, label };

    const result = await this.respread(userId, plan, today, body.spread !== false);
    await this.persist(userId, doc, result.plan, today);
    return result.report;
  }

  // ───────────── Avis, recettes, meal prep ─────────────

  async feedback(userId: string, planId: string, mealId: string, body: { rating?: number; favorite?: boolean; banned?: boolean }) {
    const doc = await this.load(userId, planId);
    const { meal } = this.find(toWeekPlan(doc), mealId);
    const user = await this.catalog.user(userId);
    const list = user.preferences.mealFeedback ?? [];
    let entry = list.find((f) => f.signature === meal.signature);
    if (!entry) {
      list.push({ signature: meal.signature, name: meal.name });
      entry = list[list.length - 1]!;
    }
    if (body.rating !== undefined) entry.rating = Math.min(5, Math.max(1, Math.round(body.rating)));
    if (body.favorite !== undefined) entry.favorite = body.favorite;
    if (body.banned !== undefined) entry.banned = body.banned;
    user.preferences.mealFeedback = list;
    user.markModified('preferences.mealFeedback');
    await user.save();
    return user;
  }

  async recipe(userId: string, planId: string, mealId: string, level?: PrepLevel) {
    const doc = await this.load(userId, planId);
    const plan = toWeekPlan(doc);
    const { meal } = this.find(plan, mealId);
    const [user, foods, templates] = await Promise.all([this.catalog.user(userId), this.catalog.foods(userId), this.catalog.templates(userId)]);
    return domain(() =>
      buildRecipe(meal, templates.find((t) => t.id === meal.templateId), indexFoods(foods), {
        level: level ?? plan.level,
        equipment: user.preferences.equipment ?? [],
      }),
    );
  }

  async mealPrep(userId: string, planId: string, fromDay: number, days: number) {
    const doc = await this.load(userId, planId);
    const [user, foods] = await Promise.all([this.catalog.user(userId), this.catalog.foods(userId)]);
    return domain(() => buildMealPrep(toWeekPlan(doc), indexFoods(foods), fromDay, days, { level: 'meal-prep', equipment: user.preferences.equipment ?? [] }));
  }
}
