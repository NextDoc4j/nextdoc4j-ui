import type { RouteRecordRaw } from 'vue-router';

import { SvgMenuDocumentIcon } from '@vben/icons';

const routes: RouteRecordRaw[] = [
  {
    meta: {
      icon: SvgMenuDocumentIcon,
      order: 1,
      title: '文档管理',
    },
    name: '文档管理',
    path: '/doc-manage',
    redirect: '/doc-manage/global-params',
    children: [
      {
        meta: {
          title: '全局参数',
        },
        name: '全局参数',
        path: '/doc-manage/global-params',
        component: () => import('#/views/doc-manage/global-params/index.vue'),
      },
      {
        meta: {
          title: '文档下载',
        },
        name: '文档下载',
        path: '/doc-manage/export',
        component: () => import('#/views/doc-manage/export/index.vue'),
      },
    ],
  },
];

export default routes;
