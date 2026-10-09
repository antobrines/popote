/**
 * Mode Courses : état d'une session en magasin, sous forme de fonctions pures.
 * La PWA applique ces transitions localement (hors connexion) puis synchronise la session.
 */
import { DEFAULT_AISLE_ORDER } from '../data/foods.js';
import type {
  Aisle,
  ExtraLine,
  PurchaseItem,
  PurchaseSummary,
  ScanLine,
  ScannedProduct,
  SessionItemStatus,
  SessionTotals,
  ShoppingListData,
  ShoppingSession,
  ShoppingSessionItem,
} from '../types.js';
import { roundCents } from './pricing.js';

export interface SessionStore {
  id: string;
  name: string;
  aisleOrder?: Aisle[];
}

export function createSession(
  sessionId: string,
  listId: string,
  list: ShoppingListData,
  store: SessionStore,
  now: string,
): ShoppingSession {
  const items: ShoppingSessionItem[] = list.items
    .filter((i) => i.toBuyG > 0)
    .map((i) => ({
      id: `ssi-${i.foodId}`,
      listItemId: i.id,
      foodId: i.foodId,
      name: i.name,
      aisle: i.aisle,
      unit: i.unit,
      pieceGrams: i.pieceGrams,
      pieceLabel: i.pieceLabel,
      neededG: i.toBuyG,
      planned: i.packages,
      plannedCost: i.cost,
      scans: [],
    }));
  return {
    id: sessionId,
    listId,
    weekStart: list.weekStart,
    storeId: store.id,
    storeName: store.name,
    aisleOrder: store.aisleOrder ?? DEFAULT_AISLE_ORDER,
    startedAt: now,
    status: 'active',
    items,
    extras: [],
    plannedTotal: roundCents(items.reduce((sum, i) => sum + i.plannedCost, 0)),
    updatedAt: now,
  };
}

export function gotGrams(item: Pick<ShoppingSessionItem, 'scans'>): number {
  return item.scans.reduce((sum, s) => sum + s.grams * s.qty, 0);
}

export function remainingGrams(item: ShoppingSessionItem): number {
  return Math.max(0, item.neededG - gotGrams(item));
}

/** Nombre d'unités prévues (pour afficher « 1 / 3 récupéré »). */
export function plannedUnits(item: ShoppingSessionItem): number {
  return item.planned.reduce((sum, p) => sum + (p.variableWeight ? 1 : p.count), 0);
}

export function gotUnits(item: ShoppingSessionItem): number {
  return item.scans.reduce((sum, s) => sum + s.qty, 0);
}

export function itemStatus(item: ShoppingSessionItem, finished = false): SessionItemStatus {
  // 2 % de marge : une barquette de 495 g valide un besoin de 500 g.
  if (item.manualDone || gotGrams(item) >= item.neededG * 0.98) return 'done';
  if (gotGrams(item) > 0) return finished ? 'missing' : 'partial';
  return finished ? 'missing' : 'todo';
}

export function lineCost(line: Pick<ScanLine, 'price' | 'qty'>): number {
  return line.price !== undefined ? roundCents(line.price * line.qty) : 0;
}

export function sessionTotals(session: ShoppingSession): SessionTotals {
  const lines: ScanLine[] = [...session.items.flatMap((i) => i.scans), ...session.extras.filter((e) => e.destination === 'cart')];
  const itemsDone = session.items.filter((i) => itemStatus(i) === 'done').length;
  // Article coché sans scan : compté à son prix prévu, faute de mieux.
  const manualCost = session.items.filter((i) => i.manualDone && i.scans.length === 0).reduce((sum, i) => sum + i.plannedCost, 0);
  const actualTotal = roundCents(lines.reduce((sum, l) => sum + lineCost(l), 0) + manualCost);
  return {
    itemsTotal: session.items.length,
    itemsDone,
    itemsRemaining: session.items.length - itemsDone,
    plannedTotal: session.plannedTotal,
    actualTotal,
    diff: roundCents(actualTotal - session.plannedTotal),
    unpricedLines: lines.filter((l) => l.price === undefined).length,
  };
}

export interface ScanInput {
  lineId: string;
  product: ScannedProduct;
  /** Poids réel d'une unité (obligatoire pour un produit à poids variable). */
  grams?: number;
  qty?: number;
  price?: number;
  substitution?: boolean;
  at: string;
}

function toLine(input: ScanInput, fallbackGrams: number): ScanLine {
  const price = input.price ?? input.product.price;
  return {
    id: input.lineId,
    ean: input.product.ean,
    name: input.product.name,
    brand: input.product.brand,
    foodId: input.product.foodId,
    grams: input.grams ?? input.product.grams ?? fallbackGrams,
    qty: input.qty ?? 1,
    price,
    priceSource: price === undefined ? undefined : input.price !== undefined ? 'user' : input.product.source === 'provider' ? 'provider' : 'user',
    variableWeight: input.product.variableWeight,
    substitution: input.substitution,
    at: input.at,
  };
}

function touch(session: ShoppingSession, at: string, patch: Partial<ShoppingSession>): ShoppingSession {
  return { ...session, ...patch, updatedAt: at };
}

/**
 * Ajoute un scan à un article de la liste. Scanner deux fois le même produit (même code-barres,
 * même poids, même prix) incrémente la quantité au lieu de créer une ligne.
 */
export function addScan(session: ShoppingSession, itemId: string, input: ScanInput): ShoppingSession {
  const items = session.items.map((item) => {
    if (item.id !== itemId) return item;
    const fallback = item.planned[0]?.grams ?? item.neededG;
    const line = toLine(input, fallback);
    const same = item.scans.find(
      (s) => !!line.ean && s.ean === line.ean && s.grams === line.grams && s.price === line.price && !line.variableWeight,
    );
    const scans = same
      ? item.scans.map((s) => (s === same ? { ...s, qty: s.qty + line.qty, at: line.at } : s))
      : [...item.scans, line];
    return { ...item, scans, manualDone: false };
  });
  return touch(session, input.at, { items });
}

/** Modifie une ligne scannée (quantité, poids réel, prix). Une quantité ≤ 0 supprime la ligne. */
export function updateScan(
  session: ShoppingSession,
  lineId: string,
  patch: Partial<Pick<ScanLine, 'qty' | 'grams' | 'price'>>,
  at: string,
): ShoppingSession {
  const apply = <T extends ScanLine>(lines: T[]): T[] =>
    lines
      .map((l) => (l.id === lineId ? { ...l, ...patch, priceSource: patch.price !== undefined ? ('user' as const) : l.priceSource } : l))
      .filter((l) => l.qty > 0);
  return touch(session, at, {
    items: session.items.map((i) => ({ ...i, scans: apply(i.scans) })),
    extras: apply(session.extras),
  });
}

export function removeScan(session: ShoppingSession, lineId: string, at: string): ShoppingSession {
  return updateScan(session, lineId, { qty: 0 }, at);
}

/** Produit imprévu : ajouté au panier (compté dans le total) ou simplement enregistré dans les stocks. */
export function addExtra(session: ShoppingSession, input: ScanInput, destination: ExtraLine['destination']): ShoppingSession {
  const line: ExtraLine = { ...toLine(input, input.product.grams ?? 0), destination };
  return touch(session, input.at, { extras: [...session.extras, line] });
}

/** Coche / décoche un article sans scan (produit sans code-barres, rayon coupe…). */
export function setManualDone(session: ShoppingSession, itemId: string, done: boolean, at: string): ShoppingSession {
  return touch(session, at, {
    items: session.items.map((i) => (i.id === itemId ? { ...i, manualDone: done } : i)),
  });
}

/** Clôture la session : panier réel, coût réel, ajouts aux stocks, prix relevés, articles manquants. */
export function finishSession(session: ShoppingSession, now: string): { session: ShoppingSession; purchase: PurchaseSummary } {
  const finished: ShoppingSession = { ...session, status: 'finished', finishedAt: now, updatedAt: now };
  const items: PurchaseItem[] = [];
  const inventory = new Map<string, number>();
  const prices = new Map<string, { ean: string; price: number; grams: number; date: string }>();

  const record = (line: ScanLine, extra: Partial<PurchaseItem>) => {
    items.push({
      foodId: line.foodId,
      name: line.name,
      brand: line.brand,
      ean: line.ean,
      grams: line.grams,
      qty: line.qty,
      price: line.price,
      substitution: !!line.substitution,
      unplanned: false,
      toStock: true,
      ...extra,
    });
    if (line.ean && line.price !== undefined && line.grams > 0) {
      prices.set(line.ean, { ean: line.ean, price: line.price, grams: line.grams, date: now });
    }
  };

  for (const item of session.items) {
    const planned = item.planned[0];
    for (const line of item.scans) {
      // Les achats alimentent le stock de l'aliment PRÉVU : c'est lui que le programme consomme.
      record(line, { foodId: item.foodId, plannedLabel: planned?.label, plannedGrams: planned?.grams });
      inventory.set(item.foodId, (inventory.get(item.foodId) ?? 0) + line.grams * line.qty);
    }
    // Article coché sans scan : on considère le conditionnement prévu comme acheté.
    if (item.manualDone && item.scans.length === 0) {
      for (const pack of item.planned) {
        items.push({
          foodId: item.foodId,
          name: item.name,
          brand: pack.brand,
          ean: pack.ean,
          grams: pack.grams,
          qty: pack.count,
          price: pack.price,
          plannedLabel: pack.label,
          plannedGrams: pack.grams,
          substitution: false,
          unplanned: false,
          toStock: true,
        });
        inventory.set(item.foodId, (inventory.get(item.foodId) ?? 0) + pack.grams * pack.count);
      }
    }
  }
  for (const extra of session.extras) {
    record(extra, { unplanned: true, toStock: !!extra.foodId });
    if (extra.foodId) inventory.set(extra.foodId, (inventory.get(extra.foodId) ?? 0) + extra.grams * extra.qty);
  }

  const missing = session.items
    .filter((i) => itemStatus(i, true) === 'missing')
    .map((i) => ({ foodId: i.foodId, name: i.name, missingG: Math.round(remainingGrams(i)) }));

  const actualTotal = sessionTotals(session).actualTotal;
  // Un article manquant n'est pas une économie : on compare prévu et réel sur ce qui a été acheté.
  const missingIds = new Set(missing.map((m) => m.foodId));
  const plannedBought = roundCents(session.items.filter((i) => !missingIds.has(i.foodId)).reduce((sum, i) => sum + i.plannedCost, 0));
  const extrasTotal = session.extras.filter((e) => e.destination === 'cart').reduce((sum, e) => sum + lineCost(e), 0);
  const actualOnList = roundCents(actualTotal - extrasTotal);

  return {
    session: finished,
    purchase: {
      sessionId: session.id,
      listId: session.listId,
      storeId: session.storeId,
      weekStart: session.weekStart,
      date: now,
      items,
      plannedTotal: session.plannedTotal,
      actualTotal,
      plannedBought,
      actualOnList,
      saving: roundCents(plannedBought - actualOnList),
      itemsPlanned: session.items.length,
      itemsBought: session.items.length - missing.length,
      missing,
      inventoryAdds: [...inventory.entries()].map(([foodId, grams]) => ({ foodId, grams })),
      priceObservations: [...prices.values()],
    },
  };
}
