/**
 * Données de départ : `npm run seed`
 *
 * 1. (Ré)installe le catalogue commun : aliments, valeurs nutritionnelles, prix ESTIMÉS, modèles de repas.
 * 2. Crée le compte de démonstration (DEMO_EMAIL / DEMO_PASSWORD du fichier .env) avec le profil
 *    du cahier des charges, des stocks d'exemple et un premier programme.
 *
 * `npm run seed:reset` montre ce que contient le compte de démonstration ; il n'est supprimé puis recréé
 * que si l'on confirme explicitement : `npm run seed:reset -w @bouffe/api -- --confirm`.
 */
import 'reflect-metadata';
import { DEMO_INVENTORY, DEMO_LIKED_FOODS, DEMO_MEALS, DEMO_PROFILE, DEMO_STORE, DEMO_TARGET, toISODate } from '@bouffe/core';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { AppModule } from './app.module.js';
import { AuthService } from './auth/auth.module.js';
import { CatalogService } from './catalog/catalog.service.js';
import { config } from './config.js';
import { M, type UserDoc } from './db/schemas.js';
import { PlanningService } from './planning/planning.service.js';
import { ProfileController, USER_COLLECTIONS } from './profile/profile.controller.js';

const logger = { log: (m: string) => console.log(`[seed] ${m}`), warn: (m: string) => console.warn(`[seed] ${m}`) };
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });

const catalog = app.get(CatalogService);
const result = await catalog.seedCatalogue(true);
logger.log(`Catalogue : ${result.foods} aliment(s) et ${result.recipes} modèle(s) de repas installés ou mis à jour.`);

const users = app.get<Model<UserDoc>>(getModelToken(M.User));
if (process.argv.includes('--reset-demo')) {
  const existing = await users.findOne({ email: config.demo.email });
  if (existing && !process.argv.includes('--confirm')) {
    const count = (name: string) => existing.db.model(name).countDocuments({ userId: existing._id });
    logger.warn(
      `Le compte ${config.demo.email} contient ${await count(M.MealPlan)} programme(s), ${await count(M.WeightEntry)} pesée(s), ` +
        `${await count(M.FoodEntry)} aliment(s) déclaré(s) et ${await count(M.Purchase)} course(s). ` +
        'Rien n’a été supprimé. Pour tout effacer et repartir de zéro, relance avec --confirm.',
    );
    await app.close();
    process.exit(0);
  }
  if (existing) {
    for (const name of USER_COLLECTIONS) await existing.db.model(name).deleteMany({ userId: existing._id });
    await existing.db.model(M.RefreshToken).deleteMany({ userId: existing._id });
    await existing.deleteOne();
    logger.log('Compte de démonstration réinitialisé.');
  }
}
if (!config.demo.password) {
  logger.warn('DEMO_PASSWORD absent : compte de démonstration non créé.');
} else if (await users.exists({ email: config.demo.email })) {
  logger.log(`Compte de démonstration déjà présent (${config.demo.email}).`);
} else {
  const today = toISODate(new Date());
  const user = await app.get(AuthService).register({
    email: config.demo.email,
    password: config.demo.password,
    displayName: 'Démo',
    consentHealthData: true,
  });
  await app.get(ProfileController).onboarding(user.id, {
    today,
    profile: {
      sex: DEMO_PROFILE.sex,
      age: DEMO_PROFILE.age,
      heightCm: DEMO_PROFILE.heightCm,
      weightKg: DEMO_PROFILE.startWeightKg,
      goalWeightKg: DEMO_PROFILE.goalWeightKg,
      activity: DEMO_PROFILE.activity,
    },
    target: { kcal: DEMO_TARGET.kcal, protein: DEMO_TARGET.protein, toleranceKcal: DEMO_TARGET.toleranceKcal },
    preferences: {
      likedFoods: DEMO_LIKED_FOODS,
      excludedFoods: [],
      excludedTags: ['legume'],
      meals: DEMO_MEALS,
      level: 'normal',
    },
    store: { name: DEMO_STORE.name, chain: DEMO_STORE.chain },
    consentHealthData: true,
  });
  await catalog.setInventory(user.id, DEMO_INVENTORY);
  await app.get(PlanningService).generate(user.id, { today });
  logger.log(`Compte de démonstration créé : ${config.demo.email} (mot de passe : DEMO_PASSWORD dans apps/api/.env).`);
}

await app.close();
