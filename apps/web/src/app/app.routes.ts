import { inject } from '@angular/core';
import { APP_NAME } from '@bouffe/core';
import { type CanActivateFn, Router, type Routes } from '@angular/router';
import { Api } from './core/api';
import { Store } from './core/store';

/** Accès réservé aux comptes connectés et configurés. */
const appGuard: CanActivateFn = () => {
  const api = inject(Api);
  const store = inject(Store);
  const router = inject(Router);
  if (!api.hasSession()) return router.parseUrl('/connexion');
  const user = store.user();
  if (user && !user.onboardedAt) return router.parseUrl('/bienvenue');
  return true;
};

const guestGuard: CanActivateFn = () => (inject(Api).hasSession() ? inject(Router).parseUrl('/') : true);

const onboardingGuard: CanActivateFn = () => {
  const router = inject(Router);
  if (!inject(Api).hasSession()) return router.parseUrl('/connexion');
  return inject(Store).user()?.onboardedAt ? router.parseUrl('/') : true;
};

export const routes: Routes = [
  { path: 'connexion', canActivate: [guestGuard], title: 'Connexion — ' + APP_NAME, loadComponent: () => import('./pages/auth.page').then((m) => m.AuthPage) },
  { path: 'inscription', canActivate: [guestGuard], title: 'Créer un compte — ' + APP_NAME, loadComponent: () => import('./pages/signup.page').then((m) => m.SignupPage) },
  { path: 'bienvenue', canActivate: [onboardingGuard], title: 'Bienvenue — ' + APP_NAME, loadComponent: () => import('./pages/onboarding.page').then((m) => m.OnboardingPage) },
  {
    path: '',
    canActivate: [appGuard],
    children: [
      { path: '', pathMatch: 'full', title: 'Aujourd’hui — ' + APP_NAME, loadComponent: () => import('./pages/today.page').then((m) => m.TodayPage) },
      { path: 'programme', title: 'Programme — ' + APP_NAME, loadComponent: () => import('./pages/plan.page').then((m) => m.PlanPage) },
      { path: 'programme/meal-prep', title: 'Meal prep — ' + APP_NAME, loadComponent: () => import('./pages/mealprep.page').then((m) => m.MealPrepPage) },
      { path: 'programme/imprimer', title: 'Ma semaine — ' + APP_NAME, loadComponent: () => import('./pages/print.page').then((m) => m.PrintPage) },
      { path: 'programme/cuisine', title: 'Mode cuisine — ' + APP_NAME, loadComponent: () => import('./pages/cook.page').then((m) => m.CookPage) },
      { path: 'bilan', title: 'Bilan de la semaine — ' + APP_NAME, loadComponent: () => import('./pages/review.page').then((m) => m.ReviewPage) },
      { path: 'courses', title: 'Courses — ' + APP_NAME, loadComponent: () => import('./pages/shopping.page').then((m) => m.ShoppingPage) },
      { path: 'courses/magasin', title: 'Mode Courses — ' + APP_NAME, loadComponent: () => import('./pages/shop-mode.page').then((m) => m.ShopModePage) },
      { path: 'courses/stocks', title: 'Mes stocks — ' + APP_NAME, loadComponent: () => import('./pages/stocks.page').then((m) => m.StocksPage) },
      { path: 'courses/prix', title: 'Mes prix — ' + APP_NAME, loadComponent: () => import('./pages/prices.page').then((m) => m.PricesPage) },
      { path: 'progression', title: 'Progression — ' + APP_NAME, loadComponent: () => import('./pages/progress.page').then((m) => m.ProgressPage) },
      { path: 'profil', title: 'Profil — ' + APP_NAME, loadComponent: () => import('./pages/profile.page').then((m) => m.ProfilePage) },
      { path: 'profil/aliments', title: 'Mes aliments — ' + APP_NAME, loadComponent: () => import('./pages/food-prefs.page').then((m) => m.FoodPrefsPage) },
      { path: 'profil/recettes', title: 'Mes recettes — ' + APP_NAME, loadComponent: () => import('./pages/recipes.page').then((m) => m.RecipesPage) },
    ],
  },
  { path: '**', redirectTo: '' },
];
