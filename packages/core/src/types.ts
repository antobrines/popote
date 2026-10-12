/**
 * Types du domaine partagés par l'API (NestJS) et la PWA (Angular).
 * Aucun type ici ne dépend de Node, du DOM ou de MongoDB.
 */

// ───────────────────────────── Nutrition ─────────────────────────────

export interface Nutrients {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
}

export type Sex = 'male' | 'female';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active';

// ───────────────────────────── Aliments ─────────────────────────────

export type Aisle =
  | 'viandes-poissons'
  | 'feculents'
  | 'produits-laitiers'
  | 'fruits'
  | 'epicerie'
  | 'surgeles'
  | 'boissons'
  | 'autres';

export type FoodCategory =
  | 'viande'
  | 'poisson'
  | 'oeuf'
  | 'charcuterie'
  | 'feculent'
  | 'pain'
  | 'laitier'
  | 'fromage'
  | 'fruit'
  | 'oleagineux'
  | 'matiere-grasse'
  | 'sauce'
  | 'supplement'
  | 'sucrant'
  | 'legume'
  | 'boisson'
  | 'epice'
  | 'autre';

export type PrepMode =
  | 'air-fryer'
  | 'poele'
  | 'four'
  | 'rice-cooker'
  | 'casserole'
  | 'one-pot'
  | 'micro-ondes'
  | 'aucune';

export type PrepLevel = 'ultra-rapide' | 'normal' | 'meal-prep';

export interface CookingInstruction {
  mode: PrepMode;
  minutes: number;
  /** Texte de l'étape ; `{qty}` est remplacé par la quantité exacte. */
  text: string;
}

export type PriceSource = 'estimate' | 'user' | 'provider' | 'example';

/** Un conditionnement achetable (paquet, barquette, boîte…). */
export interface PackageOption {
  id?: string;
  label: string;
  /** Poids net du conditionnement en grammes (ou base de prix si poids variable). */
  grams: number;
  /** Prix du conditionnement en euros (ou prix pour `grams` si poids variable). */
  price: number;
  /** Produit vendu au poids : on paie exactement la quantité prise. */
  variableWeight?: boolean;
  brand?: string;
  ean?: string;
  productId?: string;
  retailProductId?: string;
  source: PriceSource;
  /** Date ISO de dernière mise à jour du prix. */
  priceDate?: string;
}

export interface Food {
  id: string;
  name: string;
  /** Nom court utilisé dans les titres de repas (« poulet », « riz »). */
  shortName: string;
  category: FoodCategory;
  aisle: Aisle;
  /** Valeurs pour 100 g de produit tel qu'acheté (cru pour viandes et féculents). */
  per100: Nutrients;
  unit: 'g' | 'ml';
  /** Aliment vendu/consommé à la pièce (œuf, pot de skyr, compote…). */
  piece?: { label: string; plural: string; grams: number };
  /** Poids cuit = poids cru × cookedYield. */
  cookedYield?: number;
  portable: boolean;
  noCook: boolean;
  /** Bornes de portion par repas, en grammes de produit cru. */
  portion: { min: number; max: number; step: number };
  cooking?: CookingInstruction[];
  /** Périssable : pas de sur-stockage volontaire pour gagner sur le prix au kilo. */
  perishable: boolean;
  /** Conditionnements par défaut — prix ESTIMÉS, à remplacer par les prix relevés en magasin. */
  packages: PackageOption[];
  tags: string[];
  /** Mots-clés pour rapprocher un produit scanné de cet aliment générique. */
  keywords: string[];
  /** Tags de catégories Open Food Facts correspondant à cet aliment. */
  offCategories: string[];
  /** Aliments interchangeables en magasin (ex. volaille maigre). */
  substitutionGroup?: string;
  /** Précision ajoutée au nom quand le poids est celui du produit cru : « riz cru », « pâtes crues ». */
  rawLabel?: string;
  /** S'exprime en grammes dans une liste compacte, même s'il a une unité (« 140 g skyr », « 30 g whey »). */
  byWeight?: boolean;
  /** Mesure ménagère affichée à côté des grammes (« ≈ 1 c. à café »). */
  measure?: { label: string; grams: number };
  /** Aliment personnalisé créé par l'utilisateur. */
  custom?: boolean;
  /** Produit réel (marque) dont viennent les valeurs, quand l'utilisateur a scanné le sien. */
  productName?: string;
  /**
   * Aliment de référence de la table Ciqual (Anses) dont viennent les valeurs.
   * Absent : valeur moyenne d'étiquettes (aucun équivalent dans la table) ou valeurs de l'utilisateur.
   */
  ciqual?: { code: string; label: string; energyComputed?: boolean; note?: string };
}

// ───────────────────────────── Modèles de repas ─────────────────────────────

export type MealSlotKind = 'petit-dejeuner' | 'dejeuner' | 'collation' | 'diner';

/** `protein` et `energy` sont les leviers ajustés par le solveur ; `fixed` ne bouge pas. */
export type Scaling = 'protein' | 'energy' | 'fixed';

export interface TemplateSlot {
  key: string;
  /** Aliments candidats pour ce rôle. */
  foods: string[];
  scaling: Scaling;
  /** Quantité fixe (ou de départ) en grammes. */
  grams?: number;
  /** Quantité fixe en pièces (utilise `food.piece.grams`). */
  pieces?: number;
  min?: number;
  max?: number;
  step?: number;
  optional?: boolean;
  /** Probabilité de garder un rôle facultatif (0–1 ; 0,6 par défaut). */
  chance?: number;
  /** `first` : prendre le premier aliment autorisé de la liste (les suivants ne servent que de repli). */
  pick?: 'first';
  /** Le rôle n'est gardé que si un autre rôle a choisi l'un de ces aliments. */
  when?: { slot: string; in: string[] };
}

export type TemplateKind = 'assiette' | 'one-pot' | 'recette' | 'froid' | 'collation' | 'transportable';

/**
 * Style d'une semaine. `simple` : des assiettes sans recette (viande + féculent + laitage ou fruit),
 * qui se lisent en une ligne. `cuisine` : des plats avec une recette.
 */
export type MealStyle = 'simple' | 'cuisine';

export interface MealTemplate {
  id: string;
  /** Titre avec `{clé}` remplacé par le nom court de l'aliment choisi. */
  name: string;
  kind: TemplateKind;
  slots: MealSlotKind[];
  context: 'home' | 'away' | 'any';
  items: TemplateSlot[];
  methods: PrepMode[];
  levels: PrepLevel[];
  prepMin: number;
  cookMin: number;
  /** Étapes avec `{clé}` (quantité + nom) et `{clé:cook}` (consigne de cuisson). */
  steps: string[];
  batchFriendly: boolean;
  weight?: number;
  /** Recette créée par l'utilisateur. */
  custom?: boolean;
  /** Repas à emporter qui se cuisine la veille (proposé seulement si l'utilisateur l'accepte). */
  prepAhead?: boolean;
  /** Styles de semaine où ce modèle est proposé à la maison. Absent : `cuisine` seulement. */
  styles?: MealStyle[];
}

// ───────────────────────────── Programme ─────────────────────────────

export type MealStatus = 'planned' | 'eaten' | 'partial' | 'replaced' | 'skipped';
export type MealContext = 'home' | 'away';
export type AwayMode = 'none' | 'lunch' | 'full';

export interface MealItem {
  slotKey: string;
  foodId: string;
  /** Poids cru / tel qu'acheté, en grammes. Source unique de vérité. */
  grams: number;
  scaling: Scaling;
  min: number;
  max: number;
  step: number;
}

export interface Meal {
  id: string;
  slot: MealSlotKind;
  templateId: string;
  name: string;
  /** Identité du repas pour la variété : modèle + aliments principaux. */
  signature: string;
  context: MealContext;
  items: MealItem[];
  /** Toujours recalculé à partir de `items` par le service de nutrition. */
  nutrition: Nutrients;
  status: MealStatus;
  /** Le repas a été régénéré ou modifié par rapport au programme initial. */
  swapped?: boolean;
  rejectedSignatures?: string[];
  rating?: number;
  favorite?: boolean;
  /** Repas que l'utilisateur veut garder quand il régénère sa semaine. */
  locked?: boolean;
  /** Repas libre (restaurant, soirée…) déclaré à la place : apport estimé. */
  free?: { kcal: number; protein: number; label: string };
}

export interface MealPlanDay {
  index: number;
  /** Date ISO (YYYY-MM-DD). */
  date: string;
  away: AwayMode;
  meals: Meal[];
  nutrition: Nutrients;
  /** Jour d'entraînement. */
  training?: boolean;
  /** Cible calorique du jour si elle diffère du budget de la semaine (jours d'entraînement / de repos). */
  baseKcal?: number;
  /** Réduction du jour (≤ 0) due à un repas libre lissé sur la semaine. */
  spreadKcal?: number;
}

export interface PlanWarning {
  code: 'low-fiber' | 'no-vegetables' | 'low-fat' | 'off-target' | 'low-protein' | 'low-fruit';
  severity: 'info' | 'warning';
  message: string;
  /** Jours concernés (index 0 = lundi), si pertinent. */
  days?: number[];
}

export interface NutritionTarget {
  kcal: number;
  protein: number;
  toleranceKcal: number;
  /** Repère de fibres journalier (g) utilisé pour les alertes. */
  fiberGuide: number;
}

export interface MealStructureEntry {
  slot: MealSlotKind;
  /** Part des calories de la journée (somme = 1). */
  share: number;
}

export interface WeekPlan {
  weekStart: string;
  seed: number;
  level: PrepLevel;
  /** Style avec lequel la semaine a été générée (absent sur les anciennes semaines : `cuisine`). */
  style?: MealStyle;
  target: NutritionTarget;
  structure: MealStructureEntry[];
  days: MealPlanDay[];
  averages: Nutrients;
  warnings: PlanWarning[];
}

export interface PlannerPreferences {
  excludedFoods: string[];
  excludedTags: string[];
  likedFoods: string[];
  /** Aliments à ne proposer que rarement (au plus une fois par semaine). */
  limitedFoods?: string[];
  /** Le dîner est cuisiné en double et sert de déjeuner le lendemain. */
  cookOnce?: boolean;
  /** Hors domicile, accepter des repas froids cuisinés la veille. */
  awayPrepAhead?: boolean;
  /** Style des repas à la maison. Absent : `cuisine`. */
  style?: MealStyle;
  bannedSignatures: string[];
  bannedTemplates: string[];
  favoriteSignatures: string[];
  /** Note 1–5 par signature de repas. */
  ratings: Record<string, number>;
  level: PrepLevel;
  equipment: PrepMode[];
}

export interface PlannerInput {
  weekStart: string;
  seed: number;
  foods: Food[];
  templates: MealTemplate[];
  target: NutritionTarget;
  structure: MealStructureEntry[];
  prefs: PlannerPreferences;
  /** Mode d'absence pour chacun des 7 jours (lundi → dimanche). */
  away: AwayMode[];
  /** Stocks disponibles en grammes par aliment. */
  inventory: Record<string, number>;
  /** Signatures de la semaine précédente, par jour. */
  previousSignatures: string[][];
  /** Prix au kilo par aliment (pour la pression budgétaire). */
  pricePerKg?: Record<string, number>;
  weeklyBudget?: number;
  /** Conditionnements connus par aliment (prix relevés) ; à défaut, ceux du catalogue. */
  packages?: Record<string, PackageOption[]>;
  /** Arrondir viandes et poissons frais à des barquettes entières (activé par défaut). */
  roundToPacks?: boolean;
  /** Jours d'entraînement : plus de calories ces jours-là, même moyenne sur la semaine. */
  training?: { days: boolean[]; bonusKcal: number; floorKcal?: number };
  /** Repas verrouillés à conserver, par jour puis par créneau (dans l'ordre de `structure`). */
  keep?: (Meal | null | undefined)[][];
}

// ───────────────────────────── Recettes & meal prep ─────────────────────────────

export interface RecipeIngredient {
  foodId: string;
  name: string;
  grams: number;
  pieces?: number;
  pieceLabel?: string;
  cookedGrams?: number;
  unit: 'g' | 'ml';
  nutrition: Nutrients;
  /** Libellé complet prêt à afficher : « 100 g de riz cru (≈ 280 g cuit) ». */
  label: string;
}

export interface Recipe {
  title: string;
  prepMin: number;
  cookMin: number;
  methods: PrepMode[];
  ingredients: RecipeIngredient[];
  steps: string[];
  nutrition: Nutrients;
}

export interface MealPrepPortion {
  dayIndex: number;
  date: string;
  slot: MealSlotKind;
  mealName: string;
  items: { foodId: string; name: string; rawGrams: number; cookedGrams?: number }[];
}

export interface MealPrepPlan {
  fromDay: number;
  days: number;
  totals: { foodId: string; name: string; rawGrams: number; cookedGrams?: number; label: string }[];
  portions: MealPrepPortion[];
  steps: string[];
  storageNote: string;
}

// ───────────────────────────── Courses ─────────────────────────────

export type ShoppingStrategy = 'cheapest' | 'least-waste' | 'best-unit-price';

export interface PackageChoice {
  label: string;
  grams: number;
  price: number;
  count: number;
  variableWeight?: boolean;
  brand?: string;
  ean?: string;
  productId?: string;
  retailProductId?: string;
  source: PriceSource;
  priceDate?: string;
}

export interface ShoppingListItem {
  id: string;
  foodId: string;
  name: string;
  aisle: Aisle;
  unit: 'g' | 'ml';
  pieceGrams?: number;
  pieceLabel?: string;
  /** Quantité nécessaire pour la semaine (g). */
  neededG: number;
  /** Quantité déjà couverte par les stocks (g). */
  fromStockG: number;
  /** Quantité à acheter (g). */
  toBuyG: number;
  packages: PackageChoice[];
  /** Quantité réellement achetée avec les conditionnements choisis (g). */
  boughtG: number;
  /** Reste théorique en fin de semaine : stock + achats − besoins (g). */
  leftoverG: number;
  pricePerKg: number | null;
  cost: number;
  priceSource: PriceSource | null;
  priceDate?: string;
  checked: boolean;
}

export interface ShoppingTotals {
  cost: number;
  perDay: number;
  perMeal: number;
  /** Valeur de ce qui est réellement consommé dans la semaine (hors restes). */
  consumedCost: number;
  itemsToBuy: number;
  itemsInStock: number;
  estimatedShare: number;
}

export interface ShoppingListData {
  weekStart: string;
  strategy: ShoppingStrategy;
  items: ShoppingListItem[];
  totals: ShoppingTotals;
}

// ───────────────────────────── Scan & session de courses ─────────────────────────────

export type ProductSource = 'local' | 'user' | 'provider' | 'off' | 'manual';

/** Produit concret identifié par un scan (ou saisi à la main). */
export interface ScannedProduct {
  ean?: string;
  name: string;
  brand?: string;
  /** Poids net en grammes, si connu. */
  grams?: number;
  per100?: Partial<Nutrients>;
  /** Aliment générique rattaché, si déjà connu. */
  foodId?: string;
  categories?: string[];
  price?: number;
  priceDate?: string;
  variableWeight?: boolean;
  imageUrl?: string;
  productId?: string;
  source: ProductSource;
}

export type MatchKind = 'exact' | 'substitute' | 'unplanned' | 'rejected';

export interface MatchResult {
  kind: MatchKind;
  /** Article de la session concerné. */
  itemId?: string;
  foodId?: string;
  /** 0–1 */
  score: number;
  reasons: string[];
  warnings: string[];
  deltas?: {
    kcalPer100: number;
    proteinPer100: number;
    /** Impact sur la semaine si tout le besoin est couvert par ce produit. */
    weeklyKcal: number;
    pricePerKg?: number;
  };
}

export interface ScanLine {
  id: string;
  ean?: string;
  name: string;
  brand?: string;
  foodId?: string;
  /** Poids d'une unité en grammes. */
  grams: number;
  qty: number;
  /** Prix d'une unité, si connu. */
  price?: number;
  priceSource?: PriceSource;
  variableWeight?: boolean;
  substitution?: boolean;
  at: string;
}

export type SessionItemStatus = 'todo' | 'partial' | 'done' | 'missing';

export interface ShoppingSessionItem {
  id: string;
  listItemId: string;
  foodId: string;
  name: string;
  aisle: Aisle;
  unit: 'g' | 'ml';
  pieceGrams?: number;
  pieceLabel?: string;
  neededG: number;
  /** Produit initialement prévu. */
  planned: PackageChoice[];
  plannedCost: number;
  /** Produits réellement pris. */
  scans: ScanLine[];
  manualDone?: boolean;
}

export interface ExtraLine extends ScanLine {
  destination: 'cart' | 'stock';
}

export interface ShoppingSession {
  id: string;
  listId: string;
  weekStart: string;
  storeId: string;
  storeName: string;
  aisleOrder: Aisle[];
  startedAt: string;
  finishedAt?: string;
  status: 'active' | 'finished';
  items: ShoppingSessionItem[];
  extras: ExtraLine[];
  plannedTotal: number;
  updatedAt: string;
}

export interface SessionTotals {
  itemsTotal: number;
  itemsDone: number;
  itemsRemaining: number;
  plannedTotal: number;
  actualTotal: number;
  /** actualTotal − plannedTotal (négatif = économie). */
  diff: number;
  /** Nombre de lignes sans prix connu (le total réel est alors partiel). */
  unpricedLines: number;
}

export interface PurchaseItem {
  foodId?: string;
  name: string;
  brand?: string;
  ean?: string;
  grams: number;
  qty: number;
  price?: number;
  plannedLabel?: string;
  plannedGrams?: number;
  substitution: boolean;
  unplanned: boolean;
  toStock: boolean;
}

export interface PurchaseSummary {
  sessionId: string;
  listId: string;
  storeId: string;
  weekStart: string;
  date: string;
  items: PurchaseItem[];
  plannedTotal: number;
  actualTotal: number;
  /** Coût prévu des seuls articles réellement achetés. */
  plannedBought: number;
  /** Coût réel des articles de la liste (hors achats imprévus). */
  actualOnList: number;
  /** Économie à périmètre égal : plannedBought − actualOnList (négatif = dépassement). */
  saving: number;
  itemsPlanned: number;
  itemsBought: number;
  missing: { foodId: string; name: string; missingG: number }[];
  inventoryAdds: { foodId: string; grams: number }[];
  priceObservations: { ean: string; price: number; grams: number; date: string }[];
}

export interface FoodHabit {
  foodId: string;
  purchases: number;
  usualBrand?: string;
  usualPackGrams?: number;
  avgPricePerKg?: number;
  substitutions: number;
  missingCount: number;
}

export interface HabitSuggestion {
  foodId: string;
  kind: 'package' | 'rarely-available';
  message: string;
  packGrams?: number;
  brand?: string;
  price?: number;
}

// ───────────────────────────── Stocks ─────────────────────────────

export interface InventoryEntry {
  foodId: string;
  grams: number;
}

// ───────────────────────────── Poids ─────────────────────────────

export interface WeightPoint {
  date: string;
  kg: number;
}

export interface WeightSummary {
  startKg: number;
  currentKg: number | null;
  /** Moyenne mobile la plus récente. */
  trendKg: number | null;
  goalKg: number;
  lostKg: number;
  remainingKg: number;
  progressPct: number;
  /** Variation moyenne par semaine sur la fenêtre d'analyse (kg, négatif = perte). */
  weeklyRateKg: number | null;
  movingAverage: WeightPoint[];
  weekly: { weekStart: string; avgKg: number; deltaKg: number | null }[];
}

export interface CalorieSuggestion {
  kind: 'decrease' | 'increase' | 'none';
  currentKcal: number;
  suggestedKcal: number;
  reason: string;
  /** Plancher en dessous duquel l'application ne propose jamais de descendre. */
  floorKcal: number;
  advice?: string;
}
