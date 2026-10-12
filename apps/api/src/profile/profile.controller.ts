/**
 * Profil, objectifs, préférences et droits RGPD (export, effacement).
 */
import {
  type ActivityLevel,
  type AwayMode,
  type CustomRecipeInput,
  DEFAULT_EQUIPMENT,
  FIBER_GUIDE,
  type MealSlotKind,
  type PrepLevel,
  type PrepMode,
  type Sex,
  type ShoppingStrategy,
  definedOnly,
  normalize,
} from '@bouffe/core';
import { Body, ConflictException, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import * as argon2 from 'argon2';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { Connection } from 'mongoose';
import { AuthService } from '../auth/auth.module.js';
import { CatalogService, type CustomFoodInput } from '../catalog/catalog.service.js';
import { UserId } from '../common/auth.js';
import { M } from '../db/schemas.js';
import { TodayDto } from '../planning/planning.controller.js';
import { PlanningService, serverToday } from '../planning/planning.service.js';
import { StoreDto } from '../shopping/shopping.controller.js';
import { ShoppingService } from '../shopping/shopping.service.js';
import { StateService } from '../state/state.service.js';

const SLOTS = ['petit-dejeuner', 'dejeuner', 'collation', 'diner'];
const AWAY = ['none', 'lunch', 'full'];
const LEVELS = ['ultra-rapide', 'normal', 'meal-prep'];
const MODES = ['air-fryer', 'poele', 'four', 'rice-cooker', 'casserole', 'one-pot', 'micro-ondes'];
const STRATEGIES = ['cheapest', 'least-waste', 'best-unit-price'];

export class BodyProfileDto {
  @IsIn(['male', 'female'])
  sex: Sex;

  @IsInt()
  @Min(16)
  @Max(100)
  age: number;

  @IsNumber()
  @Min(120)
  @Max(230)
  heightCm: number;

  /** Poids de départ (kg). */
  @IsNumber()
  @Min(35)
  @Max(350)
  weightKg: number;

  @IsNumber()
  @Min(35)
  @Max(350)
  goalWeightKg: number;

  @IsIn(['sedentary', 'light', 'moderate', 'active'])
  activity: ActivityLevel;
}

export class TargetDto extends TodayDto {
  /** Budget calorique journalier. */
  @IsInt()
  @Min(1200)
  @Max(6000)
  kcal: number;

  /** Cible de protéines (g/jour). */
  @IsInt()
  @Min(40)
  @Max(400)
  protein: number;

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(300)
  toleranceKcal?: number;

  /** `suggestion` quand l'utilisateur confirme un ajustement proposé par l'application. */
  @IsOptional()
  @IsIn(['manual', 'suggestion'])
  reason?: 'manual' | 'suggestion';
}

export class PreferencesDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  likedFoods?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludedFoods?: string[];

  /** Aliments à ne proposer que rarement (au plus une fois par semaine). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  limitedFoods?: string[];

  /** Cuisiner le dîner en double : il sert de déjeuner le lendemain. */
  @IsOptional()
  @IsBoolean()
  cookOnce?: boolean;

  /** Hors domicile, accepter des repas froids à cuisiner la veille. */
  @IsOptional()
  @IsBoolean()
  awayPrepAhead?: boolean;

  /** Style des repas à la maison : `simple` (assiettes sans recette) ou `cuisine` (plats avec recette). */
  @IsOptional()
  @IsIn(['simple', 'cuisine'])
  style?: 'simple' | 'cuisine';

  /** Jours d'entraînement, du lundi au dimanche. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(7)
  @ArrayMaxSize(7)
  @IsBoolean({ each: true })
  trainingDays?: boolean[];

  /** Calories ajoutées un jour d'entraînement (compensées sur les jours de repos). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(500)
  trainingBonusKcal?: number;

  /** Catégories ou étiquettes exclues, par exemple `legume`. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludedTags?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  bannedBrands?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(SLOTS, { each: true })
  meals?: MealSlotKind[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(7)
  @ArrayMaxSize(7)
  @IsIn(AWAY, { each: true })
  awayDays?: AwayMode[];

  @IsOptional()
  @IsIn(LEVELS)
  level?: PrepLevel;

  @IsOptional()
  @IsArray()
  @IsIn(MODES, { each: true })
  equipment?: PrepMode[];

  @IsOptional()
  @IsString()
  storeId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  weeklyBudget?: number | null;

  @IsOptional()
  @IsIn(STRATEGIES)
  strategy?: ShoppingStrategy;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  weighDay?: number;

  @IsOptional()
  @IsObject()
  reminders?: { weighIn: boolean; mealPrep: boolean };
}

export class UpdateMeDto extends TodayDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  displayName?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => BodyProfileDto)
  profile?: BodyProfileDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PreferencesDto)
  preferences?: PreferencesDto;

  /** Consentement au stockage des données de poids et d'activité. Le retirer efface ces données. */
  @IsOptional()
  @IsBoolean()
  consentHealthData?: boolean;
}

export class OnboardingDto extends TodayDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  displayName?: string;

  @ValidateNested()
  @Type(() => BodyProfileDto)
  profile: BodyProfileDto;

  @ValidateNested()
  @Type(() => TargetDto)
  target: TargetDto;

  @ValidateNested()
  @Type(() => PreferencesDto)
  preferences: PreferencesDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => StoreDto)
  store?: StoreDto;

  @IsBoolean()
  consentHealthData: boolean;
}

export class DeleteAccountDto {
  @IsString()
  password: string;
}

export class CustomFoodDto extends TodayDto {
  /** Valeurs de l'étiquette pour un aliment existant (`id`), ou nouvel aliment personnel. */
  @IsObject()
  food: CustomFoodInput;
}

export class CustomRecipeDto {
  /** Recette personnelle : nom, ingrédients et rôles, étapes (voir `CustomRecipeInput` dans @bouffe/core). */
  @IsObject()
  recipe: CustomRecipeInput;
}

@ApiTags('profil')
@ApiBearerAuth()
@Controller()
export class ProfileController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly state: StateService,
    private readonly shopping: ShoppingService,
    private readonly planning: PlanningService,
    private readonly auth: AuthService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /**
   * État complet de l'application pour l'utilisateur (profil, programme, courses, stocks, suivi).
   * `catalog=1` ajoute le catalogue d'aliments, les modèles de repas et les codes-barres connus.
   */
  @Get('state')
  getState(@UserId() userId: string, @Query() query: TodayDto, @Query('catalog') catalog?: string) {
    return this.state.snapshot(userId, query.today ?? serverToday(), catalog === '1');
  }

  private toProfile(dto: BodyProfileDto) {
    return {
      sex: dto.sex,
      birthYear: new Date().getFullYear() - dto.age,
      heightCm: dto.heightCm,
      startWeightKg: dto.weightKg,
      goalWeightKg: dto.goalWeightKg,
      activity: dto.activity,
    };
  }

  private async setGoal(userId: string, dto: TargetDto, reason: 'onboarding' | 'manual' | 'suggestion') {
    const goals = this.connection.model(M.NutritionGoal);
    const now = new Date();
    await goals.updateMany({ userId, endsAt: null }, { $set: { endsAt: now } });
    await goals.create({
      userId,
      kcal: dto.kcal,
      protein: dto.protein,
      toleranceKcal: dto.toleranceKcal ?? 50,
      fiberGuide: FIBER_GUIDE,
      startsAt: now,
      reason,
    });
  }

  private async setConsent(userId: string, granted: boolean) {
    const user = await this.catalog.user(userId);
    user.consents = { healthData: granted, healthDataAt: new Date() };
    await user.save();
    if (!granted) {
      // Retrait du consentement : les données de santé sont effacées.
      await this.connection.model(M.WeightEntry).deleteMany({ userId });
      await this.connection.model(M.ActivityEntry).deleteMany({ userId });
    }
  }

  /** Première configuration : profil, objectif, préférences, magasin. */
  @Post('me/onboarding')
  async onboarding(@UserId() userId: string, @Body() dto: OnboardingDto) {
    const today = dto.today ?? serverToday();
    const user = await this.catalog.user(userId);
    if (dto.displayName !== undefined) user.displayName = dto.displayName;
    user.profile = this.toProfile(dto.profile);
    const { storeId: _storeId, ...prefs } = dto.preferences;
    user.set('preferences', { ...user.toObject().preferences, equipment: DEFAULT_EQUIPMENT, ...definedOnly(prefs) });
    user.onboardedAt = new Date();
    await user.save();

    if (dto.store?.name && (await this.catalog.stores(userId)).length === 0) {
      const chain = normalize(dto.store.name).includes('leclerc') ? 'leclerc' : (dto.store.chain ?? 'other');
      const store = await this.catalog.createStore(userId, { ...dto.store, chain });
      user.preferences.storeId = store._id;
      await user.save();
    }
    await this.setGoal(userId, dto.target, 'onboarding');
    await this.setConsent(userId, dto.consentHealthData);
    if (dto.consentHealthData) {
      await this.connection
        .model(M.WeightEntry)
        .updateOne({ userId, date: today }, { $set: { kg: dto.profile.weightKg, source: 'manual' } }, { upsert: true });
    }
    return this.state.snapshot(userId, today, true);
  }

  /** Met à jour le nom, le profil corporel, les préférences ou le consentement. */
  @Put('me')
  async update(@UserId() userId: string, @Body() dto: UpdateMeDto) {
    const today = dto.today ?? serverToday();
    const user = await this.catalog.user(userId);
    if (dto.displayName !== undefined) user.displayName = dto.displayName;
    if (dto.profile) user.profile = this.toProfile(dto.profile);
    // Mise à jour partielle : seuls les champs réellement envoyés remplacent les préférences existantes.
    if (dto.preferences) user.set('preferences', { ...user.toObject().preferences, ...definedOnly(dto.preferences) });
    await user.save();
    if (dto.consentHealthData !== undefined) await this.setConsent(userId, dto.consentHealthData);
    if (dto.preferences?.storeId || dto.preferences?.strategy) await this.shopping.refreshOpenLists(userId, today);
    return this.state.snapshot(userId, today);
  }

  /**
   * Change le budget calorique / protéique. L'application ne l'appelle jamais d'elle-même :
   * un ajustement suggéré n'est appliqué qu'après confirmation explicite de l'utilisateur.
   */
  @Post('me/goal')
  async goal(@UserId() userId: string, @Body() dto: TargetDto) {
    await this.setGoal(userId, dto, dto.reason ?? 'manual');
    return this.state.snapshot(userId, dto.today ?? serverToday());
  }

  /** Droit d'accès et de portabilité : toutes les données du compte, au format JSON. */
  @Get('me/export')
  async export(@UserId() userId: string) {
    const user = await this.catalog.user(userId);
    const collections: Record<string, unknown[]> = {};
    for (const name of USER_COLLECTIONS) {
      collections[name] = await this.connection.model(name).find({ userId }).lean();
    }
    return { exportedAt: new Date().toISOString(), user, ...collections };
  }

  /** Droit à l'effacement : supprime définitivement le compte et toutes ses données. */
  @Delete('me')
  @HttpCode(204)
  async remove(@UserId() userId: string, @Body() dto: DeleteAccountDto) {
    const user = await this.catalog.user(userId);
    if (!(await argon2.verify(user.passwordHash, dto.password).catch(() => false))) {
      throw new UnauthorizedException('Mot de passe incorrect.');
    }
    for (const name of USER_COLLECTIONS) await this.connection.model(name).deleteMany({ userId });
    await this.auth.revokeAll(userId);
    await user.deleteOne();
  }

  /**
   * « Mes vrais produits » : enregistre les valeurs de l'étiquette pour un aliment (ou ajoute un
   * aliment personnel). Les programmes en cours sont recalculés avec ces valeurs.
   */
  @Post('foods')
  async saveFood(@UserId() userId: string, @Body() dto: CustomFoodDto) {
    const today = dto.today ?? serverToday();
    await this.catalog.saveCustomFood(userId, dto.food);
    await this.planning.recomputePlans(userId, today);
    return this.state.snapshot(userId, today, true);
  }

  /** Revient aux valeurs du catalogue (ou supprime un aliment personnel). */
  @Delete('foods/:key')
  async deleteFood(@UserId() userId: string, @Param('key') key: string, @Query() query: TodayDto) {
    const today = query.today ?? serverToday();
    // Supprimer un aliment personnel encore utilisé laisserait des repas impossibles à calculer.
    if (await this.catalog.isOwnFood(userId, key)) {
      const recipe = await this.catalog.recipeUsing(userId, key);
      if (recipe) throw new ConflictException(`Cet aliment est utilisé dans ta recette « ${recipe} » : retire-le d'abord de la recette.`);
      if (await this.planning.usesFood(userId, key, today)) {
        throw new ConflictException("Cet aliment figure dans un programme en cours : remplace d'abord les repas concernés.");
      }
    }
    await this.catalog.deleteCustomFood(userId, key);
    await this.planning.recomputePlans(userId, today).catch(() => undefined);
    return this.state.snapshot(userId, today, true);
  }

  /** Crée ou modifie une recette personnelle, que le moteur dosera comme les autres. */
  @Post('recipes')
  async saveRecipe(@UserId() userId: string, @Body() dto: CustomRecipeDto) {
    try {
      await this.catalog.saveCustomRecipe(userId, dto.recipe);
    } catch (error) {
      throw new UnprocessableEntityException(error instanceof Error ? error.message : 'Recette invalide.');
    }
    return this.state.snapshot(userId, serverToday(), true);
  }

  @Delete('recipes/:id')
  async deleteRecipe(@UserId() userId: string, @Param('id') id: string) {
    await this.catalog.deleteCustomRecipe(userId, id);
    return this.state.snapshot(userId, serverToday(), true);
  }
}

/** Collections contenant des données rattachées à un utilisateur (export et effacement RGPD). */
export const USER_COLLECTIONS = [
  M.NutritionGoal,
  M.MealPlan,
  M.FoodEntry,
  M.WeightEntry,
  M.ActivityEntry,
  M.ShoppingList,
  M.ShoppingSession,
  M.Purchase,
  M.InventoryItem,
  M.Store,
  M.Product,
  M.Barcode,
  M.RetailProduct,
  M.PriceHistory,
  M.PushSubscription,
  M.Food,
  M.Recipe,
] as const;
