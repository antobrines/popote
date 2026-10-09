# Déployer Popote avec Dokploy

Cible : **https://popote.abrines.fr**

```
navigateur ──HTTPS──▶ Traefik (Dokploy, certificat Let's Encrypt)
                         │
                         ▼
                    popote-web   nginx : sert la PWA, relaie /api
                         │
                         ▼
                    popote-api   NestJS
                         │
                         ▼
                    MongoDB Atlas (externe)
```

Deux conteneurs, aucun volume : tout l'état est dans MongoDB. Fichiers concernés :
[docker-compose.dokploy.yml](docker-compose.dokploy.yml), [dokploy.env.example](dokploy.env.example),
[apps/api/Dockerfile](apps/api/Dockerfile), [apps/web/Dockerfile](apps/web/Dockerfile), [apps/web/nginx.conf](apps/web/nginx.conf).

## 1. Avant Dokploy

**DNS** — chez le gestionnaire du domaine `abrines.fr`, un enregistrement `A` : `popote` → adresse IP du serveur Dokploy. Sans lui, le certificat HTTPS ne peut pas être émis.

**Dépôt Git** — Dokploy construit les images à partir d'un dépôt (GitHub, GitLab, Gitea…). Le dossier n'en est pas encore un :

```bash
git init -b main
```

```bash
git add -A
```

```bash
git commit -m "Popote"
```

Puis crée un dépôt **privé** chez ton hébergeur Git et pousse-le (`git remote add origin …`, `git push -u origin main`). Le fichier `apps/api/.env`, qui contient tes identifiants MongoDB, est ignoré par git : vérifie-le avec `git status` avant le premier commit.

**MongoDB Atlas** — dans *Network Access*, autorise l'adresse IP du serveur Dokploy. C'est la cause la plus fréquente d'un premier déploiement qui ne démarre pas.

**Secret de session** — un secret propre à la production :

```bash
openssl rand -hex 48
```

## 2. Dans Dokploy

1. **Créer le service** : dans un projet, *Create Service* → **Compose**, type **Docker Compose** (pas *Stack* : le mode Stack ne sait pas construire les images).
2. **Source** : ton dépôt, branche `main`, et **Compose Path** = `./docker-compose.dokploy.yml`.
3. **Environment** : colle le contenu de [dokploy.env.example](dokploy.env.example) et remplis `APP_DOMAIN`, `MONGODB_URI` (la même que sur ta machine pour retrouver tes données) et `JWT_ACCESS_SECRET`.
4. **Domains** → *Add Domain* :

   | Champ | Valeur |
   | --- | --- |
   | Service | `popote-web` |
   | Host | `popote.abrines.fr` |
   | Path | `/` |
   | Container Port | `80` |
   | HTTPS | activé |
   | Certificate | `letsencrypt` |

   Dokploy ajoute lui-même les labels Traefik au déploiement (le bouton *Preview Compose* montre le résultat). Avec Docker Compose, tout changement de domaine demande un redéploiement.
5. **Deploy**. Le premier build prend quelques minutes (installation des dépendances, build Angular).
6. **Déploiement automatique** (facultatif) : active *Auto Deploy*, ou branche le webhook fourni par Dokploy sur ton dépôt. Chaque `git push` redéploie.

## 3. Vérifier

- `https://popote.abrines.fr/api/health` répond `{"status":"ok", …, "signup":false}`.
- La page de connexion s'affiche ; tu te connectes avec ton compte habituel.
- Sur ton téléphone : ouvre l'adresse, puis « Ajouter à l'écran d'accueil ». La caméra (scan) et les notifications ne fonctionnent qu'en HTTPS : c'est maintenant le cas.

## Comptes

Les inscriptions sont **fermées** par défaut (`ALLOW_SIGNUP=false`) : sur une adresse publique, n'importe qui pourrait sinon créer un compte dans ta base. Tes comptes existants fonctionnent tels quels.

Pour créer un compte (toi sur une base vide, un proche) : passe `ALLOW_SIGNUP=true`, redéploie, crée le compte, puis reviens à `false` et redéploie. Le bouton « Créer un compte » n'apparaît que lorsque les inscriptions sont ouvertes.

## Mises à jour

Un redéploiement suffit, sans commande à lancer :

- au démarrage, l'API aligne le catalogue commun (aliments, valeurs nutritionnelles, modèles de repas) sur celui du code déployé ; tes aliments et recettes personnels ne sont pas touchés ;
- si des valeurs nutritionnelles ont changé, les programmes en cours sont recalculés à la prochaine ouverture de l'application.

## Séparer le développement de la production

Une fois en ligne, ta machine et le serveur écrivent dans la même base si tu gardes la même configuration. Pour développer sans risque pour tes vraies données, donne une autre base à ton poste, dans `apps/api/.env` :

```
MONGODB_DB=bouffe_dev
```

puis `npm run seed` pour y créer le catalogue et le compte de démonstration. La production garde `MONGODB_DB=bouffe`, où sont tes données actuelles.

## Notifications push (facultatif)

```bash
npx web-push generate-vapid-keys
```

Renseigne `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` et `VAPID_SUBJECT` dans l'onglet Environment, redéploie, puis active les notifications depuis Profil sur ton téléphone.

## Si ça ne marche pas

| Symptôme | Piste |
| --- | --- |
| Le déploiement s'arrête sur « Renseigne … » | Une variable obligatoire manque dans l'onglet Environment. |
| `popote-api` redémarre en boucle, ou « Bad Gateway » | Lis ses logs. Le plus souvent : MongoDB injoignable (adresse IP du serveur non autorisée dans Atlas, URI erronée). |
| Pas de certificat, avertissement de sécurité | Le DNS ne pointe pas encore vers le serveur, ou les ports 80 et 443 ne sont pas ouverts. Redéploie une fois le DNS propagé. |
| Build interrompu (`Killed`, code 137) | Mémoire insuffisante pendant le build Angular : compte 2 Go libres, ou ajoute du swap. |
| La page s'affiche mais la connexion échoue | Vérifie que `APP_DOMAIN` est exactement le domaine servi, sans `https://`. |
| Tout le monde est limité en même temps (« Too Many Requests ») | Le nombre de proxies est mal compté : `TRUST_PROXY=2` avec Dokploy seul, `3` derrière le proxy Cloudflare. |

## Tester la même configuration en local

Sur une machine où Docker tourne :

```bash
docker network create dokploy-network
```

```bash
docker compose --env-file dokploy.env -f docker-compose.dokploy.yml up --build
```

Rien n'est publié sur l'hôte dans cette configuration (c'est Traefik qui route, chez Dokploy) : pour un essai local complet avec un port ouvert, utilise plutôt `docker-compose.yml` (voir le README).

## Ce qui a été vérifié, et ce qui ne l'a pas été

Vérifié sur le poste de développement, **sans Docker** (son moteur n'a pas pu être démarré) :

- le fichier compose est valide et ses variables se résolvent (`docker compose config`) ;
- les étapes des deux Dockerfiles, rejouées à la main : installation par espace de travail, builds, et contenu final — l'API démarre avec les seuls fichiers que l'image contient ;
- l'API en mode production : 66 vérifications de bout en bout, inscriptions fermées (403), documentation masquée, adresse du client correcte derrière deux proxies.

Non vérifié : la construction réelle des images, la configuration nginx (relue, jamais exécutée), et l'émission du certificat par Traefik. Le premier déploiement est donc le vrai test : en cas d'erreur, les logs de build de Dokploy diront où.
