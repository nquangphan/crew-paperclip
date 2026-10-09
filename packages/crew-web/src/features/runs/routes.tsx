import type { RouteObject } from 'react-router-dom';

// Một trang run duy nhất. Link run từ issue trỏ `runs/:runId`; link từ trang agent trỏ `agents/:agentRef/runs/:runId`.
// Hai đường cùng hiển thị trang này (agentRef không cần: run có sẵn agentId).
const lazyPage = async () => ({ Component: (await import('./run-page')).RunPage });

export const routes: RouteObject[] = [
  { path: 'runs/:runId', lazy: lazyPage },
  { path: 'agents/:agentRef/runs/:runId', lazy: lazyPage },
];
