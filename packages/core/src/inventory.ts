/**
 * Moteur d'inventaire (placards) : stocks théoriques en grammes par aliment.
 */
import type { FoodIndex } from './nutrition.js';
import type { Aisle, Food, InventoryEntry, PackageOption, ScannedProduct } from './types.js';
import { formatGrams } from './util.js';

export type InventoryMap = Record<string, number>;

export function inventoryToMap(entries: InventoryEntry[]): InventoryMap {
  const map: InventoryMap = {};
  for (const e of entries) map[e.foodId] = (map[e.foodId] ?? 0) + Math.max(0, e.grams);
  return map;
}

export function inventoryToEntries(map: InventoryMap): InventoryEntry[] {
  return Object.entries(map)
    .filter(([, grams]) => grams > 0)
    .map(([foodId, grams]) => ({ foodId, grams }));
}

export interface InventoryChange {
  foodId: string;
  /** Variation réellement appliquée (g), négative pour une consommation. */
  delta: number;
  /** Stock après application (g). */
  grams: number;
}

function apply(inventory: InventoryMap, items: { foodId: string; grams: number }[], sign: 1 | -1) {
  const next: InventoryMap = { ...inventory };
  const changes: InventoryChange[] = [];
  for (const item of items) {
    const before = next[item.foodId] ?? 0;
    // Le stock théorique ne descend jamais sous zéro : on ne peut pas consommer ce qu'on n'a pas compté.
    const after = Math.max(0, before + sign * item.grams);
    next[item.foodId] = after;
    changes.push({ foodId: item.foodId, delta: after - before, grams: after });
  }
  return { inventory: next, changes };
}

/** Après validation d'un repas : retire les quantités mangées des stocks. */
export function consumeFromInventory(inventory: InventoryMap, items: { foodId: string; grams: number }[]) {
  return apply(inventory, items, -1);
}

/** Après les courses (ou l'annulation d'un repas) : ajoute des quantités aux stocks. */
export function addToInventory(inventory: InventoryMap, items: { foodId: string; grams: number }[]) {
  return apply(inventory, items, 1);
}

// ───────────────────────────── Rangement à la maison ─────────────────────────────

/** Où l'aliment se range : ce découpage sert à vérifier et à remettre à zéro le stock par zone. */
export type StorageZone = 'frais' | 'surgele' | 'placard';

export const STORAGE_ZONES: { key: StorageZone; label: string; hint: string }[] = [
  { key: 'frais', label: 'Frais', hint: 'Frigo, fruits, pain : ce qui bouge le plus vite.' },
  { key: 'surgele', label: 'Surgelés', hint: 'Congélateur.' },
  { key: 'placard', label: 'Placard', hint: 'Sec, conserves, sauces, épices.' },
];

const FRESH_AISLES: Aisle[] = ['viandes-poissons', 'produits-laitiers', 'fruits'];

/**
 * Zone de rangement d'un aliment. « Frais » regroupe ce qui se périme vite ou vit au frigo
 * (viandes, laitages, œufs, fruits, pain) ; le reste va au placard, sauf le rayon surgelés.
 */
export function storageZone(food: Pick<Food, 'aisle' | 'perishable'>): StorageZone {
  if (food.aisle === 'surgeles') return 'surgele';
  return food.perishable || FRESH_AISLES.includes(food.aisle) ? 'frais' : 'placard';
}

/** Pas d'ajustement du stock : une pièce pour ce qui se compte, sinon 50 g (10 g pour les condiments). */
export function stockStep(food: Pick<Food, 'piece' | 'portion'>): number {
  if (food.piece) return food.piece.grams;
  return food.portion.step <= 5 && food.portion.max <= 80 ? 10 : 50;
}

/** « 6 œufs », « 2,5 pots de skyr », « 1,2 kg » : le stock dans l'unité la plus parlante. */
export function stockLabel(food: Pick<Food, 'piece' | 'unit'>, grams: number): string {
  if (!food.piece) return formatGrams(Math.round(grams), food.unit);
  const count = Math.round((grams / food.piece.grams) * 10) / 10;
  return `${count.toLocaleString('fr-FR')} ${count > 1 ? food.piece.plural : food.piece.label}`;
}

export interface StockPack {
  grams: number;
  /** « 500 g », « 12 œufs » */
  label: string;
}

/**
 * Formats habituels d'un aliment pour un ajout rapide au stock : ceux relevés par l'utilisateur
 * d'abord, puis ceux du catalogue, sans doublon de poids.
 */
export function stockPacks(food: Pick<Food, 'piece' | 'unit' | 'packages'>, known: Pick<PackageOption, 'grams'>[] = [], limit = 2): StockPack[] {
  const seen = new Set<number>();
  const packs: StockPack[] = [];
  for (const option of [...known, ...food.packages]) {
    // Ce qui se compte entre au stock par pièces entières : 1 kg de bananes ≈ 8 bananes.
    const grams = food.piece ? Math.max(1, Math.round(option.grams / food.piece.grams)) * food.piece.grams : Math.round(option.grams);
    if (grams <= 0 || seen.has(grams)) continue;
    seen.add(grams);
    packs.push({ grams, label: stockLabel(food, grams) });
    if (packs.length >= limit) break;
  }
  return packs;
}

/**
 * Poids qu'un produit scanné ajoute au stock : celui lu sur le produit quand il est connu, sinon le
 * format habituel de l'aliment. `null` pour un produit à poids variable (rayon coupe) : à saisir.
 */
export function scannedPackGrams(product: Pick<ScannedProduct, 'grams' | 'variableWeight'> | null, food: Pick<Food, 'packages'>): number | null {
  if (product?.variableWeight) return null;
  if (product?.grams && product.grams > 0) return Math.round(product.grams);
  return food.packages[0] ? Math.round(food.packages[0].grams) : null;
}

/**
 * Ce qu'une remise à zéro retire : tout le stock, ou seulement une zone. Les quantités retirées
 * sont renvoyées telles quelles, pour pouvoir annuler. Un aliment sorti du catalogue n'appartient
 * à aucune zone : seule la remise à zéro complète l'emporte.
 */
export function stockToReset(entries: InventoryEntry[], foods: FoodIndex, zone?: StorageZone): InventoryEntry[] {
  return entries.filter((entry) => {
    if (entry.grams <= 0) return false;
    if (!zone) return true;
    const food = foods.get(entry.foodId);
    return !!food && storageZone(food) === zone;
  });
}

/** Applique des quantités fixées (0 = retiré) à une liste de stock. */
export function applyStock(entries: InventoryEntry[], stock: InventoryMap): InventoryEntry[] {
  const map = inventoryToMap(entries);
  for (const [foodId, grams] of Object.entries(stock)) map[foodId] = Math.max(0, Math.round(grams));
  return inventoryToEntries(map).sort((a, b) => a.foodId.localeCompare(b.foodId));
}
