/**
 * Schéma MongoDB (Mongoose).
 *
 * Collections : users, nutritiongoals, foods, recipes, stores, products, barcodes, retailproducts,
 * pricehistories, mealplans, foodentries, weightentries, activityentries, shoppinglists,
 * shoppingsessions, purchases, inventoryitems, refreshtokens, pushsubscriptions.
 *
 * Agrégats embarqués (toujours lus et écrits avec leur parent) :
 *   MealPlan ⊃ MealPlanDay ⊃ Meal ⊃ MealItem · ShoppingList ⊃ ShoppingListItem
 *   ShoppingSession ⊃ ShoppingSessionItem · Purchase ⊃ PurchaseItem · User ⊃ UserPreferences
 *
 * Séparation produit :
 *   Food          = aliment générique et ses valeurs nutritionnelles
 *   Product       = produit concret d'une marque (identifié par un ou plusieurs Barcode)
 *   RetailProduct = ce produit vendu dans un magasin donné, avec prix et conditionnement
 */
import type {
  ActivityLevel,
  Aisle,
  AwayMode,
  Food,
  MealPlanDay,
  MealSlotKind,
  MealStyle,
  MealTemplate,
  NutritionTarget,
  Nutrients,
  PrepLevel,
  PrepMode,
  PriceSource,
  PurchaseSummary,
  Sex,
  ShoppingListItem,
  ShoppingSession,
  ShoppingStrategy,
  ShoppingTotals,
  WeekPlan,
} from '@bouffe/core';
import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { type HydratedDocument, Schema, type Types } from 'mongoose';

const { ObjectId, Mixed } = Schema.Types;

/** Options communes : horodatage + sérialisation JSON avec `id` (sans `_id`, `__v` ni secrets). */
function top(definition: Record<string, unknown>, hidden: string[] = []): Schema {
  const schema = new Schema(definition as never, { timestamps: true });
  schema.set('toJSON', {
    versionKey: false,
    transform: (_doc, ret: Record<string, unknown>) => {
      ret['id'] = String(ret['_id']);
      delete ret['_id'];
      for (const key of hidden) delete ret[key];
      return ret;
    },
  });
  return schema;
}

const sub = (definition: Record<string, unknown>) => new Schema(definition as never, { _id: false });

const nutrients = sub({
  kcal: { type: Number, required: true },
  protein: { type: Number, required: true },
  carbs: { type: Number, required: true },
  fat: { type: Number, required: true },
  fiber: { type: Number, default: 0 },
});

// ───────────────────────────── Utilisateur ─────────────────────────────

export interface UserProfile {
  sex: Sex;
  /** Année de naissance seulement (minimisation des données). */
  birthYear: number;
  heightCm: number;
  startWeightKg: number;
  goalWeightKg: number;
  activity: ActivityLevel;
}

export interface MealFeedback {
  signature: string;
  name: string;
  rating?: number;
  favorite?: boolean;
  banned?: boolean;
}

export interface UserPreferences {
  likedFoods: string[];
  /** Aliments à ne proposer que rarement. */
  limitedFoods?: string[];
  /** Le dîner est cuisiné en double et sert de déjeuner le lendemain. */
  cookOnce?: boolean;
  /** Hors domicile, accepter des repas froids cuisinés la veille. */
  awayPrepAhead?: boolean;
  /** Style des repas à la maison : `simple` (assiettes sans recette, par défaut) ou `cuisine`. */
  style?: MealStyle;
  /** Jours d'entraînement (lundi → dimanche) et calories ajoutées ces jours-là. */
  trainingDays?: boolean[];
  trainingBonusKcal?: number;
  excludedFoods: string[];
  excludedTags: string[];
  bannedBrands: string[];
  meals: MealSlotKind[];
  awayDays: AwayMode[];
  level: PrepLevel;
  equipment: PrepMode[];
  storeId?: Types.ObjectId | null;
  weeklyBudget?: number | null;
  strategy: ShoppingStrategy;
  /** Jour de pesée (0 = lundi). */
  weighDay: number;
  reminders: { weighIn: boolean; mealPrep: boolean };
  mealFeedback: MealFeedback[];
}

export interface User {
  email: string;
  passwordHash: string;
  displayName: string;
  profile?: UserProfile;
  preferences: UserPreferences;
  consents: { healthData: boolean; healthDataAt?: Date };
  onboardedAt?: Date;
  createdAt: Date;
}
export type UserDoc = HydratedDocument<User>;

const UserSchema = top(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    displayName: { type: String, default: '' },
    profile: sub({
      sex: { type: String, enum: ['male', 'female'] },
      birthYear: Number,
      heightCm: Number,
      startWeightKg: Number,
      goalWeightKg: Number,
      activity: { type: String, enum: ['sedentary', 'light', 'moderate', 'active'] },
    }),
    preferences: sub({
      likedFoods: { type: [String], default: [] },
      limitedFoods: { type: [String], default: [] },
      cookOnce: { type: Boolean, default: false },
      awayPrepAhead: { type: Boolean, default: false },
      style: { type: String, enum: ['simple', 'cuisine'], default: 'simple' },
      trainingDays: { type: [Boolean], default: () => Array(7).fill(false) },
      trainingBonusKcal: { type: Number, default: 200 },
      excludedFoods: { type: [String], default: [] },
      excludedTags: { type: [String], default: [] },
      bannedBrands: { type: [String], default: [] },
      meals: { type: [String], default: ['dejeuner', 'collation', 'diner'] },
      awayDays: { type: [String], default: () => Array(7).fill('none') },
      level: { type: String, default: 'normal' },
      equipment: { type: [String], default: [] },
      storeId: { type: ObjectId, ref: 'Store', default: null },
      weeklyBudget: { type: Number, default: null },
      strategy: { type: String, default: 'cheapest' },
      weighDay: { type: Number, default: 0 },
      reminders: sub({ weighIn: { type: Boolean, default: false }, mealPrep: { type: Boolean, default: false } }),
      mealFeedback: {
        type: [sub({ signature: String, name: String, rating: Number, favorite: Boolean, banned: Boolean })],
        default: [],
      },
    }),
    consents: sub({ healthData: { type: Boolean, default: false }, healthDataAt: Date }),
    onboardedAt: Date,
  },
  ['passwordHash'],
);

export interface NutritionGoal extends NutritionTarget {
  userId: Types.ObjectId;
  startsAt: Date;
  endsAt?: Date | null;
  reason: 'onboarding' | 'manual' | 'suggestion';
}
export type NutritionGoalDoc = HydratedDocument<NutritionGoal>;

/** Historisé : un changement de budget crée un nouvel objectif et clôt le précédent. */
const NutritionGoalSchema = top({
  userId: { type: ObjectId, ref: 'User', required: true, index: true },
  kcal: { type: Number, required: true },
  protein: { type: Number, required: true },
  toleranceKcal: { type: Number, default: 50 },
  fiberGuide: { type: Number, default: 25 },
  startsAt: { type: Date, required: true },
  endsAt: { type: Date, default: null },
  reason: { type: String, enum: ['onboarding', 'manual', 'suggestion'], default: 'manual' },
});

export interface RefreshToken {
  userId: Types.ObjectId;
  tokenHash: string;
  family: string;
  expiresAt: Date;
  revokedAt?: Date | null;
  userAgent?: string;
}
export type RefreshTokenDoc = HydratedDocument<RefreshToken>;

const RefreshTokenSchema = top({
  userId: { type: ObjectId, ref: 'User', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  family: { type: String, required: true, index: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  revokedAt: { type: Date, default: null },
  userAgent: String,
});

// ───────────────────────────── Catalogue ─────────────────────────────

export interface FoodRecord extends Omit<Food, 'id'> {
  key: string;
  /** `null` = aliment du catalogue commun ; sinon aliment personnalisé de l'utilisateur. */
  userId: Types.ObjectId | null;
}
export type FoodDoc = HydratedDocument<FoodRecord>;

const packageOption = sub({
  label: String,
  grams: Number,
  price: Number,
  variableWeight: Boolean,
  brand: String,
  ean: String,
  source: { type: String, default: 'estimate' },
  priceDate: String,
});

const FoodSchema = top({
  key: { type: String, required: true },
  userId: { type: ObjectId, ref: 'User', default: null },
  name: { type: String, required: true },
  shortName: String,
  category: { type: String, required: true },
  aisle: { type: String, required: true },
  per100: { type: nutrients, required: true },
  unit: { type: String, enum: ['g', 'ml'], default: 'g' },
  piece: sub({ label: String, plural: String, grams: Number }),
  cookedYield: Number,
  portable: { type: Boolean, default: false },
  noCook: { type: Boolean, default: false },
  portion: sub({ min: Number, max: Number, step: Number }),
  cooking: [sub({ mode: String, minutes: Number, text: String })],
  perishable: { type: Boolean, default: true },
  packages: [packageOption],
  tags: [String],
  keywords: [String],
  offCategories: [String],
  substitutionGroup: String,
  measure: sub({ label: String, grams: Number }),
  custom: Boolean,
  productName: String,
  rawLabel: String,
  byWeight: Boolean,
  ciqual: sub({ code: String, label: String, energyComputed: Boolean, note: String }),
});
FoodSchema.index({ userId: 1, key: 1 }, { unique: true });

export interface RecipeRecord extends Omit<MealTemplate, 'id'> {
  key: string;
  /** `null` = recette du catalogue commun ; sinon recette personnelle de l'utilisateur. */
  userId: Types.ObjectId | null;
  /** Saisie d'origine d'une recette personnelle, pour pouvoir la modifier. */
  source?: unknown;
}
export type RecipeDoc = HydratedDocument<RecipeRecord>;

/** Recipe = modèle de repas : règles de composition + étapes de préparation. */
const RecipeSchema = top({
  key: { type: String, required: true, unique: true },
  userId: { type: ObjectId, ref: 'User', default: null, index: true },
  custom: Boolean,
  prepAhead: Boolean,
  // Sans valeur par défaut : un tableau vide ne voudrait pas dire « style cuisiné ».
  styles: { type: [String], default: undefined },
  source: Mixed,
  name: { type: String, required: true },
  kind: String,
  slots: [String],
  context: String,
  items: [
    sub({
      key: String,
      foods: [String],
      scaling: String,
      grams: Number,
      pieces: Number,
      min: Number,
      max: Number,
      step: Number,
      optional: Boolean,
      chance: Number,
      pick: String,
      when: sub({ slot: String, in: [String] }),
    }),
  ],
  methods: [String],
  levels: [String],
  prepMin: Number,
  cookMin: Number,
  steps: [String],
  batchFriendly: Boolean,
  weight: Number,
});

export interface Store {
  userId: Types.ObjectId;
  name: string;
  chain: string;
  city?: string;
  /** Identifiant du magasin chez un fournisseur officiel, le jour où une API existe. */
  externalId?: string;
  aisleOrder: Aisle[];
}
export type StoreDoc = HydratedDocument<Store>;

const StoreSchema = top({
  userId: { type: ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true },
  chain: { type: String, default: 'other' },
  city: String,
  externalId: String,
  aisleOrder: { type: [String], default: [] },
});

export interface Product {
  userId: Types.ObjectId | null;
  foodKey?: string;
  name: string;
  brand?: string;
  grams?: number;
  per100?: Partial<Nutrients>;
  variableWeight?: boolean;
  categories?: string[];
  imageUrl?: string;
  source: string;
}
export type ProductDoc = HydratedDocument<Product>;

const ProductSchema = top({
  userId: { type: ObjectId, ref: 'User', default: null, index: true },
  foodKey: { type: String, index: true },
  name: { type: String, required: true },
  brand: String,
  grams: Number,
  per100: Mixed,
  variableWeight: Boolean,
  categories: [String],
  imageUrl: String,
  source: { type: String, default: 'user' },
});

export interface Barcode {
  ean: string;
  productId: Types.ObjectId;
  userId: Types.ObjectId | null;
}
export type BarcodeDoc = HydratedDocument<Barcode>;

/** Un produit peut porter plusieurs codes-barres (formats, lots, changements d'emballage). */
const BarcodeSchema = top({
  ean: { type: String, required: true },
  productId: { type: ObjectId, ref: 'Product', required: true, index: true },
  userId: { type: ObjectId, ref: 'User', default: null },
});
BarcodeSchema.index({ ean: 1, userId: 1 }, { unique: true });

export interface RetailProduct {
  userId: Types.ObjectId;
  storeId: Types.ObjectId;
  productId?: Types.ObjectId | null;
  foodKey: string;
  label: string;
  brand?: string;
  ean?: string;
  grams: number;
  price: number;
  variableWeight?: boolean;
  priceDate: Date;
  source: PriceSource;
  /** Conditionnement à privilégier dans la liste (habitude confirmée par l'utilisateur). */
  preferred?: boolean;
}
export type RetailProductDoc = HydratedDocument<RetailProduct>;

const RetailProductSchema = top({
  userId: { type: ObjectId, ref: 'User', required: true },
  storeId: { type: ObjectId, ref: 'Store', required: true },
  productId: { type: ObjectId, ref: 'Product', default: null },
  foodKey: { type: String, required: true },
  label: { type: String, required: true },
  brand: String,
  ean: String,
  grams: { type: Number, required: true },
  price: { type: Number, required: true },
  variableWeight: Boolean,
  priceDate: { type: Date, required: true },
  source: { type: String, default: 'user' },
  preferred: Boolean,
});
RetailProductSchema.index({ userId: 1, storeId: 1, foodKey: 1 });

export interface PriceHistory {
  userId: Types.ObjectId;
  storeId: Types.ObjectId;
  ean?: string;
  productId?: Types.ObjectId | null;
  foodKey?: string;
  price: number;
  grams: number;
  pricePerKg: number;
  date: Date;
  source: PriceSource;
}
export type PriceHistoryDoc = HydratedDocument<PriceHistory>;

/** code-barres → magasin → prix → date. */
const PriceHistorySchema = top({
  userId: { type: ObjectId, ref: 'User', required: true },
  storeId: { type: ObjectId, ref: 'Store', required: true },
  ean: String,
  productId: { type: ObjectId, ref: 'Product', default: null },
  foodKey: String,
  price: { type: Number, required: true },
  grams: { type: Number, required: true },
  pricePerKg: Number,
  date: { type: Date, required: true },
  source: { type: String, default: 'user' },
});
PriceHistorySchema.index({ userId: 1, ean: 1, storeId: 1, date: -1 });

// ───────────────────────────── Programme ─────────────────────────────

const mealItem = sub({
  slotKey: { type: String, required: true },
  foodId: { type: String, required: true },
  grams: { type: Number, required: true },
  scaling: { type: String, enum: ['protein', 'energy', 'fixed'], required: true },
  min: Number,
  max: Number,
  step: Number,
});

const meal = sub({
  id: { type: String, required: true },
  slot: { type: String, required: true },
  templateId: String,
  name: String,
  signature: String,
  context: { type: String, enum: ['home', 'away'], default: 'home' },
  items: [mealItem],
  nutrition: nutrients,
  status: { type: String, enum: ['planned', 'eaten', 'partial', 'replaced', 'skipped'], default: 'planned' },
  swapped: Boolean,
  rejectedSignatures: { type: [String], default: undefined },
  locked: Boolean,
  free: sub({ kcal: Number, protein: Number, label: String }),
});

const mealPlanDay = sub({
  index: Number,
  date: String,
  away: { type: String, enum: ['none', 'lunch', 'full'], default: 'none' },
  meals: [meal],
  nutrition: nutrients,
  training: Boolean,
  baseKcal: Number,
  spreadKcal: Number,
});

export interface MealPlan extends WeekPlan {
  userId: Types.ObjectId;
  days: MealPlanDay[];
  generation: number;
}
export type MealPlanDoc = HydratedDocument<MealPlan>;

const MealPlanSchema = top({
  userId: { type: ObjectId, ref: 'User', required: true },
  weekStart: { type: String, required: true },
  seed: Number,
  level: String,
  target: sub({ kcal: Number, protein: Number, toleranceKcal: Number, fiberGuide: Number }),
  structure: [sub({ slot: String, share: Number })],
  days: [mealPlanDay],
  averages: nutrients,
  warnings: [sub({ code: String, severity: String, message: String, days: { type: [Number], default: undefined } })],
  generation: { type: Number, default: 1 },
  /** Style de la semaine (`simple` ou `cuisine`) ; absent sur les semaines d'avant ce choix. */
  style: String,
  /** Version du catalogue avec laquelle les quantités ont été calculées (voir `CATALOG_VERSION`). */
  catalogVersion: String,
});
MealPlanSchema.index({ userId: 1, weekStart: 1 }, { unique: true });

// ───────────────────────────── Suivi ─────────────────────────────

export interface FoodEntry {
  userId: Types.ObjectId;
  date: string;
  slot: MealSlotKind;
  planId?: Types.ObjectId | null;
  mealId?: string | null;
  foodKey: string;
  name: string;
  grams: number;
  /** Instantané des valeurs au moment de la saisie : l'historique reste stable. */
  nutrition: Nutrients;
  source: 'plan' | 'manual';
}
export type FoodEntryDoc = HydratedDocument<FoodEntry>;

/** Ce qui a RÉELLEMENT été mangé (le programme, lui, reste le « prévu »). */
const FoodEntrySchema = top({
  userId: { type: ObjectId, ref: 'User', required: true },
  date: { type: String, required: true },
  slot: { type: String, required: true },
  planId: { type: ObjectId, ref: 'MealPlan', default: null },
  mealId: { type: String, default: null },
  foodKey: { type: String, required: true },
  name: String,
  grams: { type: Number, required: true },
  nutrition: { type: nutrients, required: true },
  source: { type: String, enum: ['plan', 'manual'], default: 'plan' },
});
FoodEntrySchema.index({ userId: 1, date: 1 });

export interface WeightEntry {
  userId: Types.ObjectId;
  date: string;
  kg: number;
  source: string;
}
export type WeightEntryDoc = HydratedDocument<WeightEntry>;

const WeightEntrySchema = top({
  userId: { type: ObjectId, ref: 'User', required: true },
  date: { type: String, required: true },
  kg: { type: Number, required: true, min: 20, max: 400 },
  source: { type: String, default: 'manual' },
});
WeightEntrySchema.index({ userId: 1, date: 1 }, { unique: true });

export interface ActivityEntry {
  userId: Types.ObjectId;
  date: string;
  steps?: number;
  activeKcal?: number;
  sleepMinutes?: number;
  workouts: { kind: string; minutes: number; kcal?: number }[];
  /** `manual`, ou plus tard `health-connect` via l'application Android. */
  source: string;
}
export type ActivityEntryDoc = HydratedDocument<ActivityEntry>;

const ActivityEntrySchema = top({
  userId: { type: ObjectId, ref: 'User', required: true },
  date: { type: String, required: true },
  steps: Number,
  activeKcal: Number,
  sleepMinutes: Number,
  workouts: { type: [sub({ kind: String, minutes: Number, kcal: Number })], default: [] },
  source: { type: String, default: 'manual' },
});
ActivityEntrySchema.index({ userId: 1, date: 1, source: 1 }, { unique: true });

// ───────────────────────────── Courses & stocks ─────────────────────────────

const packageChoice = sub({
  label: String,
  grams: Number,
  price: Number,
  count: Number,
  variableWeight: Boolean,
  brand: String,
  ean: String,
  productId: String,
  retailProductId: String,
  source: String,
  priceDate: String,
});

const shoppingListItem = sub({
  id: { type: String, required: true },
  foodId: { type: String, required: true },
  name: String,
  aisle: String,
  unit: String,
  pieceGrams: Number,
  pieceLabel: String,
  neededG: Number,
  fromStockG: Number,
  toBuyG: Number,
  packages: [packageChoice],
  boughtG: Number,
  leftoverG: Number,
  pricePerKg: Number,
  cost: Number,
  priceSource: String,
  priceDate: String,
  checked: { type: Boolean, default: false },
});

export interface ShoppingList {
  userId: Types.ObjectId;
  planId: Types.ObjectId;
  storeId?: Types.ObjectId | null;
  weekStart: string;
  strategy: ShoppingStrategy;
  items: ShoppingListItem[];
  totals: ShoppingTotals;
  status: 'open' | 'done';
}
export type ShoppingListDoc = HydratedDocument<ShoppingList>;

const ShoppingListSchema = top({
  userId: { type: ObjectId, ref: 'User', required: true },
  planId: { type: ObjectId, ref: 'MealPlan', required: true },
  storeId: { type: ObjectId, ref: 'Store', default: null },
  weekStart: { type: String, required: true },
  strategy: { type: String, default: 'cheapest' },
  items: [shoppingListItem],
  totals: sub({
    cost: Number,
    perDay: Number,
    perMeal: Number,
    consumedCost: Number,
    itemsToBuy: Number,
    itemsInStock: Number,
    estimatedShare: Number,
  }),
  status: { type: String, enum: ['open', 'done'], default: 'open' },
});
ShoppingListSchema.index({ userId: 1, weekStart: 1 }, { unique: true });

const scanLine = {
  id: String,
  ean: String,
  name: String,
  brand: String,
  foodId: String,
  grams: Number,
  qty: Number,
  price: Number,
  priceSource: String,
  variableWeight: Boolean,
  substitution: Boolean,
  at: String,
};

export interface ShoppingSessionRecord extends Omit<ShoppingSession, 'id'> {
  _id: string;
  userId: Types.ObjectId;
}
export type ShoppingSessionDoc = HydratedDocument<ShoppingSessionRecord>;

/** L'identifiant est généré par la PWA (UUID) : la session naît hors connexion puis se synchronise. */
const ShoppingSessionSchema = top({
  _id: { type: String, required: true },
  userId: { type: ObjectId, ref: 'User', required: true, index: true },
  listId: String,
  weekStart: String,
  storeId: String,
  storeName: String,
  aisleOrder: [String],
  startedAt: String,
  finishedAt: String,
  status: { type: String, enum: ['active', 'finished'], default: 'active' },
  items: [
    sub({
      id: String,
      listItemId: String,
      foodId: String,
      name: String,
      aisle: String,
      unit: String,
      pieceGrams: Number,
      pieceLabel: String,
      neededG: Number,
      // Produit initialement prévu…
      planned: [packageChoice],
      plannedCost: Number,
      // …et produits réellement achetés : permet de comparer les substitutions.
      scans: [sub(scanLine)],
      manualDone: Boolean,
    }),
  ],
  extras: [sub({ ...scanLine, destination: { type: String, enum: ['cart', 'stock'] } })],
  plannedTotal: Number,
});

export interface Purchase extends PurchaseSummary {
  userId: Types.ObjectId;
}
export type PurchaseDoc = HydratedDocument<Purchase>;

const PurchaseSchema = top({
  userId: { type: ObjectId, ref: 'User', required: true, index: true },
  sessionId: { type: String, required: true, unique: true },
  listId: String,
  storeId: String,
  weekStart: String,
  date: String,
  items: [
    sub({
      foodId: String,
      name: String,
      brand: String,
      ean: String,
      grams: Number,
      qty: Number,
      price: Number,
      plannedLabel: String,
      plannedGrams: Number,
      substitution: Boolean,
      unplanned: Boolean,
      toStock: Boolean,
    }),
  ],
  plannedTotal: Number,
  actualTotal: Number,
  plannedBought: Number,
  actualOnList: Number,
  saving: Number,
  itemsPlanned: Number,
  itemsBought: Number,
  missing: [sub({ foodId: String, name: String, missingG: Number })],
  inventoryAdds: [sub({ foodId: String, grams: Number })],
  priceObservations: [sub({ ean: String, price: Number, grams: Number, date: String })],
});

export interface InventoryItem {
  userId: Types.ObjectId;
  foodKey: string;
  grams: number;
}
export type InventoryItemDoc = HydratedDocument<InventoryItem>;

const InventoryItemSchema = top({
  userId: { type: ObjectId, ref: 'User', required: true },
  foodKey: { type: String, required: true },
  grams: { type: Number, required: true, min: 0 },
});
InventoryItemSchema.index({ userId: 1, foodKey: 1 }, { unique: true });

export interface PushSubscriptionRecord {
  userId: Types.ObjectId;
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
export type PushSubscriptionDoc = HydratedDocument<PushSubscriptionRecord>;

const PushSubscriptionSchema = top({
  userId: { type: ObjectId, ref: 'User', required: true, index: true },
  endpoint: { type: String, required: true, unique: true },
  keys: sub({ p256dh: String, auth: String }),
});

// ───────────────────────────── Enregistrement ─────────────────────────────

export const M = {
  User: 'User',
  NutritionGoal: 'NutritionGoal',
  RefreshToken: 'RefreshToken',
  Food: 'Food',
  Recipe: 'Recipe',
  Store: 'Store',
  Product: 'Product',
  Barcode: 'Barcode',
  RetailProduct: 'RetailProduct',
  PriceHistory: 'PriceHistory',
  MealPlan: 'MealPlan',
  FoodEntry: 'FoodEntry',
  WeightEntry: 'WeightEntry',
  ActivityEntry: 'ActivityEntry',
  ShoppingList: 'ShoppingList',
  ShoppingSession: 'ShoppingSession',
  Purchase: 'Purchase',
  InventoryItem: 'InventoryItem',
  PushSubscription: 'PushSubscription',
} as const;

const models = MongooseModule.forFeature([
  { name: M.User, schema: UserSchema },
  { name: M.NutritionGoal, schema: NutritionGoalSchema },
  { name: M.RefreshToken, schema: RefreshTokenSchema },
  { name: M.Food, schema: FoodSchema },
  { name: M.Recipe, schema: RecipeSchema },
  { name: M.Store, schema: StoreSchema },
  { name: M.Product, schema: ProductSchema },
  { name: M.Barcode, schema: BarcodeSchema },
  { name: M.RetailProduct, schema: RetailProductSchema },
  { name: M.PriceHistory, schema: PriceHistorySchema },
  { name: M.MealPlan, schema: MealPlanSchema },
  { name: M.FoodEntry, schema: FoodEntrySchema },
  { name: M.WeightEntry, schema: WeightEntrySchema },
  { name: M.ActivityEntry, schema: ActivityEntrySchema },
  { name: M.ShoppingList, schema: ShoppingListSchema },
  { name: M.ShoppingSession, schema: ShoppingSessionSchema },
  { name: M.Purchase, schema: PurchaseSchema },
  { name: M.InventoryItem, schema: InventoryItemSchema },
  { name: M.PushSubscription, schema: PushSubscriptionSchema },
]);

@Global()
@Module({ imports: [models], exports: [models] })
export class DatabaseModule {}
