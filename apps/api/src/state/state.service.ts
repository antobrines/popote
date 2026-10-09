/**
 * État agrégé de l'application pour un utilisateur.
 *
 * La PWA est « offline-first » : elle charge cet état en une requête, le met en cache dans
 * IndexedDB, et chaque mutation renvoie l'état à jour. Cela garantit que programme, liste de
 * courses, stocks et suivi restent toujours cohérents entre eux.
 */
import { addDays, mondayOf, suggestCalorieAdjustment, summarizeWeight } from '@bouffe/core';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { CatalogService } from '../catalog/catalog.service.js';
import { HEALTH_PROVIDERS, RetailProviderRegistry } from '../catalog/providers.js';
import { config } from '../config.js';
import {
  type ActivityEntryDoc,
  type FoodEntryDoc,
  type InventoryItemDoc,
  M,
  type MealPlanDoc,
  type ShoppingListDoc,
  type WeightEntryDoc,
} from '../db/schemas.js';
import { PlanningService } from '../planning/planning.service.js';
import { ShoppingService } from '../shopping/shopping.service.js';

@Injectable()
export class StateService {
  private readonly logger = new Logger(StateService.name);

  constructor(
    @InjectModel(M.MealPlan) private readonly plans: Model<MealPlanDoc>,
    @InjectModel(M.ShoppingList) private readonly lists: Model<ShoppingListDoc>,
    @InjectModel(M.InventoryItem) private readonly inventory: Model<InventoryItemDoc>,
    @InjectModel(M.FoodEntry) private readonly entries: Model<FoodEntryDoc>,
    @InjectModel(M.WeightEntry) private readonly weights: Model<WeightEntryDoc>,
    @InjectModel(M.ActivityEntry) private readonly activities: Model<ActivityEntryDoc>,
    private readonly catalog: CatalogService,
    private readonly shopping: ShoppingService,
    private readonly planning: PlanningService,
    private readonly providers: RetailProviderRegistry,
  ) {}

  async snapshot(userId: string, today: string, withCatalog = false) {
    // Un catalogue mis à jour ne doit pas laisser un programme calculé avec d'anciennes valeurs.
    await this.planning.syncCatalog(userId, today).catch((error: unknown) => this.logger.warn(`Recalcul après mise à jour du catalogue impossible : ${String(error)}`));
    const weekStart = mondayOf(today);
    const nextWeek = addDays(weekStart, 7);
    const [user, goal, stores, plan, nextPlan, lists, inventory, entries, weights, activities, session, purchases] = await Promise.all([
      this.catalog.user(userId),
      this.catalog.currentGoal(userId),
      this.catalog.stores(userId),
      this.plans.findOne({ userId, weekStart }),
      this.plans.findOne({ userId, weekStart: nextWeek }),
      this.lists.find({ userId, weekStart: { $in: [weekStart, nextWeek] } }),
      this.inventory.find({ userId }).sort({ foodKey: 1 }),
      this.entries.find({ userId, date: { $gte: addDays(weekStart, -7), $lte: addDays(nextWeek, 6) } }).sort({ date: 1, createdAt: 1 }),
      this.weights.find({ userId }).sort({ date: 1 }),
      this.activities.find({ userId, date: { $gte: addDays(today, -30) } }).sort({ date: 1 }),
      this.shopping.activeSession(userId),
      this.shopping.purchaseHistory(userId, 10),
    ]);

    const points = weights.map((w) => ({ date: w.date, kg: w.kg }));
    const profile = user.profile;
    const weightSummary = profile ? summarizeWeight(points, profile.startWeightKg, profile.goalWeightKg, today) : null;
    const calorieSuggestion =
      profile && goal
        ? suggestCalorieAdjustment({
            points,
            today,
            currentKcal: goal.kcal,
            goalKg: profile.goalWeightKg,
            profile: { sex: profile.sex, age: new Date().getFullYear() - profile.birthYear, heightCm: profile.heightCm },
            lastAdjustment: goal.reason === 'onboarding' ? undefined : goal.startsAt.toISOString(),
          })
        : null;

    const openList = lists.find((l) => l.status === 'open');
    const store = await this.catalog.store(userId);
    const [habits, retailProducts, catalogue] = await Promise.all([
      openList ? this.shopping.habitSuggestions(userId, openList.weekStart) : [],
      this.shopping.retailProducts(userId),
      withCatalog ? Promise.all([this.catalog.foods(userId), this.catalog.templates(userId), this.catalog.knownBarcodes(userId, store), this.catalog.customRecipes(userId)]) : null,
    ]);

    return {
      today,
      weekStart,
      user,
      goal,
      stores,
      plan,
      nextPlan,
      shoppingLists: lists,
      inventory: inventory.map((i) => ({ foodId: i.foodKey, grams: i.grams })),
      entries,
      weights,
      weightSummary,
      calorieSuggestion,
      activities,
      activeSession: session,
      purchases,
      habits,
      retailProducts,
      integrations: { retail: this.providers.statuses(), health: HEALTH_PROVIDERS, push: !!config.vapid.publicKey },
      ...(catalogue ? { foods: catalogue[0], templates: catalogue[1], knownBarcodes: catalogue[2], customRecipes: catalogue[3] } : {}),
    };
  }
}
