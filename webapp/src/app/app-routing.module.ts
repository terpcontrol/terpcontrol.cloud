import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';
import { AuthGuard } from './auth/auth.guard';
import { IsAdminGuard } from './auth/isadmin.guard';

const routes: Routes = [
  {
    path: '',
    redirectTo: 'list',
    pathMatch: 'full'
  },
  {
    path: 'list',
    canActivate:[AuthGuard],
    loadChildren: () => import('./device/list/list.module').then( m => m.ListPageModule)
  },
  // §3.3: the browser. One component for every screen in the product; the tent
  // is the Subjekt when the URL names no Ding.
  {
    path: 'z/:zelt_id',
    canActivate:[AuthGuard],
    loadChildren: () => import('./zelt/zelt.module').then( m => m.ZeltModule)
  },
  {
    path: 'device/:device_id/charts',
    canActivate:[AuthGuard],
    loadChildren: () => import('./device/charts/charts.module').then( m => m.ChartsPageModule)
  },
  {
    path: 'device/:device_id/diary',
    canActivate:[AuthGuard],
    loadChildren: () => import('./device/diary/diary.module').then( m => m.DiaryPageModule)
  },
  {
    path: 'device/:device_id/settings',
    canActivate:[AuthGuard],
    loadChildren: () => import('./device/settings/settings.module').then( m => m.SettingsPageModule)
  },
  {
    path: 'device/:device_id/testmode',
    canActivate:[AuthGuard],
    loadChildren: () => import('./device/testmode/testmode.module').then( m => m.TestmodePageModule)
  },
  {
    path: 'diagnostics',
    canActivate:[IsAdminGuard],
    loadChildren: () => import('./diagnostics/diagnostics.module').then( m => m.DiagnosticsPageModule)
  },
  {
    path: 'login',
    loadChildren: () => import('./login/login.module').then( m => m.LoginPageModule)
  },
  {
    path: 'demo',
    loadChildren: () => import('./demo/demo.module').then( m => m.DemoPageModule)
  },
  {
    path: 'link-expired',
    loadChildren: () => import('./link-expired/link-expired.module').then( m => m.LinkExpiredPageModule)
  },
  {
    path: 'connection-error',
    loadChildren: () => import('./connection-error/connection-error.module').then( m => m.ConnectionErrorPageModule)
  },
  {
    path: 'account',
    canActivate:[AuthGuard],
    loadChildren: () => import('./account/account.module').then( m => m.AccountPageModule)
  },
  {
    path: 'shares',
    canActivate:[AuthGuard],
    loadChildren: () => import('./shares/shares.module').then( m => m.SharesPageModule)
  },
  {
    path: 'classes',
    loadChildren: () => import('./classes/classes.module').then( m => m.ClassesPageModule)
  },
  // Last: anything that matched none of the routes above is a 404.
  {
    path: '**',
    loadChildren: () => import('./not-found/not-found.module').then( m => m.NotFoundPageModule)
  }
];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })
  ],
  exports: [RouterModule]
})
export class AppRoutingModule {}
