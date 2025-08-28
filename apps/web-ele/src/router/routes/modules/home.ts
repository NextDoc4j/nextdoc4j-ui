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
  {
    meta: {
      order: 1,
      title: '全局认证',
    },
    name: '全局认证',
    path: '/authorize',
    component: () => import('#/views/authorize/index.vue'),
  },
];

export default routes;
