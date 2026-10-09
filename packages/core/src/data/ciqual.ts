/**
 * Valeurs nutritionnelles de référence du catalogue, issues de la table Ciqual (Anses).
 *
 * FICHIER GÉNÉRÉ par `npm run ciqual -w @bouffe/core` (scripts/import-ciqual.mjs) — ne pas modifier
 * à la main : changer la correspondance dans le script, puis relancer l'import.
 *
 * Source : Table de composition nutritionnelle des aliments Ciqual 2020, Anses, version du 2020-07-07.
 * https://ciqual.anses.fr/ — Licence Ouverte / Open Licence (Etalab).
 * Valeurs pour 100 g de produit tel qu'acheté (cru pour les viandes, poissons et féculents).
 * Protéines : azote × 6,25, comme sur les étiquettes.
 */
import type { Nutrients } from '../types.js';

export const CIQUAL_SOURCE = {
  name: 'Table de composition nutritionnelle des aliments Ciqual 2020',
  publisher: 'Anses',
  version: '2020-07-07',
  license: 'Licence Ouverte / Open Licence (Etalab)',
  url: 'https://ciqual.anses.fr/',
} as const;

export interface CiqualValue {
  /** Code de l'aliment de référence dans la table. */
  code: string;
  /** Libellé officiel de cet aliment. */
  label: string;
  per100: Nutrients;
  /**
   * La table ne donne pas l'énergie de cet aliment : elle est calculée à partir de ses
   * macronutriments, avec les coefficients du règlement (UE) n° 1169/2011.
   */
  energyComputed?: true;
  /** Écart connu entre l'aliment du catalogue et l'aliment de référence. */
  note?: string;
}

/** Aliment du catalogue → valeurs de la table. */
export const CIQUAL_VALUES: Record<string, CiqualValue> = {
  poulet: { code: '36017', label: 'Poulet, filet, sans peau, cru', per100: { kcal: 110, protein: 23.4, carbs: 0, fat: 1.5, fiber: 0 } },
  dinde: { code: '36304', label: 'Dinde, escalope, crue', per100: { kcal: 109, protein: 24.1, carbs: 0.5, fat: 1.2, fiber: 0 } },
  'steak-hache-5': { code: '6250', label: 'Boeuf, steak haché 5% MG, cru', per100: { kcal: 130, protein: 21.9, carbs: 0.3, fat: 4.6, fiber: 0 } },
  rumsteck: { code: '6206', label: 'Boeuf, rumsteck, cru', per100: { kcal: 114, protein: 22.5, carbs: 0.4, fat: 2.5, fiber: 0 } },
  'haut-de-cuisse-poulet': { code: '36019', label: 'Poulet, haut de cuisse, viande, cru', per100: { kcal: 116, protein: 19.7, carbs: 0, fat: 4.1, fiber: 0 }, note: 'Viande seule, sans la peau.' },
  oeufs: { code: '22000', label: 'Oeuf, cru', per100: { kcal: 140, protein: 12.7, carbs: 0.3, fat: 9.8, fiber: 0 } },
  saumon: { code: '26036', label: 'Saumon, cru, élevage', per100: { kcal: 194, protein: 20.5, carbs: 0, fat: 12.4, fiber: 0 } },
  'poisson-blanc': { code: '26043', label: 'Cabillaud, cru', per100: { kcal: 78, protein: 18.1, carbs: 0, fat: 0.6, fiber: 0 } },
  thon: { code: '26039', label: 'Thon, au naturel, appertisé, égoutté', per100: { kcal: 111, protein: 26.8, carbs: 0, fat: 0.4, fiber: 0 } },
  'blanc-poulet-tranches': { code: '28963', label: 'Jambon de poulet ou Blanc de poulet en tranche', per100: { kcal: 106, protein: 20.7, carbs: 1.4, fat: 1.8, fiber: 0.5 } },
  'allumettes-poulet': { code: '28929', label: 'Dés, allumettes, râpé ou haché de jambon de volaille', per100: { kcal: 132, protein: 18, carbs: 1.6, fat: 5.9, fiber: 0.5 } },
  riz: { code: '9119', label: 'Riz thaï ou basmati, cru', per100: { kcal: 353, protein: 8.1, carbs: 77.8, fat: 0.8, fiber: 0.9 } },
  pates: { code: '9810', label: 'Pâtes sèches standard, crues', per100: { kcal: 336, protein: 12.6, carbs: 65.8, fat: 1.8, fiber: 3 } },
  'pates-completes': { code: '9870', label: 'Pâtes sèches, au blé complet, crues', per100: { kcal: 353, protein: 12.6, carbs: 67.6, fat: 2.2, fiber: 6.1 } },
  semoule: { code: '9681', label: 'Graine de couscous (semoule de blé dur précuite), crue', per100: { kcal: 365, protein: 13.2, carbs: 72.7, fat: 1.5, fiber: 4.3 } },
  'pommes-de-terre': { code: '4008', label: 'Pomme de terre, sans peau, crue', per100: { kcal: 81, protein: 2.2, carbs: 16.2, fat: 0.2, fiber: 1.8 } },
  gnocchis: { code: '26264', label: 'Gnocchi à la pomme de terre, cru', per100: { kcal: 176, protein: 4.7, carbs: 35, fat: 1.4, fiber: 2.2 } },
  'pain-complet': { code: '7111', label: 'Pain de mie, complet', per100: { kcal: 262, protein: 9.3, carbs: 43.7, fat: 4.1, fiber: 6.2 } },
  'pain-burger': { code: '7262', label: 'Pain pour hamburger ou hot dog (bun), complet, préemballé', per100: { kcal: 285, protein: 9.8, carbs: 46.3, fat: 5.8, fiber: 4.8 } },
  wrap: { code: '7815', label: 'Tortilla souple (à garnir), à base de blé', per100: { kcal: 327, protein: 9.2, carbs: 52.1, fat: 8.2, fiber: 3.9 }, note: 'Tortilla de blé : la table ne distingue pas la version au blé complet.' },
  chapelure: { code: '7500', label: 'Chapelure', per100: { kcal: 374, protein: 12.7, carbs: 70, fat: 3.8, fiber: 4.5 } },
  'flocons-avoine': { code: '9311', label: "Flocon d'avoine", per100: { kcal: 367, protein: 14.2, carbs: 57.9, fat: 6.5, fiber: 10.2 } },
  'fromage-blanc': { code: '19644', label: 'Fromage blanc nature, 0% MG', per100: { kcal: 49, protein: 7.8, carbs: 3.9, fat: 0, fiber: 0 } },
  lait: { code: '19041', label: 'Lait demi-écrémé, UHT', per100: { kcal: 47, protein: 3.3, carbs: 4.8, fat: 1.6, fiber: 0 } },
  beurre: { code: '16400', label: 'Beurre à 82% MG, doux', per100: { kcal: 753, protein: 0.7, carbs: 0.9, fat: 82.9, fiber: 0 } },
  parmesan: { code: '12120', label: 'Parmesan', per100: { kcal: 406, protein: 30.5, carbs: 0, fat: 31, fiber: 0 } },
  emmental: { code: '12118', label: 'Emmental ou emmenthal râpé', per100: { kcal: 367, protein: 27.5, carbs: 0, fat: 28.6, fiber: 0 } },
  mozzarella: { code: '19590', label: 'Mozzarella au lait de vache', per100: { kcal: 227, protein: 16.1, carbs: 0.8, fat: 17.7, fiber: 0 } },
  cheddar: { code: '12726', label: 'Cheddar', per100: { kcal: 399, protein: 23.6, carbs: 0, fat: 33.8, fiber: 0 } },
  'creme-legere': { code: '19431', label: 'Crème de lait, 15 à 20% MG, légère, épaisse, rayon frais', per100: { kcal: 166, protein: 2.8, carbs: 3, fat: 15.3, fiber: 0 } },
  banane: { code: '13005', label: 'Banane, pulpe, crue', per100: { kcal: 91, protein: 1.1, carbs: 19.7, fat: 0.3, fiber: 2.7 } },
  pomme: { code: '13039', label: 'Pomme, pulpe et peau, crue', per100: { kcal: 54, protein: 0.3, carbs: 11.6, fat: 0.3, fiber: 1.4 }, energyComputed: true },
  clementine: { code: '13024', label: 'Clémentine ou Mandarine, pulpe, crue', per100: { kcal: 47, protein: 0.8, carbs: 9.2, fat: 0.3, fiber: 1.7 } },
  kiwi: { code: '13021', label: 'Kiwi, pulpe et graines, cru', per100: { kcal: 61, protein: 0.9, carbs: 11, fat: 0.6, fiber: 2.4 } },
  poire: { code: '13037', label: 'Poire, pulpe et peau, crue', per100: { kcal: 58, protein: 0.5, carbs: 10.9, fat: 0.3, fiber: 2.9 }, energyComputed: true },
  'fruits-rouges': { code: '13997', label: 'Fruits rouges, crus (framboises, fraises, groseilles, cassis)', per100: { kcal: 49, protein: 1.1, carbs: 7.9, fat: 0.3, fiber: 5.3 }, energyComputed: true, note: 'Mélange de fruits rouges crus (framboises, fraises, groseilles, cassis).' },
  compote: { code: '13153', label: 'Purée de fruits, tout type de fruits, type "compote sans sucres ajoutés"', per100: { kcal: 59, protein: 0.3, carbs: 13.4, fat: 0.2, fiber: 1.7 } },
  'compote-gourde': { code: '13153', label: 'Purée de fruits, tout type de fruits, type "compote sans sucres ajoutés"', per100: { kcal: 59, protein: 0.3, carbs: 13.4, fat: 0.2, fiber: 1.7 } },
  'huile-olive': { code: '17270', label: "Huile d'olive vierge extra", per100: { kcal: 900, protein: 0.3, carbs: 0, fat: 99.9, fiber: 0 } },
  'sauce-tomate': { code: '20260', label: 'Tomate, coulis, appertisé (purée de tomates mi-réduite à 11%)', per100: { kcal: 49, protein: 2.1, carbs: 8.5, fat: 0.2, fiber: 2.6 }, energyComputed: true },
  'sauce-soja': { code: '11104', label: 'Sauce soja, préemballée', per100: { kcal: 46, protein: 7.1, carbs: 3.6, fat: 0.1, fiber: 0.9 } },
  ketchup: { code: '11008', label: 'Ketchup, préemballé', per100: { kcal: 99, protein: 1.3, carbs: 21.4, fat: 0.2, fiber: 1.2 } },
  moutarde: { code: '11013', label: 'Moutarde', per100: { kcal: 152, protein: 6.9, carbs: 4.3, fat: 11.2, fiber: 0 } },
  pesto: { code: '11179', label: 'Sauce pesto, préemballée', per100: { kcal: 370, protein: 3.9, carbs: 6.6, fat: 35.4, fiber: 2.5 } },
  miel: { code: '31008', label: 'Miel', per100: { kcal: 329, protein: 0.6, carbs: 81.7, fat: 0, fiber: 0 }, energyComputed: true },
  amandes: { code: '15000', label: 'Amande (avec peau)', per100: { kcal: 615, protein: 22.6, carbs: 9.5, fat: 51.3, fiber: 12.5 }, energyComputed: true },
  noix: { code: '15005', label: 'Noix, séchée, cerneaux', per100: { kcal: 709, protein: 15.7, carbs: 6.9, fat: 67.3, fiber: 6.7 }, energyComputed: true },
  'beurre-cacahuete': { code: '15202', label: "Beurre de cacahuète ou Pâte d'arachide", per100: { kcal: 649, protein: 25.4, carbs: 16.1, fat: 52.5, fiber: 5 }, energyComputed: true },
  'paprika-fume': { code: '11049', label: 'Paprika', per100: { kcal: 319, protein: 14.1, carbs: 19.1, fat: 12.9, fiber: 34.9 }, note: 'Paprika : la table ne distingue pas la version fumée.' },
  'curry-poudre': { code: '11005', label: 'Curry, poudre', per100: { kcal: 301, protein: 14.5, carbs: 2.6, fat: 14, fiber: 53.2 } },
  'herbes-provence': { code: '11060', label: 'Herbes de Provence, séchées', per100: { kcal: 283, protein: 11.5, carbs: 23, fat: 7.2, fiber: 40.1 } },
  'jus-citron': { code: '2028', label: 'Jus de citron, pur jus', per100: { kcal: 29, protein: 0.4, carbs: 6.1, fat: 0.3, fiber: 0.4 }, energyComputed: true },
};

/**
 * Aliments du catalogue sans équivalent dans la table : ils gardent une valeur moyenne relevée sur
 * des étiquettes, à remplacer par celle de ton produit (« Mes vrais produits »).
 */
export const CIQUAL_MISSING: Record<string, string> = {
  skyr: 'Absent de la table Ciqual 2020.',
  'boisson-proteinee': 'Produit de marque, absent de la table.',
  whey: 'Complément alimentaire, absent de la table.',
  'barre-proteinee': 'Produit de marque, absent de la table.',
  'fromage-frais': 'La table ne contient pas de fromage à tartiner allégé.',
  'poulet-roti-eminces': 'La table ne contient que du poulet rôti entier, avec la peau.',
  'epices-cajun': "Mélange d'épices, absent de la table.",
  'epices-tex-mex': "Mélange d'épices, absent de la table.",
  'epices-tandoori': "Mélange d'épices, absent de la table.",
  'ail-persil': "Mélange, absent de la table : moyenne de l'ail séché et du persil séché qui y figurent.",
};
