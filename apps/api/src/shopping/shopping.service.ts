/**
 * Courses : liste automatique, sessions en magasin, achats, apprentissage des habitudes et stocks.
 */
import {
  type ExtraLine,
  type HabitSuggestion,
  type PurchaseSummary,
  type ScanLine,
  type ShoppingSession,
  type ShoppingStrategy,
  type WeekPlan,
  addDays,
  addToInventory,
  bestPricePerKg,
  buildShoppingList,
  computeHabits,
  finishSession,
  habitSuggestions,
  indexFoods,
  mondayOf,
  weeklyNeeds,
} from '@bouffe/core';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { CatalogService } from '../catalog/catalog.service.js';
import { domain } from '../common/domain.js';
import {
  M,
  type MealPlanDoc,
  type PurchaseDoc,
  type RetailProductDoc,
  type ShoppingListDoc,
  type ShoppingSessionDoc,
} from '../db/schemas.js';

const num = (value: unknown, fallback = 0): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const str = (value: unknown, max = 200): string | undefined => (typeof value === 'string' && value ? value.slice(0, max) : undefined);

function cleanLine(raw: Record<string, unknown>): ScanLine {
  return {
    id: str(raw['id']) ?? '',
    ean: str(raw['ean'], 20),
    name: str(raw['name']) ?? 'Produit',
    brand: str(raw['brand']),
    foodId: str(raw['foodId'], 80),
    grams: Math.max(0, num(raw['grams'])),
    qty: Math.max(0, Math.round(num(raw['qty'], 1))),
    price: typeof raw['price'] === 'number' && raw['price'] >= 0 ? Math.round(raw['price'] * 100) / 100 : undefined,
    priceSource: raw['priceSource'] === 'provider' ? 'provider' : raw['price'] !== undefined ? 'user' : undefined,
    variableWeight: raw['variableWeight'] === true,
    substitution: raw['substitution'] === true,
    at: str(raw['at'], 40) ?? new Date().toISOString(),
  };
}

@Injectable()
export class ShoppingService {
  constructor(
    @InjectModel(M.ShoppingList) private readonly lists: Model<ShoppingListDoc>,
    @InjectModel(M.ShoppingSession) private readonly sessions: Model<ShoppingSessionDoc>,
    @InjectModel(M.Purchase) private readonly purchases: Model<PurchaseDoc>,
    @InjectModel(M.MealPlan) private readonly plans: Model<MealPlanDoc>,
    @InjectModel(M.RetailProduct) private readonly retail: Model<RetailProductDoc>,
    private readonly catalog: CatalogService,
  ) {}

  // ───────────── Liste ─────────────

  /**
   * (Re)calcule la liste de courses d'un programme : besoins − stocks → conditionnements → coûts.
   * Une liste dont les courses sont terminées n'est plus recalculée, sauf demande explicite.
   */
  async refreshList(
    userId: string,
    plan: MealPlanDoc,
    options: { today: string; strategy?: ShoppingStrategy; force?: boolean },
  ): Promise<ShoppingListDoc> {
    const existing = await this.lists.findOne({ userId, weekStart: plan.weekStart });
    if (existing?.status === 'done' && !options.force) return existing;

    const [user, foods, inventory, store] = await Promise.all([
      this.catalog.user(userId),
      this.catalog.foods(userId),
      this.catalog.inventoryMap(userId),
      this.catalog.store(userId),
    ]);
    const packages = await this.catalog.packages(userId, store);
    const strategy = options.strategy ?? existing?.strategy ?? user.preferences.strategy ?? 'cheapest';

    // Liste d'une semaine à venir : les stocks que les repas restants de la semaine en cours
    // vont consommer ne sont plus disponibles pour la suivante.
    if (plan.weekStart > options.today) {
      const earlier = await this.plans.find({ userId, weekStart: { $lt: plan.weekStart, $gte: addDays(mondayOf(options.today), 0) } });
      for (const other of earlier) {
        for (const [foodId, grams] of weeklyNeeds(other.toObject() as unknown as WeekPlan, options.today)) {
          if (inventory[foodId]) inventory[foodId] = Math.max(0, inventory[foodId] - grams);
        }
      }
    }
    const data = domain(() =>
      buildShoppingList({
        plan: plan.toObject() as unknown as WeekPlan,
        foods: indexFoods(foods),
        inventory,
        packages,
        strategy,
        aisleOrder: store?.aisleOrder?.length ? store.aisleOrder : undefined,
        checked: existing?.items.filter((i) => i.checked).map((i) => i.id),
        fromDate: options.today,
      }),
    );
    const list = await this.lists.findOneAndUpdate(
      { userId, weekStart: plan.weekStart },
      { $set: { planId: plan._id, storeId: store?._id ?? null, strategy, items: data.items, totals: data.totals, status: 'open' } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
    return list!;
  }

  async refreshOpenLists(userId: string, today: string): Promise<void> {
    const open = await this.lists.find({ userId, status: 'open' }).sort({ weekStart: -1 }).limit(2);
    for (const list of open) {
      const plan = await this.plans.findOne({ _id: list.planId, userId });
      if (plan) await this.refreshList(userId, plan, { today });
    }
  }

  async listFor(userId: string, weekStart: string): Promise<ShoppingListDoc | null> {
    return this.lists.findOne({ userId, weekStart });
  }

  async setChecked(userId: string, listId: string, itemId: string, checked: boolean): Promise<ShoppingListDoc> {
    const list = await this.lists.findOneAndUpdate(
      { _id: listId, userId, 'items.id': itemId },
      { $set: { 'items.$.checked': checked } },
      { returnDocument: 'after' },
    );
    if (!list) throw new NotFoundException('Article introuvable.');
    return list;
  }

  // ───────────── Prix relevés ─────────────

  async retailProducts(userId: string): Promise<RetailProductDoc[]> {
    const store = await this.catalog.store(userId);
    return store ? this.retail.find({ userId, storeId: store._id }).sort({ foodKey: 1, grams: 1 }) : [];
  }

  async saveRetailProduct(
    userId: string,
    data: { id?: string; foodKey: string; label: string; grams: number; price: number; brand?: string; ean?: string; variableWeight?: boolean; preferred?: boolean },
  ): Promise<RetailProductDoc> {
    const store = await this.catalog.store(userId);
    if (!store) throw new BadRequestException("Sélectionne d'abord un magasin.");
    if (data.preferred) await this.retail.updateMany({ userId, storeId: store._id, foodKey: data.foodKey }, { $set: { preferred: false } });
    const payload = { ...data, userId, storeId: store._id, priceDate: new Date(), source: 'user' as const };
    delete (payload as { id?: string }).id;
    if (data.id) {
      const updated = await this.retail.findOneAndUpdate({ _id: data.id, userId }, { $set: payload }, { returnDocument: 'after' });
      if (!updated) throw new NotFoundException('Produit introuvable.');
      return updated;
    }
    return this.retail.create(payload);
  }

  async deleteRetailProduct(userId: string, id: string): Promise<void> {
    await this.retail.deleteOne({ _id: id, userId });
  }

  // ───────────── Sessions en magasin ─────────────

  private cleanSession(id: string, body: Record<string, unknown>): ShoppingSession {
    const items = Array.isArray(body['items']) ? (body['items'] as Record<string, unknown>[]) : [];
    const extras = Array.isArray(body['extras']) ? (body['extras'] as Record<string, unknown>[]) : [];
    return {
      id,
      listId: str(body['listId']) ?? '',
      weekStart: str(body['weekStart'], 10) ?? '',
      storeId: str(body['storeId']) ?? '',
      storeName: str(body['storeName']) ?? '',
      aisleOrder: (Array.isArray(body['aisleOrder']) ? body['aisleOrder'] : []) as ShoppingSession['aisleOrder'],
      startedAt: str(body['startedAt'], 40) ?? new Date().toISOString(),
      finishedAt: str(body['finishedAt'], 40),
      status: body['status'] === 'finished' ? 'finished' : 'active',
      items: items.slice(0, 300).map((raw) => ({
        id: str(raw['id']) ?? '',
        listItemId: str(raw['listItemId']) ?? '',
        foodId: str(raw['foodId'], 80) ?? '',
        name: str(raw['name']) ?? '',
        aisle: (str(raw['aisle'], 40) ?? 'autres') as ShoppingSession['items'][number]['aisle'],
        unit: raw['unit'] === 'ml' ? 'ml' : 'g',
        pieceGrams: typeof raw['pieceGrams'] === 'number' ? raw['pieceGrams'] : undefined,
        pieceLabel: str(raw['pieceLabel']),
        neededG: Math.max(0, num(raw['neededG'])),
        planned: (Array.isArray(raw['planned']) ? raw['planned'] : []) as ShoppingSession['items'][number]['planned'],
        plannedCost: Math.max(0, num(raw['plannedCost'])),
        scans: (Array.isArray(raw['scans']) ? (raw['scans'] as Record<string, unknown>[]) : []).slice(0, 100).map(cleanLine),
        manualDone: raw['manualDone'] === true,
      })),
      extras: extras.slice(0, 200).map((raw) => ({ ...cleanLine(raw), destination: raw['destination'] === 'stock' ? 'stock' : 'cart' }) as ExtraLine),
      plannedTotal: Math.max(0, num(body['plannedTotal'])),
      updatedAt: str(body['updatedAt'], 40) ?? new Date().toISOString(),
    };
  }

  private async assertOwner(userId: string, sessionId: string): Promise<ShoppingSessionDoc | null> {
    if (!/^[\w-]{8,64}$/.test(sessionId)) throw new BadRequestException('Identifiant de session invalide.');
    const existing = await this.sessions.findById(sessionId);
    if (existing && String(existing.userId) !== userId) throw new ForbiddenException();
    return existing;
  }

  /** Synchronisation idempotente d'une session créée (éventuellement hors ligne) par la PWA. */
  async upsertSession(userId: string, sessionId: string, body: Record<string, unknown>): Promise<ShoppingSessionDoc> {
    const existing = await this.assertOwner(userId, sessionId);
    if (existing?.status === 'finished') return existing;
    const { id: _id, ...session } = this.cleanSession(sessionId, body);
    const saved = await this.sessions.findOneAndUpdate(
      { _id: sessionId },
      { $set: { ...session, userId } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
    return saved!;
  }

  /**
   * « Terminer mes courses » : enregistre le panier réel, compare prévu / réel, ajoute les achats
   * aux stocks, mémorise produits et prix scannés, et signale les articles manquants. Idempotent.
   */
  async finish(userId: string, sessionId: string, body: Record<string, unknown>, today: string): Promise<PurchaseDoc> {
    await this.assertOwner(userId, sessionId);
    const already = await this.purchases.findOne({ userId, sessionId });
    if (already) return already;

    const now = new Date();
    const { session, purchase } = domain(() => finishSession(this.cleanSession(sessionId, body), now.toISOString()));
    const { id: _id, ...rest } = session;
    await this.sessions.findOneAndUpdate({ _id: sessionId }, { $set: { ...rest, userId } }, { upsert: true });
    const saved = await this.purchases.create({ ...purchase, userId });

    // Stocks : + achats.
    const inventory = await this.catalog.inventoryMap(userId);
    const { changes } = addToInventory(inventory, purchase.inventoryAdds);
    await this.catalog.setInventory(userId, Object.fromEntries(changes.map((c) => [c.foodId, c.grams])));

    // Apprentissage : code-barres → magasin → prix → date.
    const store = await this.catalog.store(userId, /^[a-f0-9]{24}$/.test(session.storeId) ? session.storeId : null);
    if (store) {
      for (const item of purchase.items) {
        if (item.ean || item.price !== undefined) {
          await this.catalog.learnProduct(userId, store, { ...item, foodId: item.foodId }, now);
        }
      }
    }

    // La liste est clôturée : les articles achetés sont cochés.
    const list = /^[a-f0-9]{24}$/.test(session.listId) ? await this.lists.findOne({ _id: session.listId, userId }) : null;
    if (list) {
      const missing = new Set(purchase.missing.map((m) => m.foodId));
      for (const item of list.items) item.checked = !missing.has(item.foodId);
      list.status = 'done';
      list.markModified('items');
      await list.save();
    }
    void today;
    return saved;
  }

  async activeSession(userId: string): Promise<ShoppingSessionDoc | null> {
    return this.sessions.findOne({ userId, status: 'active' }).sort({ updatedAt: -1 });
  }

  async purchaseHistory(userId: string, limit = 20): Promise<PurchaseDoc[]> {
    return this.purchases.find({ userId }).sort({ date: -1 }).limit(limit);
  }

  // ───────────── Habitudes ─────────────

  async habitSuggestions(userId: string, weekStart: string): Promise<HabitSuggestion[]> {
    const [history, list, foods] = await Promise.all([
      this.purchases.find({ userId }).sort({ date: -1 }).limit(12),
      this.lists.findOne({ userId, weekStart, status: 'open' }),
      this.catalog.foods(userId),
    ]);
    if (!list || history.length === 0) return [];
    const habits = computeHabits(history.map((p) => p.toObject() as unknown as PurchaseSummary));
    return habitSuggestions(list.toObject() as never, habits, indexFoods(foods));
  }

  /** Adopte le conditionnement habituel proposé (toujours après validation explicite de l'utilisateur). */
  async applyHabit(userId: string, data: { foodId: string; packGrams: number; brand?: string; price?: number }, today: string): Promise<void> {
    const foods = await this.catalog.foods(userId);
    const food = foods.find((f) => f.id === data.foodId);
    if (!food) throw new NotFoundException('Aliment inconnu.');
    const perKg = bestPricePerKg(food.packages) ?? 0;
    await this.saveRetailProduct(userId, {
      foodKey: food.id,
      label: `${food.name} ${data.packGrams} ${food.unit}${data.brand ? ` — ${data.brand}` : ''}`,
      grams: data.packGrams,
      price: data.price ?? Math.round(((perKg * data.packGrams) / 1000) * 100) / 100,
      brand: data.brand,
      preferred: true,
    });
    await this.refreshOpenLists(userId, today);
  }
}
