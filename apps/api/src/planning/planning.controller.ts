import type { AwayMode, Meal, MealStatus, PrepLevel } from '@bouffe/core';
import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
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
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { UserId } from '../common/auth.js';
import { StateService } from '../state/state.service.js';
import { PlanningService, serverToday } from './planning.service.js';

const AWAY = ['none', 'lunch', 'full'];
const LEVELS = ['ultra-rapide', 'normal', 'meal-prep'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class TodayDto {
  /** Date locale de l'appareil (YYYY-MM-DD). */
  @IsOptional()
  @Matches(ISO_DATE)
  today?: string;
}

export class GenerateDto extends TodayDto {
  /** N'importe quel jour de la semaine à générer ; par défaut la semaine en cours. */
  @IsOptional()
  @Matches(ISO_DATE)
  weekStart?: string;

  /** Mode d'absence pour chaque jour, du lundi au dimanche. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(7)
  @ArrayMaxSize(7)
  @IsIn(AWAY, { each: true })
  away?: AwayMode[];

  @IsOptional()
  @IsIn(LEVELS)
  level?: PrepLevel;
}

export class ReplaceMealDto extends TodayDto {
  /** Variante choisie parmi `GET …/alternatives` ; sinon la meilleure alternative est retenue. */
  @IsOptional()
  @IsObject()
  replacement?: Pick<Meal, 'templateId' | 'items'>;
}

export class ReplaceFoodDto extends TodayDto {
  @IsOptional()
  @IsString()
  foodId?: string;
}

export class EatenItemDto {
  @IsString()
  foodId: string;

  @IsNumber()
  @Min(0)
  @Max(5000)
  grams: number;
}

export class LogMealDto extends TodayDto {
  @IsIn(['planned', 'eaten', 'partial', 'replaced', 'skipped'])
  status: MealStatus;

  /** Quantités réellement mangées (statuts `partial` et `replaced`). */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EatenItemDto)
  items?: EatenItemDto[];

  /** Recalculer le reste de la journée pour rester proche de la cible. */
  @IsOptional()
  @IsBoolean()
  rebalance?: boolean;
}

export class FeedbackDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @IsOptional()
  @IsBoolean()
  favorite?: boolean;

  @IsOptional()
  @IsBoolean()
  banned?: boolean;
}

export class RepeatDto extends TodayDto {
  @IsString()
  targetMealId: string;
}

export class LockDto {
  /** `true` pose le cadenas : le repas est conservé quand on régénère la semaine. */
  @IsBoolean()
  locked: boolean;
}

export class SwapDto extends TodayDto {
  @IsString()
  mealId: string;

  @IsString()
  otherMealId: string;
}

export class FreeMealDto extends TodayDto {
  /** Estimation des calories du repas libre. */
  @IsInt()
  @Min(50)
  @Max(6000)
  kcal: number;

  /** Estimation des protéines (g) ; à défaut, 18 % des calories. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(400)
  protein?: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  label?: string;

  /** Lisser l'excédent sur les jours suivants (par défaut : oui). */
  @IsOptional()
  @IsBoolean()
  spread?: boolean;
}

export class AwayDto extends TodayDto {
  @IsIn(AWAY)
  away: AwayMode;
}

@ApiTags('programme')
@ApiBearerAuth()
@Controller('meal-plans')
export class PlanningController {
  constructor(
    private readonly planning: PlanningService,
    private readonly state: StateService,
  ) {}

  private snapshot(userId: string, today?: string) {
    return this.state.snapshot(userId, today ?? serverToday());
  }

  /** Génère (ou régénère) le programme de 7 jours et sa liste de courses. */
  @Post('generate')
  async generate(@UserId() userId: string, @Body() dto: GenerateDto) {
    const today = dto.today ?? serverToday();
    await this.planning.generate(userId, { ...dto, today });
    return this.snapshot(userId, today);
  }

  /** Historique des semaines. */
  @Get()
  history(@UserId() userId: string) {
    return this.planning.history(userId);
  }

  @Get(':id')
  get(@UserId() userId: string, @Param('id') id: string) {
    return this.planning.get(userId, id);
  }

  /** Trois variantes équivalentes pour un repas. */
  @Get(':id/meals/:mealId/alternatives')
  alternatives(@UserId() userId: string, @Param('id') id: string, @Param('mealId') mealId: string) {
    return this.planning.alternatives(userId, id, mealId);
  }

  /** « Je n'aime pas ce repas → Générer une alternative ». */
  @Post(':id/meals/:mealId/replace')
  async replaceMeal(@UserId() userId: string, @Param('id') id: string, @Param('mealId') mealId: string, @Body() dto: ReplaceMealDto) {
    await this.planning.replaceMeal(userId, id, mealId, dto.replacement, dto.today ?? serverToday());
    return this.snapshot(userId, dto.today);
  }

  /** Aliments pouvant remplacer un ingrédient, avec le repas recalculé pour chacun. */
  @Get(':id/meals/:mealId/items/:slotKey/alternatives')
  foodAlternatives(@UserId() userId: string, @Param('id') id: string, @Param('mealId') mealId: string, @Param('slotKey') slotKey: string) {
    return this.planning.foodAlternatives(userId, id, mealId, slotKey);
  }

  /** « Remplacer uniquement cet aliment ». */
  @Post(':id/meals/:mealId/items/:slotKey/replace')
  async replaceFood(
    @UserId() userId: string,
    @Param('id') id: string,
    @Param('mealId') mealId: string,
    @Param('slotKey') slotKey: string,
    @Body() dto: ReplaceFoodDto,
  ) {
    await this.planning.replaceFood(userId, id, mealId, slotKey, dto.foodId, dto.today ?? serverToday());
    return this.snapshot(userId, dto.today);
  }

  /** Déclare ce qui a réellement été mangé (mangé / partiel / remplacé / sauté), ou annule. */
  @Post(':id/meals/:mealId/log')
  async log(@UserId() userId: string, @Param('id') id: string, @Param('mealId') mealId: string, @Body() dto: LogMealDto) {
    await this.planning.logMeal(userId, id, mealId, dto, dto.today ?? serverToday());
    return this.snapshot(userId, dto.today);
  }

  @Delete(':id/meals/:mealId/log')
  async unlog(@UserId() userId: string, @Param('id') id: string, @Param('mealId') mealId: string, @Query() query: TodayDto) {
    await this.planning.logMeal(userId, id, mealId, { status: 'planned' }, query.today ?? serverToday());
    return this.snapshot(userId, query.today);
  }

  /** Note, favori ou interdiction d'un repas (pris en compte aux prochaines générations). */
  @Post(':id/meals/:mealId/feedback')
  async feedback(@UserId() userId: string, @Param('id') id: string, @Param('mealId') mealId: string, @Body() dto: FeedbackDto) {
    await this.planning.feedback(userId, id, mealId, dto);
    return this.snapshot(userId);
  }

  /** Répète un repas aimé à la place d'un autre repas du programme. */
  @Post(':id/meals/:mealId/repeat')
  async repeat(@UserId() userId: string, @Param('id') id: string, @Param('mealId') mealId: string, @Body() dto: RepeatDto) {
    await this.planning.repeat(userId, id, mealId, dto.targetMealId, dto.today ?? serverToday());
    return this.snapshot(userId, dto.today);
  }

  /** Pose ou retire le cadenas d'un repas (conservé à la prochaine régénération). */
  @Post(':id/meals/:mealId/lock')
  async lock(@UserId() userId: string, @Param('id') id: string, @Param('mealId') mealId: string, @Body() dto: LockDto) {
    await this.planning.setLocked(userId, id, mealId, dto.locked);
    return this.snapshot(userId);
  }

  /** Échange deux repas du programme, puis rééquilibre les deux journées. */
  @Post(':id/swap')
  async swap(@UserId() userId: string, @Param('id') id: string, @Body() dto: SwapDto) {
    await this.planning.swap(userId, id, dto.mealId, dto.otherMealId, dto.today ?? serverToday());
    return this.snapshot(userId, dto.today);
  }

  /**
   * Déclare un repas libre (restaurant, soirée…) à partir d'une estimation de calories.
   * L'excédent est lissé sur les jours suivants, au plus 150 kcal par jour et jamais sous le plancher.
   */
  @Post(':id/meals/:mealId/free')
  async free(@UserId() userId: string, @Param('id') id: string, @Param('mealId') mealId: string, @Body() dto: FreeMealDto) {
    const report = await this.planning.freeMeal(userId, id, mealId, dto, dto.today ?? serverToday());
    return { report, state: await this.snapshot(userId, dto.today) };
  }

  /** Mode recette d'un repas : ingrédients exacts, étapes, temps. */
  @Get(':id/meals/:mealId/recipe')
  recipe(@UserId() userId: string, @Param('id') id: string, @Param('mealId') mealId: string, @Query('level') level?: PrepLevel) {
    return this.planning.recipe(userId, id, mealId, LEVELS.includes(level ?? '') ? level : undefined);
  }

  /** Recalcule le reste d'une journée à partir de ce qui a réellement été mangé. */
  @Post(':id/days/:dayIndex/rebalance')
  async rebalance(@UserId() userId: string, @Param('id') id: string, @Param('dayIndex', ParseIntPipe) dayIndex: number, @Body() dto: TodayDto) {
    await this.planning.rebalance(userId, id, dayIndex, dto.today ?? serverToday());
    return this.snapshot(userId, dto.today);
  }

  /** Déclare un jour hors domicile (ou l'annule) et régénère ses repas. */
  @Patch(':id/days/:dayIndex')
  async setAway(@UserId() userId: string, @Param('id') id: string, @Param('dayIndex', ParseIntPipe) dayIndex: number, @Body() dto: AwayDto) {
    await this.planning.setAway(userId, id, dayIndex, dto.away, dto.today ?? serverToday());
    return this.snapshot(userId, dto.today);
  }

  /** « Préparer mes repas pour N jours ». */
  @Get(':id/meal-prep')
  mealPrep(
    @UserId() userId: string,
    @Param('id') id: string,
    @Query('from', new ParseIntPipe({ optional: true })) from = 0,
    @Query('days', new ParseIntPipe({ optional: true })) days = 3,
  ) {
    return this.planning.mealPrep(userId, id, from, Math.min(7, Math.max(1, days)));
  }
}
