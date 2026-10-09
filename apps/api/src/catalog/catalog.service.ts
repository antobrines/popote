/**
 * Accès au catalogue (aliments, modèles de repas, magasins, prix) et conversion
 * des documents MongoDB vers les types du cœur métier.
 */
import {
  ChainProductResolver,
  type CustomRecipeInput,
  DEFAULT_AISLE_ORDER,
  type Food,
  type MealTemplate,
  type NutritionTarget,
  type PackageOption,
  type ResolveOutcome,
  SEED_FOODS,
  SEED_TEMPLATES,
  buildCustomTemplate,
  customRecipeId,
  indexFoods,
  normalize,
  pricePerKg,
} from '@bouffe/core';
import { BadRequestException, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { config } from '../config.js';
import {
  type BarcodeDoc,
  type FoodDoc,
  type InventoryItemDoc,
  M,
  type NutritionGoalDoc,
  type PriceHistoryDoc,
  type ProductDoc,
  type RecipeDoc,
  type RetailProductDoc,
  type StoreDoc,
  type UserDoc,
} from '../db/schemas.js';
import { KnownBarcodeResolver, OpenFoodFactsResolver, RetailProviderRegistry, RetailProviderResolver } from './providers.js';

export interface CustomFoodInput {
  /** Identifiant d'un aliment existant dont on remplace les valeurs ; absent pour un nouvel aliment. */
  id?: string;
  name?: string;
  category?: string;
  per100: { kcal: number; protein: number; carbs: number; fat: number; fiber?: number };
  /** Poids d'une pièce (pot, tranche…), si l'aliment se compte à l'unité. */
  pieceGrams?: number;
  /** Marque et nom du produit dont viennent les valeurs. */
  productName?: string;
  packGrams?: number;
  packPrice?: number;
}

const CUSTOM_CATEGORIES = ['viande', 'poisson', 'oeuf', 'charcuterie', 'feculent', 'pain', 'laitier', 'fromage', 'fruit', 'oleagineux', 'matiere-grasse', 'sauce', 'supplement', 'sucrant', 'boisson', 'epice', 'autre'] as const;

const CATEGORY_AISLE: Partial<Record<Food['category'], Food['aisle']>> = {
  viande: 'viandes-poissons',
  poisson: 'viandes-poissons',
  charcuterie: 'viandes-poissons',
  oeuf: 'produits-laitiers',
  laitier: 'produits-laitiers',
  fromage: 'produits-laitiers',
  feculent: 'feculents',
  pain: 'feculents',
  fruit: 'fruits',
  boisson: 'boissons',
  oleagineux: 'epicerie',
  'matiere-grasse': 'epicerie',
  sauce: 'epicerie',
  sucrant: 'epicerie',
  epice: 'epicerie',
};

/** Nombre borné, ou `NaN` si la valeur n'est pas exploitable. */
function num(value: unknown, min: number, max: number): number {
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 100) / 100 : NaN;
}

@Injectable()
export class CatalogService implements OnModuleInit {
  private readonly logger = new Logger(CatalogService.name);
  private templatesCache: { at: number; value: MealTemplate[] } | null = null;
  private sharedFoodsCache: { at: number; value: Food[] } | null = null;

  constructor(
    @InjectModel(M.Food) private readonly foodModel: Model<FoodDoc>,
    @InjectModel(M.Recipe) private readonly recipeModel: Model<RecipeDoc>,
    @InjectModel(M.Store) private readonly storeModel: Model<StoreDoc>,
    @InjectModel(M.User) private readonly userModel: Model<UserDoc>,
    @InjectModel(M.NutritionGoal) private readonly goalModel: Model<NutritionGoalDoc>,
    @InjectModel(M.InventoryItem) private readonly inventoryModel: Model<InventoryItemDoc>,
    @InjectModel(M.RetailProduct) private readonly retailModel: Model<RetailProductDoc>,
    @InjectModel(M.Product) private readonly productModel: Model<ProductDoc>,
    @InjectModel(M.Barcode) private readonly barcodeModel: Model<BarcodeDoc>,
    @InjectModel(M.PriceHistory) private readonly priceModel: Model<PriceHistoryDoc>,
    private readonly providers: RetailProviderRegistry,
  ) {}

  /**
   * Au démarrage. En production, le catalogue commun est aligné sur celui du code déployé : une
   * mise en ligne suffit, sans commande à lancer (les aliments et recettes des utilisateurs ne sont
   * pas touchés). En développement, il n'est installé que s'il manque : `npm run seed` le met à jour.
   */
  async onModuleInit(): Promise<void> {
    const result = await this.seedCatalogue(config.isProd);
    if (result.foods || result.recipes || result.removed) {
      this.logger.log(`Catalogue : ${result.foods} aliment(s) et ${result.recipes} modèle(s) de repas installés ou mis à jour, ${result.removed} modèle(s) retiré(s).`);
    }
  }

  async seedCatalogue(overwrite = false): Promise<{ foods: number; recipes: number; removed: number }> {
    const operator = overwrite ? '$set' : '$setOnInsert';
    // Sans horodatage automatique : un aliment inchangé n'est pas réécrit, et le compte rendu ne
    // signale que ce qui a vraiment changé (sinon chaque démarrage « modifierait » tout le catalogue).
    const foods = await this.foodModel.bulkWrite(
      SEED_FOODS.map(({ id, ...rest }) => ({
        updateOne: { filter: { key: id, userId: null }, update: { [operator]: rest }, upsert: true, timestamps: false },
      })),
    );
    const recipes = await this.recipeModel.bulkWrite(
      SEED_TEMPLATES.map(({ id, ...rest }) => ({
        updateOne: { filter: { key: id, userId: null }, update: { [operator]: rest }, upsert: true, timestamps: false },
      })),
    );
    // Un modèle de repas retiré du code ne doit plus être tiré. (Les aliments, eux, restent : des
    // programmes enregistrés peuvent encore les citer.)
    const removed = overwrite ? (await this.recipeModel.deleteMany({ userId: null, key: { $nin: SEED_TEMPLATES.map((t) => t.id) } })).deletedCount : 0;
    this.sharedFoodsCache = null;
    this.templatesCache = null;
    return { foods: foods.upsertedCount + (overwrite ? foods.modifiedCount : 0), recipes: recipes.upsertedCount + (overwrite ? recipes.modifiedCount : 0), removed };
  }

  // ───────────── Conversions ─────────────

  private toFood(doc: FoodDoc): Food {
    const { key, userId, ...rest } = doc.toObject({ versionKey: false, flattenObjectIds: true }) as unknown as Food & {
      key: string;
      userId: string | null;
      _id?: unknown;
      createdAt?: unknown;
      updatedAt?: unknown;
    };
    delete rest._id;
    delete rest.createdAt;
    delete rest.updatedAt;
    return { ...rest, id: key, custom: !!userId };
  }

  private toTemplate(doc: RecipeDoc): MealTemplate {
    const { key, ...rest } = doc.toObject({ versionKey: false }) as unknown as MealTemplate & {
      key: string;
      _id?: unknown;
      userId?: unknown;
      source?: unknown;
      createdAt?: unknown;
      updatedAt?: unknown;
    };
    delete rest._id;
    delete rest.userId;
    delete rest.source;
    delete rest.createdAt;
    delete rest.updatedAt;
    return { ...rest, id: key };
  }

  // ───────────── Aliments & modèles ─────────────

  /** Catalogue commun + aliments personnalisés de l'utilisateur (qui priment à clé égale). */
  async foods(userId: string): Promise<Food[]> {
    if (!this.sharedFoodsCache || Date.now() - this.sharedFoodsCache.at > 60_000) {
      const docs = await this.foodModel.find({ userId: null });
      this.sharedFoodsCache = { at: Date.now(), value: docs.map((d) => this.toFood(d)) };
    }
    const custom = (await this.foodModel.find({ userId })).map((d) => this.toFood(d));
    const merged = new Map(this.sharedFoodsCache.value.map((f) => [f.id, f]));
    for (const food of custom) merged.set(food.id, food);
    return [...merged.values()];
  }

  /** Modèles de repas du catalogue commun + recettes personnelles de l'utilisateur. */
  async templates(userId: string): Promise<MealTemplate[]> {
    if (!this.templatesCache || Date.now() - this.templatesCache.at > 60_000) {
      const docs = await this.recipeModel.find({ userId: null });
      this.templatesCache = { at: Date.now(), value: docs.map((d) => this.toTemplate(d)) };
    }
    const mine = await this.recipeModel.find({ userId });
    return [...this.templatesCache.value, ...mine.map((d) => this.toTemplate(d))];
  }

  /** Recettes personnelles telles que saisies (pour l'écran d'édition). */
  async customRecipes(userId: string): Promise<(CustomRecipeInput & { id: string })[]> {
    const docs = await this.recipeModel.find({ userId }).sort({ name: 1 });
    return docs.map((d) => ({ ...(d.source as CustomRecipeInput), id: d.key }));
  }

  /** Crée ou modifie une recette personnelle : validée et convertie en modèle par le cœur métier. */
  async saveCustomRecipe(userId: string, input: CustomRecipeInput): Promise<string> {
    const foods = indexFoods(await this.foods(userId));
    // La clé porte un suffixe propre au compte : deux utilisateurs peuvent nommer leur recette pareil.
    const owned = input.id ? await this.recipeModel.findOne({ key: input.id, userId }) : null;
    const key = owned?.key ?? `${customRecipeId(input.name)}-${userId.slice(-6)}`;
    const { id: _id, ...template } = buildCustomTemplate({ ...input, id: key }, foods);
    await this.recipeModel.updateOne({ key, userId }, { $set: { ...template, source: { ...input, id: key } } }, { upsert: true });
    return key;
  }

  async deleteCustomRecipe(userId: string, key: string): Promise<void> {
    await this.recipeModel.deleteOne({ key, userId });
  }

  /**
   * « Mes vrais produits » : remplace les valeurs génériques d'un aliment par celles de l'étiquette
   * (scan ou saisie), ou ajoute un aliment au catalogue personnel. Seuls quelques champs sont
   * modifiables ; tout le reste vient de l'aliment de référence ou de valeurs par défaut sûres.
   */
  async saveCustomFood(userId: string, input: CustomFoodInput): Promise<Food> {
    const per100 = {
      kcal: num(input.per100?.kcal, 0, 950),
      protein: num(input.per100?.protein, 0, 100),
      carbs: num(input.per100?.carbs, 0, 100),
      fat: num(input.per100?.fat, 0, 100),
      fiber: num(input.per100?.fiber ?? 0, 0, 100),
    };
    if ([per100.kcal, per100.protein, per100.carbs, per100.fat].some((v) => Number.isNaN(v))) {
      throw new BadRequestException('Valeurs nutritionnelles incomplètes : calories, protéines, glucides et lipides pour 100 g sont nécessaires.');
    }
    const shared = input.id ? (await this.foods(userId)).find((f) => f.id === input.id) : undefined;
    const name = String(input.name ?? shared?.name ?? '').trim().slice(0, 80);
    if (!name) throw new BadRequestException("Donne un nom à l'aliment.");
    const pieceGrams = input.pieceGrams ? num(input.pieceGrams, 1, 2000) : undefined;

    let food: Food;
    if (shared) {
      // Aliment existant : on ne remplace que ses valeurs (et le poids de la pièce, s'il en a une).
      // Ce ne sont plus celles de la table Ciqual : la référence disparaît.
      const { ciqual: _reference, ...base } = shared;
      food = {
        ...base,
        per100,
        piece: shared.piece && pieceGrams ? { ...shared.piece, grams: pieceGrams } : shared.piece,
        portion:
          shared.piece && pieceGrams
            ? { min: pieceGrams * Math.round(shared.portion.min / shared.piece.grams), max: pieceGrams * Math.round(shared.portion.max / shared.piece.grams), step: pieceGrams }
            : shared.portion,
        productName: input.productName ? String(input.productName).slice(0, 120) : undefined,
      };
    } else {
      const category = (CUSTOM_CATEGORIES as readonly string[]).includes(String(input.category)) ? (input.category as Food['category']) : 'autre';
      const dense = per100.kcal >= 300;
      food = {
        id: `mon-${normalize(name).replace(/[^a-z0-9]+/g, '-').slice(0, 50)}`,
        name,
        shortName: name.toLowerCase(),
        category,
        aisle: CATEGORY_AISLE[category] ?? 'autres',
        per100,
        unit: 'g',
        piece: pieceGrams ? { label: name.toLowerCase(), plural: name.toLowerCase(), grams: pieceGrams } : undefined,
        portable: false,
        noCook: !['viande', 'poisson', 'feculent', 'oeuf'].includes(category),
        portion: pieceGrams ? { min: pieceGrams, max: pieceGrams * 3, step: pieceGrams } : dense ? { min: 10, max: 150, step: 5 } : { min: 50, max: 400, step: 10 },
        perishable: true,
        packages: input.packGrams && input.packPrice !== undefined ? [{ label: `${name} ${Math.round(num(input.packGrams, 1, 20000))} g`, grams: Math.round(num(input.packGrams, 1, 20000)), price: num(input.packPrice, 0, 500), source: 'user' }] : [],
        tags: [],
        keywords: [name.toLowerCase()],
        offCategories: [],
        productName: input.productName ? String(input.productName).slice(0, 120) : undefined,
      };
    }
    const { id, ...rest } = food;
    const doc = await this.foodModel.findOneAndUpdate(
      { key: id, userId },
      { $set: { ...rest, custom: true } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
    return this.toFood(doc!);
  }

  /** Vrai si l'aliment n'existe que chez l'utilisateur (et n'est pas l'ajustement d'un aliment du catalogue). */
  async isOwnFood(userId: string, key: string): Promise<boolean> {
    if (await this.foodModel.exists({ key, userId: null })) return false;
    return !!(await this.foodModel.exists({ key, userId }));
  }

  /** Nom d'une recette personnelle qui utilise cet aliment, s'il y en a une. */
  async recipeUsing(userId: string, key: string): Promise<string | null> {
    const doc = await this.recipeModel.findOne({ userId, 'items.foods': key });
    return doc ? doc.name : null;
  }

  async deleteCustomFood(userId: string, key: string): Promise<void> {
    const own = await this.isOwnFood(userId, key);
    await this.foodModel.deleteOne({ key, userId });
    // Un aliment personnel qui disparaît ne doit pas laisser de stock orphelin.
    if (own) await this.inventoryModel.deleteOne({ userId, foodKey: key });
  }

  // ───────────── Utilisateur, objectif, stocks ─────────────

  async user(userId: string): Promise<UserDoc> {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('Compte introuvable.');
    return user;
  }

  async currentGoal(userId: string): Promise<NutritionGoalDoc | null> {
    return this.goalModel.findOne({ userId, endsAt: null }).sort({ startsAt: -1 });
  }

  async target(userId: string): Promise<NutritionTarget> {
    const goal = await this.currentGoal(userId);
    if (!goal) throw new NotFoundException("Aucun objectif nutritionnel : termine d'abord la configuration du profil.");
    return { kcal: goal.kcal, protein: goal.protein, toleranceKcal: goal.toleranceKcal, fiberGuide: goal.fiberGuide };
  }

  async inventoryMap(userId: string): Promise<Record<string, number>> {
    const items = await this.inventoryModel.find({ userId });
    return Object.fromEntries(items.map((i) => [i.foodKey, i.grams]));
  }

  async setInventory(userId: string, inventory: Record<string, number>): Promise<void> {
    const ops = Object.entries(inventory).map(([foodKey, grams]) =>
      grams > 0
        ? { updateOne: { filter: { userId, foodKey }, update: { $set: { grams: Math.round(grams) } }, upsert: true } }
        : { deleteOne: { filter: { userId, foodKey } } },
    );
    if (ops.length) await this.inventoryModel.bulkWrite(ops as never);
  }

  // ───────────── Magasins & prix ─────────────

  async stores(userId: string): Promise<StoreDoc[]> {
    return this.storeModel.find({ userId }).sort({ createdAt: 1 });
  }

  async store(userId: string, storeId?: string | null): Promise<StoreDoc | null> {
    if (storeId) return this.storeModel.findOne({ _id: storeId, userId });
    const user = await this.user(userId);
    if (user.preferences.storeId) return this.storeModel.findOne({ _id: user.preferences.storeId, userId });
    return this.storeModel.findOne({ userId }).sort({ createdAt: 1 });
  }

  async createStore(userId: string, data: { name: string; chain?: string; city?: string }): Promise<StoreDoc> {
    return this.storeModel.create({ userId, name: data.name, chain: data.chain ?? 'other', city: data.city, aisleOrder: DEFAULT_AISLE_ORDER });
  }

  /**
   * Conditionnements connus par aliment pour un magasin : prix relevés par l'utilisateur.
   * Un conditionnement marqué « préféré » devient le seul proposé pour son aliment.
   * (Les aliments sans prix relevé utilisent les estimations du catalogue.)
   */
  async packages(userId: string, store: StoreDoc | null): Promise<Record<string, PackageOption[]>> {
    if (!store) return {};
    const docs = await this.retailModel.find({ userId, storeId: store._id });
    const result: Record<string, PackageOption[]> = {};
    for (const doc of docs) {
      (result[doc.foodKey] ??= []).push({
        id: doc.id,
        label: doc.label,
        grams: doc.grams,
        price: doc.price,
        variableWeight: doc.variableWeight,
        brand: doc.brand,
        ean: doc.ean,
        productId: doc.productId ? String(doc.productId) : undefined,
        retailProductId: doc.id,
        source: doc.source,
        priceDate: doc.priceDate.toISOString(),
        ...(doc.preferred ? { preferred: true } : {}),
      } as PackageOption);
    }
    for (const [key, options] of Object.entries(result)) {
      const preferred = options.filter((o) => (o as PackageOption & { preferred?: boolean }).preferred);
      if (preferred.length) result[key] = preferred;
    }
    return result;
  }

  /**
   * Mémorise un produit scanné : produit, code-barres, et — quand un prix est donné — prix au
   * magasin et historique de prix. Sans magasin ni prix (scan à la maison), seul le rattachement
   * du code-barres à l'aliment est retenu.
   */
  async learnProduct(
    userId: string,
    store: StoreDoc | null,
    line: { ean?: string; name: string; brand?: string; grams: number; price?: number; foodId?: string; variableWeight?: boolean },
    date: Date,
  ): Promise<void> {
    if (!line.foodId || line.grams <= 0) return;
    let productId: ProductDoc['_id'] | null = null;
    if (line.ean) {
      const barcode = await this.barcodeModel.findOne({ ean: line.ean, userId });
      if (barcode) {
        productId = barcode.productId;
        await this.productModel.updateOne({ _id: productId }, { $set: { foodKey: line.foodId, name: line.name, brand: line.brand, grams: line.grams } });
      } else {
        const product = await this.productModel.create({
          userId,
          foodKey: line.foodId,
          name: line.name,
          brand: line.brand,
          grams: line.grams,
          variableWeight: line.variableWeight,
          source: 'user',
        });
        productId = product._id;
        await this.barcodeModel.create({ ean: line.ean, productId, userId });
      }
    }
    if (line.price === undefined || !store) return;
    const filter = line.ean
      ? { userId, storeId: store._id, ean: line.ean }
      : { userId, storeId: store._id, foodKey: line.foodId, label: line.name, grams: line.grams };
    await this.retailModel.updateOne(
      filter,
      {
        $set: {
          productId,
          foodKey: line.foodId,
          label: line.name,
          brand: line.brand,
          grams: line.grams,
          price: line.price,
          variableWeight: line.variableWeight,
          priceDate: date,
          source: 'user',
        },
      },
      { upsert: true },
    );
    await this.priceModel.create({
      userId,
      storeId: store._id,
      ean: line.ean,
      productId,
      foodKey: line.foodId,
      price: line.price,
      grams: line.grams,
      pricePerKg: pricePerKg(line.price, line.grams),
      date,
      source: 'user',
    });
  }

  /** Résout un code-barres : mes produits → catalogue commun → fournisseur magasin → Open Food Facts. */
  async resolveBarcode(userId: string, ean: string, storeId?: string): Promise<ResolveOutcome> {
    const store = await this.store(userId, storeId);
    const chain = new ChainProductResolver(
      [
        ...(store ? [new RetailProviderResolver(this.providers.for(store), store)] : []),
        new KnownBarcodeResolver('mes-produits', this.barcodeModel, this.productModel, userId),
        new KnownBarcodeResolver('catalogue', this.barcodeModel, this.productModel, null),
        new OpenFoodFactsResolver(),
      ],
      4000,
    );
    return chain.resolveWithTrace(ean);
  }

  /** Tous les codes-barres connus de l'utilisateur, avec leur dernier prix : cache hors ligne du mode Courses. */
  async knownBarcodes(userId: string, store: StoreDoc | null) {
    const barcodes = await this.barcodeModel.find({ userId });
    const products = await this.productModel.find({ _id: { $in: barcodes.map((b) => b.productId) } });
    const retail = store ? await this.retailModel.find({ userId, storeId: store._id }) : [];
    const byId = new Map(products.map((p) => [p.id, p]));
    return barcodes.flatMap((barcode) => {
      const product = byId.get(String(barcode.productId));
      if (!product) return [];
      const price = retail.find((r) => r.ean === barcode.ean);
      return [
        {
          ean: barcode.ean,
          name: product.name,
          brand: product.brand,
          grams: price?.grams ?? product.grams,
          per100: product.per100,
          foodId: product.foodKey,
          variableWeight: product.variableWeight,
          price: price?.price,
          priceDate: price?.priceDate.toISOString(),
          productId: product.id,
          source: 'user' as const,
        },
      ];
    });
  }
}
