import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/ds/tokens.css';
import { DsPage } from '@/dev/ds-page';

const container = document.getElementById('root');
if (!container) throw new Error('Thiếu phần tử #root');

// DS-3 thay bằng router thật và giữ /ds chỉ khi import.meta.env.DEV.
const showDsPage = import.meta.env.DEV && window.location.pathname === '/ds';

createRoot(container).render(<StrictMode>{showDsPage ? <DsPage /> : <p>2P Crew</p>}</StrictMode>);
