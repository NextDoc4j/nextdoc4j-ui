import type { RouteRecordStringComponent } from '@vben/types';

import type { ServiceItem } from '#/store/aggregation';
import type {
  Brand,
  MarkDownDes,
  OpenAPISpec,
  PathMenuItem,
  Paths,
  SwaggerConfig,
} from '#/typings/openApi';

import { updatePreferences } from '@vben/preferences';

import { getOpenAPIConfig } from '#/api/core/openApi';
import { baseRequestClient } from '#/api/request';
import { useApiStore } from '#/store';
import { useAggregationStore } from '#/store/aggregation';

interface TagGroups {
  [tag: string]: Record<string, PathMenuItem[]>;
  all: Record<string, PathMenuItem[]>;
}

export const fetchMenuListAsync: () => Promise<
  RouteRecordStringComponent<string>[]
> = async () => {
  const aggregationStore = useAggregationStore();

  // 使用缓存获取主配置
  const { openApi: data } = await aggregationStore.getMainConfig();

  if (!data) {
    throw new Error('Failed to load OpenAPI data');
  }

  const { 'x-nextdoc4j-aggregation': aggregation } = data;

  // 检测聚合模式
  if (aggregation?.aggregation) {
    return fetchAggregationRoutes();
  }

  // 原有的单应用模式
  const { config } = await aggregationStore.getMainConfig();
  return fetchSingleAppRoutes(data, config);
};

/**
 * 聚合模式路由生成
 */
const fetchAggregationRoutes: () => Promise<
  RouteRecordStringComponent<string>[]
> = async () => {
  return fetchAggregationRoutesImpl();
};

/**
 * 聚合模式路由生成实现（导出供外部调用）
 * 用于服务切换时重新生成路由
 */
export const fetchAggregationRoutesImpl: () => Promise<
  RouteRecordStringComponent<string>[]
> = async () => {
  const aggregationStore = useAggregationStore();
  const apiStore = useApiStore();

  // 初始化聚合模式（获取服务列表，使用缓存）
  await aggregationStore.initAggregation();

  const currentService = aggregationStore.currentService;

  if (!currentService) {
    // 如果没有服务，返回空路由
    return [];
  }

  // 获取可用服务数据（首个服务不可用时自动回退到后续服务）
  let selectedService: ServiceItem;
  let serviceData: OpenAPISpec;
  let config: SwaggerConfig;
  try {
    const data = await aggregationStore.getAvailableServiceData(currentService);
    selectedService = data.service;
    serviceData = data.openApi;
    config = data.config;
  } catch (error) {
    console.error('No available services for aggregation mode:', error);
    return [];
  }

  // 检查服务数据是否有效
  if (!serviceData || !serviceData.paths) {
    console.error('Invalid service data:', serviceData);
    return [];
  }

  const {
    paths,
    components,
    'x-nextdoc4j': xNextdoc4j,
    security,
  } = serviceData;

  // 处理品牌和 markdown
  if (xNextdoc4j && xNextdoc4j.brand) {
    initBrand(xNextdoc4j.brand);
  }

  let markDownMenus: RouteRecordStringComponent<string>[] = [];
  if (xNextdoc4j && xNextdoc4j.markdown) {
    markDownMenus = initMarkdown(xNextdoc4j.markdown);
  }

  // 初始化主路由（all 分组）
  const { access, allPath } = initGroupRoute(paths);

  // 处理服务内部的分组（类似单体模式）
  const { urls } = config;
  const entries: RouteRecordStringComponent<string>[] = [];

  // 处理实体路由
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

  // 处理分组（类似单体模式，但使用服务内部的分组）
  if (urls) {
    try {
      const filterUrls = urls.filter(({ url }) => {
        const code = url.split('/');
        const tag = code[code.length - 1];
        return tag !== 'all';
      });

      if (filterUrls.length > 0) {
        // 获取服务前缀（如 "/file" from "/file/v3/api-docs"）
        const servicePrefix = selectedService.url.replace('/v3/api-docs', '');

        // 使用缓存并行请求所有分组的文档
        const dataList = await Promise.all(
          filterUrls.map(({ url }) => {
            // url 格式: "/v3/api-docs/user"
            // 需要拼接为: "/file/v3/api-docs/user"
            const fullUrl = `${servicePrefix}${url}`;
            return aggregationStore.getServiceGroupDoc(
              selectedService,
              fullUrl,
            );
          }),
        );

        dataList.forEach((data, index) => {
          const { paths: groupPaths, components: groupComponents } = data;
          const tagGroups = apiByTag(groupPaths);

          // 从 url 中提取 tag（如 "/v3/api-docs/user" -> "user"）
          const code = filterUrls?.[index]?.url?.split('/') ?? '';
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
              title: filterUrls?.[index]?.name ?? '默认分组',
            },
            children: accessRoutes,
            redirect:
              accessRoutes.length > 0 ? accessRoutes[0]?.path : '/empty',
          });

          // 实体分组
          const entityGroup: RouteRecordStringComponent<string> = {
            component: '/views/entity/index.vue',
            name: `entity*${tag}`,
            path: `/entity/${tag}`,
            meta: {
              title: filterUrls?.[index]?.name ?? '默认分组',
            },
            children: [],
          };

          Object.keys(groupComponents?.schemas ?? {}).forEach((key: string) => {
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
        });
      }
    } catch (error) {
      console.error('Failed to load service groups:', error);
    }
  }

  // 更新应用标题
  if (serviceData?.info?.title) {
    updatePreferences({
      app: {
        name: serviceData.info.title,
      },
    });
  }

  return new Promise((resolve) => {
    // 更新聚合 store 中的 apiData
    aggregationStore.updateServiceApiData(selectedService.url, allPath);

    // 初始化 api store（确保组件能正常使用）
    apiStore.initConfig(allPath, serviceData, config);

    const routes: RouteRecordStringComponent<string>[] = [
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
    ];

    if (security) {
      routes.unshift({
        meta: {
          title: '全局认证',
        },
        name: '全局认证',
        path: '/authorize',
        component: 'views/authorize/index.vue',
      });
    }

    resolve(routes);
  });
};

/**
 * 单应用模式路由生成
 */
const fetchSingleAppRoutes: (
  data: OpenAPISpec,
  config?: SwaggerConfig,
) => Promise<RouteRecordStringComponent<string>[]> = async (data, config) => {
  const entries: RouteRecordStringComponent<string>[] = [];
  const { paths, components, 'x-nextdoc4j': xNextdoc4j, security } = data;
  const { access, allPath } = initGroupRoute(paths);

  if (xNextdoc4j && xNextdoc4j.brand) {
    initBrand(xNextdoc4j.brand);
  }
  let markDownMenus: RouteRecordStringComponent<string>[] = [];
  if (xNextdoc4j && xNextdoc4j.markdown) {
    markDownMenus = initMarkdown(xNextdoc4j.markdown);
  }
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

  // 如果没有传入 config，则请求获取
  if (!config) {
    const { data: configData } = await getOpenAPIConfig();
    config = configData;
  }
  const { urls } = config;
  if (urls) {
    try {
      const filterUrls = urls.filter(({ url }) => {
        const code = url.split('/');
        const tag = code[code.length - 1];
        return tag !== 'all';
      });
      if (filterUrls.length > 0) {
        const fetchList = filterUrls.map(({ url }) =>
          baseRequestClient.get(url),
        );
        const dataList = await Promise.all(fetchList);
        dataList.forEach(({ data }, index) => {
          const { paths, components } = data;
          const tagGroups = apiByTag(paths);

          const code = filterUrls?.[index]?.url?.split('/') ?? '';
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
              title: filterUrls?.[index]?.name ?? '默认分组',
            },
            children: accessRoutes,
            redirect:
              accessRoutes.length > 0 ? accessRoutes[0]?.path : '/empty',
          });
          const entityGroup: RouteRecordStringComponent<string> = {
            component: '/views/entity/index.vue',
            name: `entity*${tag}`,
            path: `/entity/${tag}`,
            meta: {
              title: filterUrls?.[index]?.name ?? '默认分组',
            },
            children: [],
          };
          Object.keys(components?.schemas ?? {}).forEach((key: string) => {
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
        });
      }
    } catch {}
  }
  if (data?.info?.title) {
    updatePreferences({
      app: {
        name: data.info.title,
      },
    });
  }

  return new Promise((resolve) => {
    useApiStore().initConfig(allPath, data, config);
    const routes: RouteRecordStringComponent<string>[] = [
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
    ];
    if (security) {
      routes.unshift({
        meta: {
          title: '全局认证',
        },
        name: '全局认证',
        path: '/authorize',
        component: 'views/authorize/index.vue',
      });
    }

    resolve(routes);
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

const initGroupRoute = (paths: Paths) => {
  const accessRoutes: RouteRecordStringComponent<string>[] = [];
  const tagGroups = apiByTag(paths);
  const allPath: TagGroups = {
    all: {},
  };
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
  const access: RouteRecordStringComponent<string>[] = [
    {
      name: 'all',
      path: '/document/all',
      component: '/views/document/index.vue',
      meta: {
        title: '所有接口',
      },
      redirect: accessRoutes.length > 0 ? accessRoutes[0]?.path : '/empty',
      children: accessRoutes,
    },
  ];

  return { access, allPath };
};
