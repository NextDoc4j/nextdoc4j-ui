import type { RouteRecordRaw } from 'vue-router';

import { SvgMenuHomeIcon } from '@vben/icons';

const routes: RouteRecordRaw[] = [
  {
    meta: {
      icon: SvgMenuHomeIcon,
      order: 0,
      title: '主页',
    },
    name: '主页',
    path: '/home',
    component: () => import('#/views/home/index.vue'),
  },
];

export default routes;
