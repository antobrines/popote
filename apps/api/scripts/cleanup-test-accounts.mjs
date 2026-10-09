/**
 * Comptes de test restés en base après un test interrompu (Ctrl-C, coupure réseau…).
 *
 *   npm run test:cleanup -w @bouffe/api                liste les comptes concernés, sans rien toucher
 *   npm run test:cleanup -w @bouffe/api -- --confirm   les supprime, avec toutes leurs données
 *
 * Ne concerne que les adresses fabriquées par les scripts de test (`smoke-<horodatage>@bouffe.test`,
 * `ui-<horodatage>@bouffe.test`) : aucun vrai compte ne peut porter une telle adresse.
 * À lancer après `npm run build:api`.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { AppModule } from '../dist/app.module.js';
import { M } from '../dist/db/schemas.js';
import { USER_COLLECTIONS } from '../dist/profile/profile.controller.js';

const TEST_ADDRESS = /^(smoke|ui)-\d{10,}@bouffe\.test$/;

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
const users = app.get(getModelToken(M.User));
const accounts = (await users.find({ email: /@bouffe\.test$/ })).filter((user) => TEST_ADDRESS.test(user.email));

if (accounts.length === 0) {
  console.log('Aucun compte de test en base.');
} else if (!process.argv.includes('--confirm')) {
  for (const user of accounts) console.log(`${user.email} — créé le ${user.createdAt?.toISOString?.() ?? 'date inconnue'}`);
  console.log(`${accounts.length} compte(s) de test. Rien n'a été supprimé : relance avec --confirm pour les effacer.`);
} else {
  for (const user of accounts) {
    // Même effacement que « Supprimer mon compte » dans l'application.
    for (const name of USER_COLLECTIONS) await user.db.model(name).deleteMany({ userId: user._id });
    await user.db.model(M.RefreshToken).deleteMany({ userId: user._id });
    await user.deleteOne();
    console.log(`Supprimé : ${user.email}`);
  }
}

await app.close();
