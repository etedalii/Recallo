import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  {
    path: 'home',
    loadComponent: () => import('./features/home/home').then((m) => m.Home),
  },
  {
    path: 'study/:deck',
    loadComponent: () => import('./features/study/study').then((m) => m.Study),
  },
  {
    path: 'study',
    loadComponent: () => import('./features/study/study').then((m) => m.Study),
  },
  {
    path: 'add',
    loadComponent: () => import('./features/card-form/card-form').then((m) => m.CardForm),
  },
  {
    path: 'edit/:id',
    loadComponent: () => import('./features/card-form/card-form').then((m) => m.CardForm),
  },
  {
    path: 'mistake',
    loadComponent: () => import('./features/mistake-form/mistake-form').then((m) => m.MistakeForm),
  },
  {
    path: 'browse',
    loadComponent: () => import('./features/browse/browse').then((m) => m.Browse),
  },
  {
    path: 'stats',
    loadComponent: () => import('./features/stats/stats').then((m) => m.Stats),
  },
  {
    path: 'settings',
    loadComponent: () => import('./features/settings/settings').then((m) => m.Settings),
  },
  { path: '**', redirectTo: 'home' },
];
