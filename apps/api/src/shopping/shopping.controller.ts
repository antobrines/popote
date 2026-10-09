import { type ShoppingStrategy, isValidEan, mondayOf } from '@bouffe/core';
import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsNumber, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import type { Model } from 'mongoose';
import { CatalogService } from '../catalog/catalog.service.js';
import { UserId } from '../common/auth.js';
import { M, type MealPlanDoc, type PriceHistoryDoc, type StoreDoc } from '../db/schemas.js';
import { TodayDto } from '../planning/planning.controller.js';
import { serverToday } from '../planning/planning.service.js';
import { StateService } from '../state/state.service.js';
import { ShoppingService } from './shopping.service.js';

const STRATEGIES = ['cheapest', 'least-waste', 'best-unit-price'];
const AISLES = ['viandes-poissons', 'feculents', 'produits-laitiers', 'fruits', 'epicerie', 'surgeles', 'boissons', 'autres'];

export class GenerateListDto extends TodayDto {
  /** N'importe quel jour de la semaine concernée ; par défaut la semaine en cours. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  weekStart?: string;

  /** `cheapest` (prix total), `least-waste` (moins de restes), `best-unit-price` (meilleur prix au kilo). */
  @IsOptional()
  @IsIn(STRATEGIES)
  strategy?: ShoppingStrategy;
}

export class CheckDto {
  @IsBoolean()
  checked: boolean;
}

export class SessionDto extends TodayDto {
  /** Session complète telle que tenue par la PWA (voir `ShoppingSession` dans @bouffe/core). */
  @IsObject()
  session: Record<string, unknown>;
}

export class RetailProductDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  foodKey: string;

  @IsString()
  @MaxLength(120)
  label: string;

  @IsNumber()
  @Min(1)
  @Max(50_000)
  grams: number;

  @IsNumber()
  @Min(0)
  @Max(1000)
  price: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  brand?: string;

  @IsOptional()
  @Matches(/^\d{8,14}$/)
  ean?: string;

  @IsOptional()
  @IsBoolean()
  variableWeight?: boolean;

  @IsOptional()
  @IsBoolean()
  preferred?: boolean;
}

export class HabitDto extends TodayDto {
  @IsString()
  foodId: string;

  @IsNumber()
  @Min(1)
  packGrams: number;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsNumber()
  price?: number;
}

export class InventoryDto extends TodayDto {
  @IsNumber()
  @Min(0)
  @Max(100_000)
  grams: number;
}

export class StockDto extends TodayDto {
  /** Quantités à fixer, en grammes par aliment (0 retire l'aliment du stock). */
  @IsObject()
  stock: Record<string, number>;
}

export class LearnBarcodeDto {
  @IsString()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  brand?: string;

  /** Poids net du produit, en grammes. */
  @IsNumber()
  @Min(1)
  @Max(50_000)
  grams: number;

  /** Aliment du catalogue auquel ce produit correspond. */
  @IsString()
  foodId: string;

  @IsOptional()
  @IsBoolean()
  variableWeight?: boolean;
}

export class StoreDto {
  @IsString()
  @MaxLength(80)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  chain?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;
}

export class AisleOrderDto {
  /** Ordre de parcours des rayons dans ce magasin. */
  @IsArray()
  @IsIn(AISLES, { each: true })
  aisleOrder: string[];
}

@ApiTags('courses')
@ApiBearerAuth()
@Controller()
export class ShoppingController {
  constructor(
    private readonly shopping: ShoppingService,
    private readonly catalog: CatalogService,
    private readonly state: StateService,
    @InjectModel(M.MealPlan) private readonly plans: Model<MealPlanDoc>,
    @InjectModel(M.Store) private readonly stores: Model<StoreDoc>,
    @InjectModel(M.PriceHistory) private readonly prices: Model<PriceHistoryDoc>,
  ) {}

  private snapshot(userId: string, today?: string) {
    return this.state.snapshot(userId, today ?? serverToday());
  }

  // ───────────── Liste ─────────────

  /** Recalcule la liste de courses d'une semaine (besoins − stocks → conditionnements → coûts). */
  @Post('shopping-lists/generate')
  async generate(@UserId() userId: string, @Body() dto: GenerateListDto) {
    const today = dto.today ?? serverToday();
    const plan = await this.plans.findOne({ userId, weekStart: mondayOf(dto.weekStart ?? today) });
    if (!plan) throw new NotFoundException("Aucun programme pour cette semaine : génère d'abord ta semaine.");
    await this.shopping.refreshList(userId, plan, { today, strategy: dto.strategy, force: true });
    return this.snapshot(userId, today);
  }

  /** Coche ou décoche un article. */
  @Patch('shopping-lists/:id/items/:itemId')
  async check(@UserId() userId: string, @Param('id') id: string, @Param('itemId') itemId: string, @Body() dto: CheckDto) {
    return this.shopping.setChecked(userId, id, itemId, dto.checked);
  }

  // ───────────── Mode Courses ─────────────

  /** Synchronise une session de courses (créée et modifiée localement, éventuellement hors ligne). */
  @Put('shopping-sessions/:id')
  syncSession(@UserId() userId: string, @Param('id') id: string, @Body() dto: SessionDto) {
    return this.shopping.upsertSession(userId, id, dto.session);
  }

  /** « Terminer mes courses » : panier réel, coût réel, stocks, prix mémorisés, articles manquants. */
  @Post('shopping-sessions/:id/finish')
  async finish(@UserId() userId: string, @Param('id') id: string, @Body() dto: SessionDto) {
    const today = dto.today ?? serverToday();
    const purchase = await this.shopping.finish(userId, id, dto.session, today);
    return { purchase, state: await this.snapshot(userId, today) };
  }

  /** Historique des courses. */
  @Get('purchases')
  purchases(@UserId() userId: string) {
    return this.shopping.purchaseHistory(userId, 50);
  }

  /** Adopte un conditionnement habituel suggéré. */
  @Post('shopping/habits/apply')
  async applyHabit(@UserId() userId: string, @Body() dto: HabitDto) {
    const today = dto.today ?? serverToday();
    await this.shopping.applyHabit(userId, dto, today);
    return this.snapshot(userId, today);
  }

  // ───────────── Codes-barres & prix ─────────────

  /**
   * Résout un code-barres en interrogeant successivement : prix relevés du magasin, produits déjà
   * scannés, catalogue commun, puis Open Food Facts. Répond même si les services externes échouent.
   */
  @Get('barcodes/:ean')
  async barcode(@UserId() userId: string, @Param('ean') ean: string, @Query('storeId') storeId?: string) {
    if (!isValidEan(ean)) throw new BadRequestException('Code-barres invalide.');
    return this.catalog.resolveBarcode(userId, ean, storeId);
  }

  /**
   * Rattache un code-barres à un aliment (scan à la maison, pour remplir le stock) : le produit
   * sera reconnu d'emblée la prochaine fois, y compris en magasin.
   */
  @Put('barcodes/:ean')
  @HttpCode(200)
  async learnBarcode(@UserId() userId: string, @Param('ean') ean: string, @Body() dto: LearnBarcodeDto) {
    if (!isValidEan(ean)) throw new BadRequestException('Code-barres invalide.');
    const foods = await this.catalog.foods(userId);
    if (!foods.some((f) => f.id === dto.foodId)) throw new NotFoundException('Aliment inconnu.');
    await this.catalog.learnProduct(userId, null, { ean, name: dto.name, brand: dto.brand, grams: dto.grams, foodId: dto.foodId, variableWeight: dto.variableWeight }, new Date());
    return { ok: true };
  }

  /** Historique des prix relevés pour un code-barres. */
  @Get('prices/:ean')
  priceHistory(@UserId() userId: string, @Param('ean') ean: string) {
    return this.prices.find({ userId, ean }).sort({ date: -1 }).limit(30);
  }

  /** Enregistre un produit du magasin : conditionnement et prix, réutilisés les semaines suivantes. */
  @Put('retail-products')
  async saveRetailProduct(@UserId() userId: string, @Body() dto: RetailProductDto, @Query() query: TodayDto) {
    const today = query.today ?? serverToday();
    await this.shopping.saveRetailProduct(userId, dto);
    await this.shopping.refreshOpenLists(userId, today);
    return this.snapshot(userId, today);
  }

  @Delete('retail-products/:id')
  async deleteRetailProduct(@UserId() userId: string, @Param('id') id: string, @Query() query: TodayDto) {
    const today = query.today ?? serverToday();
    await this.shopping.deleteRetailProduct(userId, id);
    await this.shopping.refreshOpenLists(userId, today);
    return this.snapshot(userId, today);
  }

  // ───────────── Magasins ─────────────

  @Post('stores')
  async createStore(@UserId() userId: string, @Body() dto: StoreDto) {
    const store = await this.catalog.createStore(userId, dto);
    const user = await this.catalog.user(userId);
    if (!user.preferences.storeId) {
      user.preferences.storeId = store._id;
      await user.save();
    }
    return this.snapshot(userId);
  }

  /** Mémorise l'ordre des rayons pour ce magasin. */
  @Patch('stores/:id')
  async aisleOrder(@UserId() userId: string, @Param('id') id: string, @Body() dto: AisleOrderDto, @Query() query: TodayDto) {
    const today = query.today ?? serverToday();
    const store = await this.stores.findOneAndUpdate({ _id: id, userId }, { $set: { aisleOrder: dto.aisleOrder } });
    if (!store) throw new NotFoundException('Magasin introuvable.');
    await this.shopping.refreshOpenLists(userId, today);
    return this.snapshot(userId, today);
  }

  // ───────────── Stocks ─────────────

  /**
   * Fixe le stock de plusieurs aliments d'un coup : remise à zéro d'une zone ou de tout le stock,
   * série de scans, annulation. La liste de courses n'est recalculée qu'une fois.
   */
  @Put('inventory')
  @HttpCode(200)
  async setStock(@UserId() userId: string, @Body() dto: StockDto) {
    const today = dto.today ?? serverToday();
    const entries = Object.entries(dto.stock);
    if (entries.length === 0 || entries.length > 300) throw new BadRequestException('Indique entre 1 et 300 aliments.');
    const known = new Set((await this.catalog.foods(userId)).map((f) => f.id));
    for (const [foodId, grams] of entries) {
      if (typeof grams !== 'number' || !Number.isFinite(grams) || grams < 0 || grams > 100_000) throw new BadRequestException(`Quantité invalide pour ${foodId}.`);
      // Un aliment sorti du catalogue peut toujours être retiré du stock, pas y entrer.
      if (grams > 0 && !known.has(foodId)) throw new NotFoundException(`Aliment inconnu : ${foodId}`);
    }
    await this.catalog.setInventory(userId, dto.stock);
    await this.shopping.refreshOpenLists(userId, today);
    return this.snapshot(userId, today);
  }

  /** Fixe le stock d'un aliment (0 pour le retirer) ; la liste de courses est recalculée. */
  @Put('inventory/:foodKey')
  @HttpCode(200)
  async setInventory(@UserId() userId: string, @Param('foodKey') foodKey: string, @Body() dto: InventoryDto) {
    const today = dto.today ?? serverToday();
    const foods = await this.catalog.foods(userId);
    if (!foods.some((f) => f.id === foodKey)) throw new NotFoundException('Aliment inconnu.');
    await this.catalog.setInventory(userId, { [foodKey]: dto.grams });
    await this.shopping.refreshOpenLists(userId, today);
    return this.snapshot(userId, today);
  }
}
