import type { RouteObject } from 'react-router-dom';

// Trang Roadmap nạp lười: bản đồ (xyflow) còn nằm trong chunk riêng của canvas.
export const routes: RouteObject[] = [
  {
    path: 'roadmap',
    lazy: async () => ({ Component: (await import('./roadmap-page')).RoadmapPage }),
  },
];
