import { Routes } from '@angular/router';

import { CasosDeUso } from './pages/casos-de-uso/casos-de-uso';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'casos-de-uso' },
  { path: 'casos-de-uso', component: CasosDeUso },
];
