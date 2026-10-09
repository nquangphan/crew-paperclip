// Router của UI Crew. Route feature gom bằng import.meta.glob('../features/*/routes.tsx') (mỗi module export
// `routes: RouteObject[]`, path tương đối dưới /:companyPrefix/), nên gói khác thêm trang không phải sửa file này.
import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { setUnauthorizedHandler } from '@/api/http';
import { CliAuthPage } from './auth/cli-auth-page';
import { LoginPage } from './auth/login-page';
import { RequireSession } from './auth/require-session';
import { NotFoundPage } from './not-found-page';
import { routeSegments } from './routes-util';
import { CompanyNotFound, CompanyShell, RootRedirect } from './shell/shell';

export type FeatureModules = Record<string, { routes?: RouteObject[] }>;

const featureGlob = import.meta.glob<{ routes?: RouteObject[] }>('../features/*/routes.tsx', { eager: true });

export function collectFeatureRoutes(modules: FeatureModules): RouteObject[] {
  return Object.keys(modules)
    .sort()
    .flatMap((path) => modules[path].routes ?? []);
}

export interface BuildRoutesOptions {
  featureModules?: FeatureModules;
  /** Trang /ds (xem design system) chỉ gắn khi build dev. */
  dev?: boolean;
}

export function buildAppRoutes({ featureModules = featureGlob, dev = false }: BuildRoutesOptions = {}): RouteObject[] {
  const children = collectFeatureRoutes(featureModules);
  const segments = routeSegments(children);
  const routes: RouteObject[] = [
    { path: '/login', element: <LoginPage /> },
    { path: '/cli-auth/:id', element: <CliAuthPage /> },
  ];
  // `import.meta.env.DEV` là hằng lúc build: bản production bỏ hẳn chunk trang /ds.
  if (dev && import.meta.env.DEV) {
    routes.push({
      path: '/ds',
      lazy: async () => ({ Component: (await import('@/dev/ds-page')).DsPage }),
    });
  }
  routes.push({
    element: <RequireSession />,
    children: [
      { path: '/', element: <RootRedirect /> },
      {
        path: '/:companyPrefix',
        element: <CompanyShell segments={segments} />,
        children: [...children, { path: '*', element: <CompanyNotFound /> }],
      },
    ],
  });
  routes.push({ path: '*', element: <NotFoundPage /> });
  return routes;
}

export function createAppRouter() {
  const router = createBrowserRouter(buildAppRoutes({ dev: import.meta.env.DEV }));
  // 401 giữa chừng: điều hướng SPA về /login?next= thay vì tải lại trang.
  setUnauthorizedHandler((to) => void router.navigate(to, { replace: true }));
  return router;
}
