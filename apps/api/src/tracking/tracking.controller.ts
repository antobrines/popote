/**
 * Suivi : repas hors programme, pesées, activité physique.
 * Les données de poids et d'activité sont des données de santé : elles ne sont enregistrées
 * que si l'utilisateur y a explicitement consenti.
 */
import { type MealSlotKind, indexFoods, nutrientsFor, snapshotNutrients } from '@bouffe/core';
import { BadRequestException, Body, Controller, Delete, ForbiddenException, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import type { Model } from 'mongoose';
import { CatalogService } from '../catalog/catalog.service.js';
import { UserId } from '../common/auth.js';
import { type ActivityEntryDoc, type FoodEntryDoc, M, type WeightEntryDoc } from '../db/schemas.js';
import { TodayDto } from '../planning/planning.controller.js';
import { serverToday } from '../planning/planning.service.js';
import { StateService } from '../state/state.service.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ManualEntryDto extends TodayDto {
  @Matches(ISO_DATE)
  date: string;

  @IsIn(['petit-dejeuner', 'dejeuner', 'collation', 'diner'])
  slot: MealSlotKind;

  @IsString()
  foodId: string;

  @IsNumber()
  @Min(1)
  @Max(5000)
  grams: number;
}

export class WeightDto extends TodayDto {
  @IsNumber()
  @Min(20)
  @Max(400)
  kg: number;

  @IsOptional()
  @IsIn(['manual', 'health-connect'])
  source?: string;
}

export class WorkoutDto {
  @IsString()
  @MaxLength(60)
  kind: string;

  @IsInt()
  @Min(1)
  @Max(1440)
  minutes: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  kcal?: number;
}

export class ActivityDto extends TodayDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(200_000)
  steps?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(20_000)
  activeKcal?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  sleepMinutes?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => WorkoutDto)
  workouts?: WorkoutDto[];
}

export class ActivityRecordDto extends ActivityDto {
  @Matches(ISO_DATE)
  date: string;
}

export class ActivityImportDto {
  /** Origine des relevés, par exemple `health-connect`. */
  @IsString()
  @MaxLength(40)
  source: string;

  @IsArray()
  @ArrayMaxSize(400)
  @ValidateNested({ each: true })
  @Type(() => ActivityRecordDto)
  records: ActivityRecordDto[];
}

@ApiTags('suivi')
@ApiBearerAuth()
@Controller()
export class TrackingController {
  constructor(
    @InjectModel(M.FoodEntry) private readonly entries: Model<FoodEntryDoc>,
    @InjectModel(M.WeightEntry) private readonly weights: Model<WeightEntryDoc>,
    @InjectModel(M.ActivityEntry) private readonly activities: Model<ActivityEntryDoc>,
    private readonly catalog: CatalogService,
    private readonly state: StateService,
  ) {}

  private async requireHealthConsent(userId: string): Promise<void> {
    const user = await this.catalog.user(userId);
    if (!user.consents?.healthData) {
      throw new ForbiddenException("Active d'abord le suivi du poids et de l'activité dans ton profil (consentement requis).");
    }
  }

  /** Ajoute un aliment mangé en dehors du programme. */
  @Post('entries')
  async addEntry(@UserId() userId: string, @Body() dto: ManualEntryDto) {
    const food = indexFoods(await this.catalog.foods(userId)).get(dto.foodId);
    if (!food) throw new BadRequestException('Aliment inconnu.');
    await this.entries.create({
      userId,
      date: dto.date,
      slot: dto.slot,
      foodKey: food.id,
      name: food.name,
      grams: dto.grams,
      nutrition: snapshotNutrients(nutrientsFor(food, dto.grams)),
      source: 'manual',
    });
    return this.state.snapshot(userId, dto.today ?? serverToday());
  }

  @Delete('entries/:id')
  async deleteEntry(@UserId() userId: string, @Param('id') id: string, @Query() query: TodayDto) {
    const result = await this.entries.deleteOne({ _id: id, userId, source: 'manual' });
    if (result.deletedCount === 0) throw new NotFoundException('Entrée introuvable.');
    return this.state.snapshot(userId, query.today ?? serverToday());
  }

  /** Enregistre la pesée d'un jour (une par jour ; une nouvelle saisie remplace la précédente). */
  @Put('weights/:date')
  async setWeight(@UserId() userId: string, @Param('date') date: string, @Body() dto: WeightDto) {
    if (!ISO_DATE.test(date)) throw new BadRequestException('Date invalide.');
    await this.requireHealthConsent(userId);
    await this.weights.updateOne({ userId, date }, { $set: { kg: Math.round(dto.kg * 10) / 10, source: dto.source ?? 'manual' } }, { upsert: true });
    return this.state.snapshot(userId, dto.today ?? serverToday());
  }

  @Delete('weights/:date')
  async deleteWeight(@UserId() userId: string, @Param('date') date: string, @Query() query: TodayDto) {
    await this.weights.deleteOne({ userId, date });
    return this.state.snapshot(userId, query.today ?? serverToday());
  }

  /** Saisie manuelle de l'activité d'un jour : pas, calories actives, entraînements, sommeil. */
  @Put('activities/:date')
  async setActivity(@UserId() userId: string, @Param('date') date: string, @Body() dto: ActivityDto) {
    if (!ISO_DATE.test(date)) throw new BadRequestException('Date invalide.');
    await this.requireHealthConsent(userId);
    const { today, ...data } = dto;
    await this.activities.updateOne({ userId, date, source: 'manual' }, { $set: data }, { upsert: true });
    return this.state.snapshot(userId, today ?? serverToday());
  }

  /**
   * Import par lot de relevés d'activité, prévu pour une future application Android
   * (Capacitor + Health Connect). Idempotent : un relevé par jour et par source.
   */
  @Post('activities/import')
  async importActivities(@UserId() userId: string, @Body() dto: ActivityImportDto) {
    await this.requireHealthConsent(userId);
    if (dto.records.length > 0) {
      await this.activities.bulkWrite(
        dto.records.map(({ date, today: _today, ...data }) => ({
          updateOne: { filter: { userId, date, source: dto.source }, update: { $set: data }, upsert: true },
        })) as never,
      );
    }
    return { imported: dto.records.length };
  }
}
