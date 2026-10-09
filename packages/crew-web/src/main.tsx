import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import '@/ds/tokens.css';
import { AppProviders, createQueryClient } from '@/app/providers';
import { createAppRouter } from '@/app/router';
import { initI18n } from '@/i18n';

const container = document.getElementById('root');
if (!container) throw new Error('Thiếu phần tử #root');
const root = container;

// Nạp chuỗi hai ngôn ngữ trước khi render để trang đầu không nháy key.
await initI18n();

const queryClient = createQueryClient();

createRoot(root).render(
  <StrictMode>
    <AppProviders client={queryClient}>
      <RouterProvider router={createAppRouter(queryClient)} />
    </AppProviders>
  </StrictMode>,
);
