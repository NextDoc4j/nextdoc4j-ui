import type { RouteRecordStringComponent } from '@vben/types';

import type {
  Brand,
  MarkDownDes,
  PathMenuItem,
  Paths,
} from '#/typings/openApi';

import { updatePreferences } from '@vben/preferences';

import { getOpenAPI, getOpenAPIConfig } from '#/api/core/openApi';
import { requestClient } from '#/api/request.js';
import { useApiStore } from '#/store';

interface TagGroups {
  [tag: string]: Record<string, PathMenuItem[]>;
  all: Record<string, PathMenuItem[]>;
}

export const fetchMenuListAsync: () => Promise<
  RouteRecordStringComponent<string>[]
> = async () => {
  const allPath: TagGroups = {
    all: {},
  };
  const accessRoutes: RouteRecordStringComponent<string>[] = [];

  const entries: RouteRecordStringComponent<string>[] = [];
  const { data } = await getOpenAPI();
  const { paths, components, 'x-nextdoc4j': xNextdoc4j } = data;

  if (xNextdoc4j && xNextdoc4j.brand) {
    initBrand(xNextdoc4j.brand);
  }
  let markDownMenus: RouteRecordStringComponent<string>[] = [];
  if (xNextdoc4j && xNextdoc4j.markdown) {
    markDownMenus = initMarkdown(xNextdoc4j.markdown);
  }

  const tagGroups = apiByTag(paths);

  allPath.all = tagGroups;

  Object.keys(tagGroups).forEach((key: string) => {
    const children = tagGroups[key]?.map((api) => {
      return {
        name: `all*${key}*${api.operationId}`,
        path: `/document/all/${key}/${api.operationId}`,
        meta: {
          title: api.summary,
          method: api.method,
          keepAlive: true,
        },
        component: '/views/document/index.vue',
      };
    }) as RouteRecordStringComponent<string>[];
    accessRoutes.push({
      component: '/views/document/index.vue',
      name: `all*${key}`,
      meta: {
        title: key,
      },
      path: `/document/all/${key}`,
      children,
    });
  });
  const access = [
    {
      name: 'all',
      path: '/document/all',
      component: '/views/document/index.vue',
      meta: {
        title: '所有接口',
      },
      redirect:
        accessRoutes.length > 0 ? accessRoutes[0]?.path : '/document/all',
      children: accessRoutes,
    },
  ];
  Object.keys(components?.schemas ?? {}).forEach((key: string) => {
    entries.push({
      component: '/views/entity/index.vue',
      name: `all*${key}`,
      meta: {
        title: key,
        keepAlive: true,
      },
      path: `/entity/all/${key}`,
    });
  });
  const accessEntries: RouteRecordStringComponent<string>[] = [
    {
      name: 'entries',
      path: '/entity/all',
      component: '/views/entity/index.vue',
      meta: {
        title: '所有实体',
      },
      children: entries,
    },
  ];
  const { data: config } = await getOpenAPIConfig();
  const { urls } = config;
  if (urls) {
    await Promise.all(
      urls
        .filter(({ url }) => {
          const code = url.split('/');
          const tag = code[code.length - 1];
          return tag !== 'all';
        })
        .map(async ({ url, name }) => {
          const { data } = await requestClient.get(url);
          const { paths, components } = data;
          const tagGroups = apiByTag(paths);
          const code = url.split('/');
          const tag = code[code.length - 1] ?? '';
          const accessRoutes: RouteRecordStringComponent[] = [];
          allPath[tag] = tagGroups;
          Object.keys(tagGroups).forEach((key: string) => {
            const children = tagGroups[key]?.map((api) => {
              return {
                name: `${tag}*${key}*${api.operationId}`,
                path: `/document/${tag}/${key}/${api.operationId}`,
                meta: {
                  title: api.summary,
                  method: api.method,
                  keepAlive: true,
                },
                component: '/views/document/index.vue',
                parent: '/document',
              };
            }) as RouteRecordStringComponent<string>[];
            accessRoutes.push({
              component: '/views/document/index.vue',
              name: `${tag}-${key}`,
              path: `/document/${tag}/${key}`,
              meta: {
                title: key,
              },
              children,
            });
          });
          access.push({
            name: tag,
            path: `/document/${tag}`,
            component: '/views/document/index.vue',
            meta: {
              title: name,
            },
            children: accessRoutes,
            redirect:
              accessRoutes.length > 0
                ? accessRoutes[0]?.path
                : `/document/${tag}`,
          });
          const entityGroup: RouteRecordStringComponent<string> = {
            component: '/views/entity/index.vue',
            name: `entity*${tag}`,
            path: `/entity/${tag}`,
            meta: {
              title: name,
            },
            children: [],
          };
          Object.keys(components.schemas).forEach((key: string) => {
            if (!entityGroup.children) {
              entityGroup.children = [];
            }
            entityGroup.children.push({
              component: '/views/entity/index.vue',
              name: `${tag}*${key}`,
              path: `/entity/${tag}/${key}`,
              meta: {
                title: key,
              },
            });
          });
          accessEntries.push(entityGroup);
        }),
    );
  }
  if (data.info.title) {
    updatePreferences({
      app: {
        name: data.info.title,
      },
    });
  }
  return new Promise((resolve) => {
    useApiStore().initConfig(allPath, data, config);
    resolve([
      {
        name: 'document',
        path: '/document',
        component: '/views/document/index.vue',
        meta: {
          title: '接口文档',
        },
        children: access,
      },
      {
        name: 'entity',
        path: '/entity',
        component: '/views/entity/index.vue',
        meta: {
          title: '实体模型',
        },
        children: accessEntries,
      },
      ...markDownMenus,
    ]);
  });
};

export const apiByTag = (paths: Paths) => {
  const tagGroups: Record<string, PathMenuItem[]> = {};
  // 按tag分组
  Object.entries(paths).forEach(([path, methods]: [string, any]) => {
    Object.entries(methods).forEach(([method, config]: [string, any]) => {
      const tags = config.tags || ['default'];
      tags.forEach((tag: string) => {
        if (!tagGroups[tag]) tagGroups[tag] = [];
        tagGroups[tag].push({
          method,
          path,
          ...config,
        });
      });
    });
  });
  return tagGroups;
};

const initBrand = (brand: Brand) => {
  const { footerText = '', logo, title } = brand;
  updatePreferences({
    logo: {
      source: logo,
    },
    footer: {},
    copyright: {
      enable: true,
      date: footerText,
      companySiteLink: '',
      icpLink: '',
      icp: '',
      companyName: '',
    },
    app: {
      name: title,
    },
  });
};

const initMarkdown = (markdowns: MarkDownDes[]) => {
  if (markdowns.length > 0) {
    const group = markDownGroupBy(markdowns, 'group');
    useApiStore().initMarkDown(group);
    const menus: RouteRecordStringComponent<string>[] = [];
    Object.entries(group).forEach(([groupKey, groupContent]) => {
      menus.push({
        name: groupKey,
        path: `/markdown/${groupKey}`,
        component: '/views/markdown/index.vue',
        meta: {
          title: groupKey,
        },
        children: groupContent.map((markdown) => {
          return {
            name: `${groupKey}*${markdown.displayName}`,
            path: `/markdown/${groupKey}/${markdown.displayName}`,
            component: '/views/markdown/index.vue',
            meta: {
              title: markdown.displayName,
            },
          };
        }),
      });
    });

    return [
      {
        name: 'markdown',
        path: '/markdown',
        component: '/views/markdown/index.vue',
        meta: {
          title: '其它文档',
        },
        children: menus,
      },
    ];
  }
  return [];
};

const markDownGroupBy = (markdowns: MarkDownDes[], key: keyof MarkDownDes) => {
  // eslint-disable-next-line unicorn/no-array-reduce
  const group = markdowns.reduce(
    (result: Record<string, MarkDownDes[]>, currentItem: MarkDownDes) => {
      const groupKey = currentItem[key];
      (result[groupKey] = result[groupKey] || []).push(currentItem);
      return result;
    },
    {},
  );
  return group;
};
