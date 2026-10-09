/** Formes JSON renvoyées par l'API (voir `StateService.snapshot` côté serveur). */
import type {
  ActivityLevel,
  Aisle,
  AwayMode,
  CalorieSuggestion,
  CustomRecipeInput,
  Food,
  HabitSuggestion,
  MealSlotKind,
  MealTemplate,
  NutritionTarget,
  Nutrients,
  PrepLevel,
  PrepMode,
  PurchaseSummary,
  ScannedProduct,
  Sex,
  ShoppingListData,
  ShoppingSession,
  ShoppingStrategy,
  WeekPlan,
  WeightSummary,
} from '@bouffe/core';

export interface MealFeedback {
  signature: string;
  name: string;
  rating?: number;
  favorite?: boolean;
  banned?: boolean;
}

export interface UserPreferences {
  likedFoods: string[];
  limitedFoods?: string[];
  cookOnce?: boolean;
  awayPrepAhead?: boolean;
  trainingDays?: boolean[];
  trainingBonusKcal?: number;
  excludedFoods: string[];
  excludedTags: string[];
  bannedBrands: string[];
  meals: MealSlotKind[];
  awayDays: AwayMode[];
  level: PrepLevel;
  equipment: PrepMode[];
  storeId?: string | null;
  weeklyBudget?: number | null;
  strategy: ShoppingStrategy;
  weighDay: number;
  reminders?: { weighIn: boolean; mealPrep: boolean };
  mealFeedback: MealFeedback[];
}

export interface UserJson {
  id: string;
  email: string;
  displayName: string;
  profile?: { sex: Sex; birthYear: number; heightCm: number; startWeightKg: number; goalWeightKg: number; activity: ActivityLevel };
  preferences: UserPreferences;
  consents: { healthData: boolean };
  onboardedAt?: string;
}

export interface GoalJson extends NutritionTarget {
  id: string;
  startsAt: string;
  reason: string;
}

export interface StoreJson {
  id: string;
  name: string;
  chain: string;
  city?: string;
  aisleOrder: Aisle[];
}

export interface PlanJson extends WeekPlan {
  id: string;
  generation: number;
}

export interface ShoppingListJson extends ShoppingListData {
  id: string;
  planId: string;
  status: 'open' | 'done';
}

export interface EntryJson {
  id: string;
  date: string;
  slot: MealSlotKind;
  mealId?: string | null;
  planId?: string | null;
  foodKey: string;
  name: string;
  grams: number;
  nutrition: Nutrients;
  source: 'plan' | 'manual';
}

export interface WeightJson {
  date: string;
  kg: number;
  source: string;
}

export interface ActivityJson {
  date: string;
  steps?: number;
  activeKcal?: number;
  sleepMinutes?: number;
  workouts: { kind: string; minutes: number; kcal?: number }[];
  source: string;
}

export interface RetailProductJson {
  id: string;
  foodKey: string;
  label: string;
  brand?: string;
  ean?: string;
  grams: number;
  price: number;
  variableWeight?: boolean;
  priceDate: string;
  preferred?: boolean;
}

export interface ProviderStatus {
  id: string;
  label: string;
  available: boolean;
  official?: boolean;
  example?: boolean;
  explanation: string;
  roadmap?: string[];
}

export interface PurchaseJson extends PurchaseSummary {
  id: string;
}

export interface AppState {
  today: string;
  weekStart: string;
  user: UserJson;
  goal: GoalJson | null;
  stores: StoreJson[];
  plan: PlanJson | null;
  nextPlan: PlanJson | null;
  shoppingLists: ShoppingListJson[];
  inventory: { foodId: string; grams: number }[];
  entries: EntryJson[];
  weights: WeightJson[];
  weightSummary: WeightSummary | null;
  calorieSuggestion: CalorieSuggestion | null;
  activities: ActivityJson[];
  activeSession: (ShoppingSession & { id: string }) | null;
  purchases: PurchaseJson[];
  habits: HabitSuggestion[];
  retailProducts: RetailProductJson[];
  integrations: { retail: ProviderStatus[]; health: ProviderStatus[]; push: boolean };
  foods?: Food[];
  templates?: MealTemplate[];
  knownBarcodes?: ScannedProduct[];
  customRecipes?: (CustomRecipeInput & { id: string })[];
}

export interface OutboxItem {
  id: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  label: string;
  at: string;
}
