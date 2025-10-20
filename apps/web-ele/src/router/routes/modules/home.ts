import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    meta: {
      order: 0,
      title: '主页',
    },
    name: '主页',
    path: '/home',
    component: () => import('#/views/home/index.vue'),
  },
];

export default routes;
