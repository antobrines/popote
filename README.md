# Popote

PWA de nutrition, de perte de poids et de courses automatisées.

> Le nom affiché est « Popote » (constante `APP_NAME` du cœur métier, `index.html` et manifeste de la PWA). Les identifiants techniques — dossier, paquets `@bouffe/*`, base `bouffe` — gardent le nom de travail d'origine : les changer ne servirait qu'à casser les données existantes.

> « Dis-moi exactement quoi manger cette semaine, en quelles quantités, puis transforme ce programme en liste de courses. »

Chaque semaine, l'application génère 7 jours de repas au gramme près (≈ 2 300 kcal, hyperprotéiné, selon tes préférences), puis calcule la liste de courses : besoins − stocks → conditionnements → coût. Elle suit ce que tu manges réellement, tes stocks, ton poids, et fonctionne hors ligne en magasin, scan de codes-barres compris.

Au quotidien : vue de la semaine entière (garder un repas, en échanger deux), gestes rapides sur les cartes (glisser pour « mangé » ou « remplacer »), mode cuisine plein écran avec minuteurs, repas libre lissé sur les jours suivants, jours d'entraînement, « cuisiner une fois, manger deux fois », tes propres recettes, les valeurs de tes vrais produits, et un bilan chaque fin de semaine.

Cette application ne fournit pas d'avis médical. Elle signale les limites d'un régime (fibres, absence de légumes) et renvoie vers un professionnel de santé quand c'est pertinent.

---

## Démarrage rapide

Prérequis : Node.js ≥ 22, npm ≥ 10, une base MongoDB (Atlas ou locale).

```bash
npm install
```

```bash
cp apps/api/.env.example apps/api/.env
```

Renseigne dans `apps/api/.env` au minimum `MONGODB_URI`, `JWT_ACCESS_SECRET` (`openssl rand -hex 48`) et `DEMO_PASSWORD`. Sans MongoDB sous la main : `docker compose -f docker-compose.dev.yml up -d` puis `MONGODB_URI=mongodb://localhost:27017`.

```bash
npm run seed
```

Le seed installe le catalogue (63 aliments, 58 modèles de repas) et crée le compte de démonstration (profil du cahier des charges : homme, 27 ans, 184 cm, 116 kg → 90 kg, 2 300 kcal, sans légumes, stocks d'exemple, première semaine générée). Identifiants : `DEMO_EMAIL` / `DEMO_PASSWORD` de `apps/api/.env`.

Dans deux terminaux :

```bash
npm run dev:api
```

```bash
npm run dev:web
```

- Application : http://localhost:4200
- API : http://localhost:3000/api — documentation OpenAPI : http://localhost:3000/api/docs

Tu peux aussi créer ton propre compte sur http://localhost:4200/inscription (lien « Créer un compte » de l'écran de connexion) : le parcours d'accueil (taille → poids → objectif → activité → calories → aliments → repas → jours hors domicile → magasin → budget) se termine par « Créer ma semaine ».

### Scripts

| Commande | Effet |
| --- | --- |
| `npm test` | Tests unitaires des calculs critiques (130 tests, Vitest) |
| `npm run dev:api` / `npm run dev:web` | API et PWA en développement |
| `npm run build` | Build de production (cœur, API, PWA avec service worker) |
| `npm run seed` | Catalogue + compte de démonstration |
| `npm run seed:reset -w @bouffe/api` | Montre le contenu du compte de démonstration ; ajouter `-- --confirm` pour l'effacer et le recréer |
| `npm run smoke -w @bouffe/api` | Test de bout en bout de l'API en cours d'exécution (72 vérifications), sur un compte temporaire créé puis supprimé |
| `npm run test:cleanup -w @bouffe/api` | Liste les comptes de test restés en base après un test interrompu ; `-- --confirm` les supprime |
| `npm run ciqual -w @bouffe/core` | Régénère les valeurs nutritionnelles du catalogue depuis la table Ciqual de l'Anses |

### Docker

```bash
cp .env.example .env
```

Renseigne `JWT_ACCESS_SECRET`, puis :

```bash
docker compose --profile local-db up --build
```

L'application est servie sur http://localhost:8080 (nginx sert la PWA et relaie `/api`). Pour utiliser Atlas plutôt que le MongoDB du conteneur, renseigne `MONGODB_URI` dans `.env` et lance `docker compose up --build` sans profil.

### Mise en ligne (Dokploy)

La marche à suivre complète est dans [DEPLOY.md](DEPLOY.md) : un service « Docker Compose » pointant sur [docker-compose.dokploy.yml](docker-compose.dokploy.yml), les variables de [dokploy.env.example](dokploy.env.example), et le domaine réglé dans l'onglet Domains (Traefik et Let's Encrypt). En production :

- HTTPS obligatoire (PWA, caméra, cookie de session) : `COOKIE_SECURE=true` ;
- la création de comptes (`/inscription`) est fermée par défaut (`ALLOW_SIGNUP=false`) ; `SIGNUP_CODE` l'ouvre aux seules personnes qui ont le lien d'invitation `…/inscription?code=<code>` ;
- `API_DOCS` masque la documentation de l'API ;
- `TRUST_PROXY` indique le nombre de proxies devant l'API, pour que la limitation de débit voie l'adresse réelle de chaque client ;
- au démarrage, le catalogue commun est aligné sur celui du code déployé : aucune commande à lancer après une mise à jour.

---

## Architecture

```
bouffe/
├── packages/core/          Cœur métier en TypeScript pur — aucun accès réseau, DOM ou base
│   ├── src/nutrition.ts        Service de nutrition (tous les calculs kcal / macros)
│   ├── src/planner/            Solveur de quantités, générateur de menus, recettes, meal prep, alertes
│   ├── src/shopping/           Prix et conditionnements, liste, session en magasin, correspondance des
│   │                           produits scannés, résolveurs de codes-barres, habitudes d'achat
│   ├── src/inventory.ts        Stocks
│   ├── src/weight.ts           Moyenne mobile, tendance, suggestion d'ajustement
│   ├── src/data/               Catalogue de départ : aliments, modèles de repas, profil de démonstration ;
│   │                           `ciqual.ts` (généré) : valeurs nutritionnelles de la table Ciqual
│   ├── scripts/                Import de la table Ciqual
│   └── test/                   Tests unitaires
├── apps/api/               API REST — NestJS 12, Mongoose 9, OpenAPI
│   └── src/
│       ├── auth/               Email + mot de passe, access token court, refresh en rotation
│       ├── catalog/            Aliments, magasins, prix ; RetailProvider et ProductResolver
│       ├── planning/           Programme : génération, remplacements, prévu / réel
│       ├── shopping/           Liste, sessions de courses, achats, habitudes, stocks
│       ├── tracking/           Repas hors programme, poids, activité
│       ├── profile/            Profil, objectif, export et effacement RGPD
│       ├── push/               Notifications push (VAPID) et rappels planifiés
│       ├── state/              État agrégé renvoyé à la PWA
│       └── db/schemas.ts       Schéma MongoDB
└── apps/web/               PWA — Angular 22 (Signals, zoneless, composants autonomes), Tailwind 4
    └── src/app/
        ├── core/               API, cache IndexedDB, file hors ligne, scanner, session de courses
        ├── ui/                 Icônes, anneaux, feuilles modales, formats
        └── pages/              Aujourd'hui, Programme (jour / semaine), Mode cuisine, Bilan, Courses,
                                Mode Courses, Stocks, Prix, Progression, Profil, Mes aliments, Mes recettes
```

Le choix structurant : **toute la logique de calcul vit dans `@bouffe/core`**, partagé par l'API et la PWA. L'API l'utilise pour faire autorité (génération, clôture des courses) ; la PWA l'utilise pour fonctionner sans réseau (recettes, meal prep, scan et correspondance des produits en magasin, totaux). Les mêmes règles s'appliquent des deux côtés, et elles sont testables sans base ni navigateur.

### Les moteurs

**Nutrition** (`nutrition.ts`) — Les totaux d'un repas ou d'une journée sont toujours dérivés des ingrédients (grammes × valeurs pour 100 g, poids cru). Beurre, huile, fromage et sauces sont des ingrédients comme les autres. Poids cru et poids cuit sont distingués par un rendement de cuisson par aliment.

**Valeurs nutritionnelles** (`data/ciqual.ts`) — 53 des 63 aliments du catalogue portent les valeurs de la [table Ciqual 2020](https://ciqual.anses.fr/) de l'Anses (Licence Ouverte), à l'état cru quand l'aliment s'achète cru ; chaque aliment garde le code et le libellé de son aliment de référence, affichés dans sa fiche. Les protéines sont celles de l'étiquetage (azote × 6,25). Pour 9 aliments dont la table ne donne pas l'énergie (miel, amandes, pomme…), elle est calculée à partir des macronutriments avec les coefficients du règlement (UE) n° 1169/2011 ; l'import vérifie d'abord que ce calcul retrouve l'énergie publiée sur le reste de la table (écart médian 0,1 %). Les 10 aliments absents de la table (skyr, whey, boisson et barre protéinées, mélanges d'épices…) gardent une moyenne d'étiquettes, signalée comme telle. Le fichier est généré par `npm run ciqual -w @bouffe/core` et versionné : l'application ne télécharge rien. Quand le catalogue change (`CATALOG_VERSION`), les programmes en cours sont recalculés à la prochaine ouverture.

**Mes vrais produits** — Chacun peut remplacer ces moyennes par les valeurs de son produit (saisie de l'étiquette ou scan), ou ajouter un aliment, qui entrera alors dans le tirage des semaines suivantes : les programmes en cours sont recalculés. Un garde-fou signale une saisie dont les calories ne correspondent pas aux macronutriments.

**Deux styles de semaine** — *Simple* (par défaut) : des assiettes sans recette — une viande, un féculent, du beurre, et selon le tirage des œufs le soir, du pain, un fromage, un laitage ou une compote — qui se lisent en une ligne : « 250 g poulet + 100 g riz cru + 10 g beurre + 140 g skyr + 1 compote ». La semaine s'affiche alors en tableau Jour / Midi / Collation / Soir, se copie telle quelle (texte tabulé, pour une note ou un tableur) et s'imprime ainsi. *Cuisiné* : des plats avec une recette (bolognaise, curry, gratin…). Le style se choisit à la génération ou dans le profil ; une semaine déjà générée garde le sien. Hors domicile, les repas à emporter sont les mêmes dans les deux styles, et tes recettes personnelles sortent dans les deux. L'écriture compacte est dans `planner/compact.ts`.

**Génération des menus** (`planner/`) — Pas de repas codés en dur : des *modèles* décrivent des rôles (protéine, féculent, matière grasse, garniture, laitage, fruit) et leurs aliments candidats. Pour chaque repas, le moteur tire plusieurs candidats, résout leurs quantités, les note, garde le meilleur, puis équilibre la journée.

- *Solveur* : système 2 × 2 (levier protéine, levier énergie) pour viser calories et protéines du repas, avec bornes et pas de portion ; puis ajustement fin de la journée jusqu'à la tolérance (±50 kcal par défaut).
- *Note d'un candidat* : variété dans la semaine et par rapport à la semaine précédente, aliments appréciés, notes et favoris, stocks disponibles, réutilisation de produits déjà entamés, fibres, part de lipides, niveau de préparation (ultra rapide / normal / meal prep), équipement, budget.
- *Contraintes dures* : aliments et catégories refusés (« sans légumes », « sans poisson »), repas interdits, repas transportables sans cuisine les jours hors domicile.
- *Préférences par aliment* : « j'aime » (revient plus souvent), « rarement » (une fois par semaine au plus), « jamais ». L'écran *Mes aliments* affiche en direct le nombre de plats différents encore possibles dans ton style (en cuisiné : 113 sans restriction avec le catalogue de départ, 354 en comptant les assaisonnements ; en simple : jusqu'à 60 assiettes).
- *Saveurs* : les plats simples (viande + féculent) se déclinent avec un assaisonnement compté comme un ingrédient (cajun, paprika fumé, curry, herbes de Provence…). Le même plat avec une autre épice reste le même plat pour la variété de la semaine.
- *Cuisiner une fois, manger deux fois* (option) : le dîner est reconduit au déjeuner du lendemain quand le plat se garde bien ; le mode cuisine affiche alors les quantités des deux portions et ce qu'il faut mettre de côté.
- *Jours d'entraînement* (option) : quelques centaines de kcal en plus ces jours-là, compensées les jours de repos ; la moyenne de la semaine ne change pas et aucun jour ne passe sous le plancher prudent.
- *Repas libre* : un restaurant ou une soirée se déclare avec une simple estimation. Le reste de la journée s'adapte, puis l'excédent est réparti sur les jours suivants (150 kcal par jour au plus, jamais sous le plancher). Annuler le repas libre annule le lissage.
- *Garder / échanger* : un repas marqué d'un cadenas survit à une nouvelle génération ; deux repas de la semaine s'échangent, leurs journées sont rééquilibrées.
- *Recettes personnelles* (`planner/custom.ts`) : tu décris ton plat (ingrédients, rôle « protéine », « féculent » ou « quantité fixe », étapes) ; il devient un modèle comme les autres, dosé pour ta cible, et sort dans la semaine générée suivante.
- *Anti-gaspillage* : les paquets frais entamés sont finis en priorité, les viandes sont arrondies à des barquettes entières quand la cible le permet, et la liste annonce les restes périssables à prévoir.
- *Remplacements* : « Je n'aime pas ce repas » propose trois variantes équivalentes ; « Remplacer uniquement cet aliment » change un ingrédient et recalcule le repas ; la liste propose les aliments prévus pour ce rôle, ceux de la même famille de substitution, et les aliments que tu as ajoutés toi-même dans la même famille.
- *Aliments ajoutés* : un aliment créé dans *Mes aliments* entre dans le tirage selon sa famille, mais seulement dans les rôles « ouverts » des modèles (`open` : viande et féculent d'une assiette, laitage, fruit, fromage, pain, oléagineux). Les rôles qui font l'identité d'une recette restent fermés — une bolognaise reste au steak haché et aux pâtes. Il est poussé tant qu'il n'est pas dans la semaine, discret ensuite (en pratique une à quatre fois par semaine), n'est jamais emporté hors domicile, et ne sert de source de protéines que s'il en apporte comme les aliments du modèle : un yaourt sucré fait un dessert, pas le laitage protéiné d'une collation. « Rarement » et « Jamais » s'appliquent comme aux autres. Dans les deux cas le reste de la journée est rééquilibré, en tenant compte de ce qui a déjà été mangé.
- Déterministe pour une graine donnée, donc reproductible et testable.

**Liste de courses** (`shopping/list.ts`, `pricing.ts`) — Besoins de la semaine par aliment, moins les stocks, puis choix exact des conditionnements par programmation dynamique. Exemples couverts par les tests : 1 480 g de poulet en barquettes de 500 g → 3 barquettes ; 14 œufs → une boîte de 12 + une de 6. Trois stratégies : prix total, moins de restes, meilleur prix au kilo (gros formats seulement pour ce qui se conserve). Sortie : quantité nécessaire, achetée, reste théorique, prix unitaire, prix au kilo, coût, total, coût par jour et par repas.

**Mode Courses** (`shopping/session.ts`, `matching.ts`, `resolver.ts`) — La session est une suite de transitions pures, appliquées sur le téléphone et rejouées côté serveur à la clôture. Un produit scanné est rapproché de la liste par code-barres, puis par type d'aliment (catégories Open Food Facts, mots-clés), valeurs nutritionnelles, poids, prix et préférences. Résultat : article prévu, remplacement à confirmer (avec l'écart en kcal sur la semaine), produit hors liste, ou produit refusé (marque interdite, trop éloigné nutritionnellement).

**Stocks** (`inventory.ts`) — Déduits de la liste, diminués à chaque repas validé (et restitués si la déclaration est annulée), augmentés à la clôture des courses. L'écran *Mes stocks* les range en trois zones — frais (frigo, fruits, pain), surgelés, placard — parce que le frais est ce qui se décale le plus vite : chaque zone se vide d'un geste (annulable), tout le stock aussi. On le remplit de deux façons, qui se complètent :

- *en scannant* les produits à la maison : le code-barres est identifié (appareil, produits déjà connus, puis Open Food Facts), rattaché à un aliment du programme, et son poids ajouté au stock ; un produit inconnu se rattache une fois à la main et il est reconnu ensuite, Mode Courses compris ;
- *à la main*, par formats habituels (« + 500 g », « + 6 œufs ») ou en fixant une quantité exacte, avec « il en reste la moitié » et « il n'y en a plus ».

Les modifications s'affichent tout de suite et partent groupées vers le serveur, qui ne recalcule la liste de courses qu'une fois. Le stock ne suit que les aliments du programme : un produit qui n'en fait pas partie s'ignore.

**Bilan de la semaine** (`planner/review.ts`) — Part des repas mangés comme prévu (les repas d'aujourd'hui encore à venir ne comptent pas comme des oublis), moyennes réelles sur les journées entièrement déclarées, comparées à la cible de ces jours-là, variation du poids, coût prévu et payé, et date estimée d'arrivée à l'objectif — seulement quand la tendance est mesurable, et présentée comme une estimation.

**Poids** (`weight.ts`) — Moyenne mobile sur 7 jours, moyennes hebdomadaires, pente sur 4 semaines. Une pesée isolée ne déclenche jamais rien. Une suggestion de ±100 kcal n'apparaît qu'en cas de stagnation ou de perte trop rapide durable ; elle n'est appliquée qu'après confirmation, au plus une fois toutes les 3 semaines, et jamais sous un plancher (le plus haut entre un minimum absolu et 90 % du métabolisme de base).

---

## Modèle de données (MongoDB)

Défini dans [apps/api/src/db/schemas.ts](apps/api/src/db/schemas.ts).

| Collection | Rôle |
| --- | --- |
| `users` | Compte, profil corporel, consentements ; embarque **UserPreferences** (aliments, repas, magasin, rappels, avis sur les repas) |
| `nutritiongoals` | **NutritionGoal** historisé : chaque changement de budget crée une nouvelle version |
| `foods` | **Food** : aliment générique, valeurs nutritionnelles et leur source (catalogue commun, ou valeurs et aliments de l'utilisateur) |
| `recipes` | **Recipe** : modèle de repas (règles de composition + étapes), commun ou personnel |
| `products` | **Product** : produit concret d'une marque |
| `barcodes` | **Barcode** : un produit peut en porter plusieurs |
| `retailproducts` | **RetailProduct** : produit vendu dans un magasin, avec prix, conditionnement et date |
| `pricehistories` | **PriceHistory** : code-barres → magasin → prix → date |
| `stores` | **Store** : magasin et ordre de parcours des rayons |
| `mealplans` | **MealPlan** ⊃ **MealPlanDay** ⊃ **Meal** ⊃ ingrédients — le « prévu » |
| `foodentries` | **FoodEntry** : ce qui a réellement été mangé — le « réel » |
| `weightentries`, `activityentries` | **WeightEntry**, **ActivityEntry** (avec leur source : manuel, plus tard Health Connect) |
| `shoppinglists` | **ShoppingList** ⊃ **ShoppingListItem** |
| `shoppingsessions` | **ShoppingSession** ⊃ **ShoppingSessionItem** : produit prévu *et* produits réellement achetés |
| `purchases` | **Purchase** ⊃ **PurchaseItem** : panier réel, coûts, articles manquants |
| `inventoryitems` | **InventoryItem** |
| `refreshtokens`, `pushsubscriptions` | Sessions et abonnements push |

Les agrégats toujours lus ensemble sont embarqués ; ce qui est interrogé indépendamment a sa collection.

## API REST

Documentation interactive : `/api/docs` (JSON : `/api/docs-json`). Toutes les routes exigent un access token, sauf l'authentification et `/health`.

| Domaine | Routes |
| --- | --- |
| Auth | `POST /auth/register` · `login` · `refresh` · `logout` · `GET /auth/me` |
| État | `GET /state?today=&catalog=1` — tout l'état de l'application en une requête |
| Profil | `POST /me/onboarding` · `PUT /me` · `POST /me/goal` · `GET /me/export` · `DELETE /me` |
| Aliments et recettes perso | `POST /foods` · `DELETE /foods/:key` · `POST /recipes` · `DELETE /recipes/:id` |
| Programme | `POST /meal-plans/generate` · `GET /meal-plans` · `GET /meal-plans/:id` · `POST /meal-plans/:id/swap` |
| Repas | `GET …/meals/:mealId/alternatives` · `POST …/replace` · `GET …/items/:slot/alternatives` · `POST …/items/:slot/replace` · `POST|DELETE …/log` · `POST …/free` (repas libre) · `POST …/lock` · `POST …/feedback` · `POST …/repeat` · `GET …/recipe` |
| Jours | `PATCH /meal-plans/:id/days/:day` (hors domicile) · `POST …/rebalance` · `GET /meal-plans/:id/meal-prep` |
| Courses | `POST /shopping-lists/generate` · `PATCH /shopping-lists/:id/items/:itemId` · `PUT /shopping-sessions/:id` · `POST /shopping-sessions/:id/finish` · `GET /purchases` · `POST /shopping/habits/apply` |
| Produits | `GET /barcodes/:ean` · `PUT /barcodes/:ean` (rattacher un code-barres à un aliment) · `GET /prices/:ean` · `PUT /retail-products` · `DELETE /retail-products/:id` · `POST /stores` · `PATCH /stores/:id` |
| Stocks | `PUT /inventory/:foodKey` · `PUT /inventory` (plusieurs aliments d'un coup : série de scans, remise à zéro d'une zone ou du stock) |
| Suivi | `POST /entries` · `DELETE /entries/:id` · `PUT|DELETE /weights/:date` · `PUT /activities/:date` · `POST /activities/import` |
| Push | `GET /push/public-key` · `POST|DELETE /push/subscribe` · `POST /push/test` |

Chaque mutation renvoie l'état à jour : programme, liste de courses, stocks et suivi restent cohérents entre eux.

---

## Intégrations externes

Aucune n'est nécessaire au fonctionnement : si un service ne répond pas, l'application continue avec les données locales.

### E.Leclerc — pas d'intégration automatique

Vérifié en octobre 2026 : E.Leclerc ne publie aucune API officielle pour le catalogue, les prix, les disponibilités ou le panier du Drive. La seule API documentée (Mirakl) est réservée aux vendeurs de sa marketplace. Les « API Leclerc » tierces reposent sur du scraping non autorisé : elles ne sont volontairement pas utilisées.

Ce qui est en place ([providers.ts](apps/api/src/catalog/providers.ts)) :

- `RetailProvider` — l'interface (produit par code-barres, recherche, capacités déclarées).
- `LeclercProvider` — se déclare indisponible et explique pourquoi ; c'est l'emplacement à remplir le jour où une API officielle existe.
- `ManualProvider` — tes produits, conditionnements et prix, relevés par saisie ou par scan, mémorisés par magasin avec leur date. C'est lui qui alimente les listes.
- `MockProvider` — données fictives étiquetées « EXEMPLE », activables seulement hors production (`RETAIL_PROVIDER=mock`).

La liste démarre donc avec des **prix estimés**, affichés comme tels, remplacés au fil des courses par ceux de ton magasin. Un prix de plus de 30 jours est signalé comme à vérifier.

### Codes-barres — `ProductResolver`

Le scan n'est couplé à aucune base produit unique. La chaîne interroge successivement :

1. l'appareil (codes-barres mis en cache avant d'entrer dans le magasin, scans précédents) ;
2. les prix relevés du magasin, puis tes produits déjà scannés, puis le catalogue commun ;
3. [Open Food Facts](https://world.openfoodfacts.org) — base ouverte (ODbL), API publique. Désactivable avec `OFF_ENABLED=false`.

Chaque source a un délai maximal ; une erreur ou un dépassement fait simplement passer à la suivante. Un produit introuvable se décrit en une fois et sera reconnu ensuite.

### Samsung Health / Health Connect — impossible depuis une PWA

Aucune API web ne donne accès à Samsung Health ni à Health Connect : ces données ne sont lisibles que par une application Android native, avec l'accord de l'utilisateur. L'application ne prétend donc pas les récupérer. Le suivi manuel (poids, pas, calories actives, entraînements, sommeil) est complet.

Trajectoire prévue : PWA Angular → API → wrapper Android Capacitor → Health Connect. L'API est déjà prête à recevoir ces relevés (`POST /api/activities/import`, `PUT /api/weights/:date` avec `source: "health-connect"`). Il reste à écrire le wrapper et le plugin natif.

---

## PWA et hors ligne

- **Installable** : manifeste, icônes, service worker Angular (coquille applicative précachée). Le service worker n'est actif que dans le build de production.
- **État local** : tout l'état (programme, liste, stocks, catalogue) est mis en cache dans IndexedDB et affiché immédiatement au lancement, puis rafraîchi.
- **Actions hors ligne** : repas mangé, article coché et pesée sont appliqués localement et mis en file, rejoués au retour du réseau. Générer ou remplacer un repas demande une connexion.
- **Mode Courses** : la session vit dans IndexedDB. Scans, quantités et prix sont enregistrés sur le téléphone ; la clôture est mise en file si le réseau manque, et le résumé est calculé localement.
- **Scan** : API Barcode Detection quand le navigateur la fournit, sinon ZXing chargé à la demande. L'abstraction `BarcodeScanner` ([scanner.ts](apps/web/src/app/core/scanner.ts)) accueillera un scanner natif Capacitor. La saisie manuelle du code reste toujours possible.
- **Notifications** : rappels de pesée et de meal prep par Web Push, si des clés VAPID sont configurées.
- **Export** : la page d'impression produit le PDF de la semaine (programme + courses) ; programme et liste se partagent en texte.
- **Mode cuisine** : une étape par écran, minuteurs détectés dans le texte des étapes (plusieurs en parallèle), sonnerie et vibration, écran maintenu allumé quand le navigateur le permet (Wake Lock).

### Vers Android / iOS

Le cœur métier ne dépend ni du DOM ni de Node, l'URL de l'API est un jeton d'injection (`API_URL`), et scanner comme fournisseur de santé sont des interfaces. Empaqueter avec Capacitor revient à ajouter le projet natif, fournir l'URL absolue de l'API, puis brancher les implémentations natives.

---

## Sécurité et données personnelles

- Mots de passe hachés avec Argon2id. Access token JWT de 15 minutes, gardé en mémoire. Refresh token opaque, stocké haché, dans un cookie `httpOnly` limité à `/api/auth`, avec rotation à chaque usage et révocation de toute la famille en cas de réutilisation.
- Validation stricte des entrées, limitation de débit, en-têtes de sécurité (Helmet côté API, CSP sans script en ligne côté nginx).
- **Données de santé** (poids, activité) : enregistrées uniquement après consentement explicite ; le retirer les efface. Minimisation : année de naissance seulement, pas de date complète.
- **Droits RGPD** : export complet en JSON et suppression définitive du compte depuis le profil.
- Seul flux sortant : le code-barres scanné, envoyé à Open Food Facts pour identifier un produit.
- Chiffrement en transit (TLS vers Atlas, HTTPS à prévoir devant nginx) et au repos (assuré par Atlas ; à activer sur un MongoDB auto-hébergé).

Les secrets vivent dans des fichiers `.env` ignorés par git. Ne jamais les committer.

## Tests

```bash
npm test
```

130 tests couvrent les calculs critiques : nutrition, solveur, génération (cible respectée chaque jour sur plusieurs graines, aliments refusés jamais proposés, jours hors domicile, variété, semaine différente de la précédente), remplacements, intégrité du catalogue (chaque recette atteint la cible ; chaque aliment vient de la table Ciqual ou est signalé absent ; énergie cohérente avec les macronutriments), style simple (assiettes sans recette à la cible chaque jour, écriture compacte, tableau de la semaine, remplacements du même style), saveurs, cuisine en double, cadenas et échange, jours d'entraînement, repas libre, anti-gaspillage, recettes personnelles, aliments ajoutés (tirés dans les rôles ouverts de leur famille, proposés en remplacement, jamais comme source de protéines s'ils n'en apportent pas), bilan de la semaine, recettes et meal prep, conditionnements et prix, liste et stocks (zones de rangement, remise à zéro et annulation, formats d'ajout, poids d'un produit scanné), session de courses, correspondance des produits scannés, résolveurs de codes-barres, tendance du poids et garde-fous de la suggestion calorique.

`npm run smoke -w @bouffe/api` déroule 72 vérifications de bout en bout contre une API en cours d'exécution. Il crée un compte temporaire et le supprime toujours, même en cas d'erreur ; si le processus est tué en route, `npm run test:cleanup -w @bouffe/api` retrouve le compte orphelin.

## Limites connues

- **Lecture caméra des codes-barres** : implémentée, mais non vérifiée sur un vrai téléphone (la caméra était indisponible dans l'environnement de test). Tout le parcours en aval — recherche, correspondance, confirmation, clôture — a été testé via la saisie manuelle du code.
- **Images Docker** : les fichiers compose sont validés (`docker compose config`) et les étapes des Dockerfiles ont été rejouées à la main (installation, builds, démarrage de l'API en mode production avec les seuls fichiers de l'image), mais les images n'ont jamais été construites par Docker, dont le moteur ne démarrait pas sur le poste de développement. La configuration nginx a été relue, pas exécutée.
- **Notifications push** : non testées de bout en bout ; elles demandent le build de production servi en HTTPS.
- **Valeurs nutritionnelles** : moyennes de la table Ciqual, donc pas celles de ton produit. Un paquet de pâtes annonce souvent 350 à 360 kcal quand la table en donne 336 ; les hauts de cuisse de poulet sont ceux de la table, sans peau. « Mes vrais produits » sert à corriger ces écarts. La correspondance entre un aliment du catalogue et son aliment de référence est un choix éditorial, visible dans `packages/core/scripts/import-ciqual.mjs`.
- **Prix du catalogue** : estimations, à remplacer par les prix de ton magasin.
- **Recettes** : écrites pour l'application, pas testées en cuisine une par une. Les temps de cuisson sont indicatifs.
- **Mode cuisine** : sonnerie, vibration et maintien de l'écran allumé dépendent du navigateur et n'ont pas été vérifiés sur un vrai téléphone.
- **Micronutriments** : seules les fibres sont suivies quantitativement. L'absence de légumes est signalée, pas compensée.
