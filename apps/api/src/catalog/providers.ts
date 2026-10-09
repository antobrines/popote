/**
 * Fournisseurs externes : magasins (prix, produits) et bases produit (codes-barres).
 *
 * Aucune de ces intégrations n'est nécessaire au cœur de l'application : si un fournisseur
 * est indisponible, l'application retombe sur les données saisies par l'utilisateur.
 */
import { type ProductResolver, type ScannedProduct, parseOpenFoodFactsProduct } from '@bouffe/core';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { config } from '../config.js';
import { type BarcodeDoc, M, type ProductDoc, type RetailProductDoc, type StoreDoc } from '../db/schemas.js';

// ───────────────────────────── Magasins ─────────────────────────────

export interface RetailCapabilities {
  productSearch: boolean;
  prices: boolean;
  availability: boolean;
  cart: boolean;
  aisles: boolean;
}

export interface RetailProviderStatus {
  id: string;
  label: string;
  available: boolean;
  /** Vrai si l'intégration repose sur une API officiellement autorisée. */
  official: boolean;
  /** Vrai si les données renvoyées sont fictives (démonstration). */
  example: boolean;
  capabilities: RetailCapabilities;
  explanation: string;
}

export interface RetailProvider {
  status(): RetailProviderStatus;
  /** Produit et prix pour un code-barres dans un magasin, ou `null`. */
  findByEan(store: StoreDoc, ean: string): Promise<ScannedProduct | null>;
  /** Recherche de produits dans le catalogue d'un magasin. */
  search(store: StoreDoc, query: string): Promise<ScannedProduct[]>;
}

const NONE: RetailCapabilities = { productSearch: false, prices: false, availability: false, cart: false, aisles: false };

/**
 * E.Leclerc — intégration NON DISPONIBLE à ce jour.
 *
 * Vérifié en octobre 2026 : E.Leclerc ne publie aucune API officielle ouverte aux particuliers ou
 * aux développeurs tiers pour le catalogue, les prix, les disponibilités ou le panier du Drive.
 * La seule API documentée (Mirakl) est réservée aux vendeurs de la marketplace. Les « API »
 * tierces existantes reposent sur du scraping non autorisé : elles ne sont volontairement pas utilisées.
 *
 * Cette classe réserve l'emplacement : le jour où une API officielle existe, il suffit
 * d'implémenter `findByEan` / `search` ici, sans toucher au reste de l'application.
 */
@Injectable()
export class LeclercProvider implements RetailProvider {
  status(): RetailProviderStatus {
    return {
      id: 'leclerc',
      label: 'E.Leclerc',
      available: false,
      official: false,
      example: false,
      capabilities: NONE,
      explanation:
        "E.Leclerc ne propose pas d'API publique officielle pour les produits, prix, disponibilités ou paniers. " +
        "L'application n'utilise ni scraping ni contournement : les prix Leclerc sont ceux que tu relèves toi-même (saisie ou scan), mémorisés par magasin avec leur date.",
    };
  }

  async findByEan(): Promise<ScannedProduct | null> {
    return null;
  }

  async search(): Promise<ScannedProduct[]> {
    return [];
  }
}

/** Produits et prix saisis ou scannés par l'utilisateur pour son magasin. Toujours disponible. */
@Injectable()
export class ManualProvider implements RetailProvider {
  constructor(@InjectModel(M.RetailProduct) private readonly retail: Model<RetailProductDoc>) {}

  status(): RetailProviderStatus {
    return {
      id: 'manual',
      label: 'Mes prix relevés',
      available: true,
      official: true,
      example: false,
      capabilities: { ...NONE, productSearch: true, prices: true },
      explanation: 'Produits, conditionnements et prix que tu as enregistrés. Chaque prix garde sa date et est signalé quand il vieillit.',
    };
  }

  private toProduct(doc: RetailProductDoc): ScannedProduct {
    return {
      ean: doc.ean,
      name: doc.label,
      brand: doc.brand,
      grams: doc.grams,
      foodId: doc.foodKey,
      price: doc.price,
      priceDate: doc.priceDate.toISOString(),
      variableWeight: doc.variableWeight,
      productId: doc.productId ? String(doc.productId) : undefined,
      source: 'user',
    };
  }

  async findByEan(store: StoreDoc, ean: string): Promise<ScannedProduct | null> {
    const doc = await this.retail.findOne({ userId: store.userId, storeId: store._id, ean }).sort({ priceDate: -1 });
    return doc ? this.toProduct(doc) : null;
  }

  async search(store: StoreDoc, query: string): Promise<ScannedProduct[]> {
    const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const docs = await this.retail.find({ userId: store.userId, storeId: store._id, label: pattern }).limit(20);
    return docs.map((d) => this.toProduct(d));
  }
}

/**
 * Fournisseur de DÉMONSTRATION (RETAIL_PROVIDER=mock, hors production).
 * Les produits et prix renvoyés sont fictifs et étiquetés « EXEMPLE » : ils servent à tester
 * le parcours de scan sans magasin réel et ne doivent jamais être pris pour des prix Leclerc.
 */
@Injectable()
export class MockProvider implements RetailProvider {
  private readonly catalogue: ScannedProduct[] = [
    { ean: '2000000000015', name: 'EXEMPLE — Filets de poulet 500 g', grams: 500, price: 6.49, foodId: 'poulet', source: 'provider' },
    { ean: '2000000000022', name: 'EXEMPLE — Riz basmati 1 kg', grams: 1000, price: 2.49, foodId: 'riz', source: 'provider' },
    { ean: '2000000000039', name: 'EXEMPLE — Skyr nature 4 × 140 g', grams: 560, price: 3.19, foodId: 'skyr', source: 'provider' },
  ];

  status(): RetailProviderStatus {
    return {
      id: 'mock',
      label: 'Fournisseur de démonstration',
      available: true,
      official: false,
      example: true,
      capabilities: { ...NONE, productSearch: true, prices: true },
      explanation: "Données FICTIVES destinées aux tests. Aucun lien avec un magasin réel.",
    };
  }

  async findByEan(_store: StoreDoc, ean: string): Promise<ScannedProduct | null> {
    return this.catalogue.find((p) => p.ean === ean) ?? null;
  }

  async search(_store: StoreDoc, query: string): Promise<ScannedProduct[]> {
    return this.catalogue.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));
  }
}

@Injectable()
export class RetailProviderRegistry {
  constructor(
    private readonly manual: ManualProvider,
    private readonly leclerc: LeclercProvider,
    private readonly mock: MockProvider,
  ) {}

  private get mockEnabled(): boolean {
    return config.retailProvider === 'mock' && !config.isProd;
  }

  /** Fournisseurs à interroger pour un magasin, par ordre de priorité. */
  for(store: StoreDoc | null): RetailProvider[] {
    const list: RetailProvider[] = [this.manual];
    if (store?.chain === 'leclerc') list.push(this.leclerc);
    if (this.mockEnabled) list.push(this.mock);
    return list.filter((p) => p.status().available);
  }

  statuses(): RetailProviderStatus[] {
    return [this.manual.status(), this.leclerc.status(), ...(this.mockEnabled ? [this.mock.status()] : [])];
  }
}

// ───────────────────────────── Résolveurs de codes-barres ─────────────────────────────

/** Produits déjà scannés ou enregistrés (par l'utilisateur, ou catalogue commun si `userId` est nul). */
export class KnownBarcodeResolver implements ProductResolver {
  constructor(
    readonly name: string,
    private readonly barcodes: Model<BarcodeDoc>,
    private readonly products: Model<ProductDoc>,
    private readonly userId: string | null,
  ) {}

  async resolve(ean: string): Promise<ScannedProduct | null> {
    const barcode = await this.barcodes.findOne({ ean, userId: this.userId });
    if (!barcode) return null;
    const product = await this.products.findById(barcode.productId);
    if (!product) return null;
    return {
      ean,
      name: product.name,
      brand: product.brand,
      grams: product.grams,
      per100: product.per100,
      foodId: product.foodKey,
      categories: product.categories,
      variableWeight: product.variableWeight,
      imageUrl: product.imageUrl,
      productId: product.id,
      source: this.userId ? 'user' : 'local',
    };
  }
}

export class RetailProviderResolver implements ProductResolver {
  readonly name = 'magasin';

  constructor(
    private readonly providers: RetailProvider[],
    private readonly store: StoreDoc,
  ) {}

  async resolve(ean: string): Promise<ScannedProduct | null> {
    for (const provider of this.providers) {
      const product = await provider.findByEan(this.store, ean);
      if (product) return product;
    }
    return null;
  }
}

/**
 * Open Food Facts — base produit collaborative sous licence ODbL, API publique documentée.
 * https://openfoodfacts.github.io/openfoodfacts-server/api/ (User-Agent applicatif exigé,
 * ~15 lectures produit par minute et par IP). Désactivable via OFF_ENABLED=false.
 */
export class OpenFoodFactsResolver implements ProductResolver {
  readonly name = 'open-food-facts';
  private static readonly logger = new Logger('OpenFoodFacts');
  private static readonly FIELDS =
    'code,product_name,product_name_fr,generic_name_fr,brands,quantity,product_quantity,categories_tags,image_front_small_url,nutriments';

  async resolve(ean: string): Promise<ScannedProduct | null> {
    if (!config.openFoodFacts.enabled) return null;
    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(ean)}.json?fields=${OpenFoodFactsResolver.FIELDS}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': config.openFoodFacts.userAgent, Accept: 'application/json' },
      signal: AbortSignal.timeout(3500),
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      OpenFoodFactsResolver.logger.warn(`Réponse ${response.status} pour ${ean}`);
      throw new Error(`Open Food Facts : HTTP ${response.status}`);
    }
    return parseOpenFoodFactsProduct(await response.json(), ean);
  }
}

// ───────────────────────────── Santé ─────────────────────────────

export interface HealthProviderStatus {
  id: string;
  label: string;
  available: boolean;
  explanation: string;
  roadmap?: string[];
}

export const HEALTH_PROVIDERS: HealthProviderStatus[] = [
  {
    id: 'manual',
    label: 'Saisie manuelle',
    available: true,
    explanation: 'Poids, pas, calories actives, entraînements et sommeil se saisissent directement dans l’application.',
  },
  {
    id: 'health-connect',
    label: 'Samsung Health / Health Connect',
    available: false,
    explanation:
      "Aucune API web ne donne accès à Samsung Health ni à Health Connect : ces données ne sont lisibles que par une application Android native, avec l'accord de l'utilisateur. " +
      "Une PWA dans un navigateur ne peut donc pas les récupérer, et l'application ne prétend pas le faire.",
    roadmap: [
      'Empaqueter la PWA avec Capacitor (Android).',
      'Lire Health Connect via un plugin natif (pas, calories actives, séances, poids, sommeil) après autorisation explicite.',
      "Envoyer les relevés à l'API existante : POST /api/activities/import et PUT /api/weights/:date (source « health-connect »).",
    ],
  },
];
