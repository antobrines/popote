/**
 * Configuration lue depuis l'environnement (fichier `.env` en développement,
 * variables injectées par Docker / l'hébergeur en production).
 */
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`);
  return value;
}

const env = process.env.NODE_ENV ?? 'development';
const accessSecret = required('JWT_ACCESS_SECRET');
if (env === 'production' && accessSecret.length < 32) {
  throw new Error('JWT_ACCESS_SECRET doit contenir au moins 32 caractères en production.');
}

/**
 * Qui peut créer un compte ?
 * - `invite` : il faut un code d'invitation (SIGNUP_CODE), à glisser dans le lien d'inscription ;
 * - `open`   : tout le monde (ALLOW_SIGNUP différent de `false`, sans code) ;
 * - `closed` : personne (ALLOW_SIGNUP=false, sans code).
 */
export type SignupMode = 'open' | 'invite' | 'closed';

const signupCode = (process.env.SIGNUP_CODE ?? '').trim();
if (signupCode && signupCode.length < 8) {
  throw new Error("SIGNUP_CODE doit contenir au moins 8 caractères : c'est lui qui protège la création de comptes.");
}
const signupMode: SignupMode = signupCode ? 'invite' : process.env.ALLOW_SIGNUP !== 'false' ? 'open' : 'closed';

export const config = {
  env,
  isProd: env === 'production',
  port: Number(process.env.PORT ?? 3000),
  /**
   * Nombre de reverse proxies devant l'API, pour retrouver l'adresse réelle du client (limitation
   * de débit). 1 derrière nginx seul ; 2 derrière Traefik puis nginx (Dokploy).
   */
  trustProxy: Number(process.env.TRUST_PROXY ?? 1),
  /** Création de comptes : ouverte, sur invitation ou fermée (voir `SignupMode`). */
  signupMode,
  /** Code d'invitation attendu en mode `invite`. */
  signupCode,
  /** Documentation OpenAPI sur /api/docs : toujours en développement, sur demande en production. */
  apiDocs: process.env.API_DOCS ? process.env.API_DOCS === 'true' : env !== 'production',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:4200').split(',').map((o) => o.trim()),
  mongo: {
    uri: required('MONGODB_URI'),
    dbName: process.env.MONGODB_DB ?? 'bouffe',
  },
  auth: {
    accessSecret,
    accessTtlSeconds: Number(process.env.JWT_ACCESS_TTL ?? 900),
    refreshTtlDays: Number(process.env.REFRESH_TTL_DAYS ?? 30),
    cookieSecure: process.env.COOKIE_SECURE === 'true',
    cookieName: 'bouffe_rt',
  },
  openFoodFacts: {
    enabled: process.env.OFF_ENABLED !== 'false',
    userAgent: process.env.OFF_USER_AGENT ?? 'Popote/0.1 (application personnelle)',
  },
  retailProvider: (process.env.RETAIL_PROVIDER ?? 'manual') as 'manual' | 'mock',
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY ?? '',
    privateKey: process.env.VAPID_PRIVATE_KEY ?? '',
    subject: process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com',
  },
  demo: {
    email: process.env.DEMO_EMAIL ?? 'demo@bouffe.local',
    password: process.env.DEMO_PASSWORD ?? '',
  },
} as const;
