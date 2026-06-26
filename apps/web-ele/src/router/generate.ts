import type { RouteRecordStringComponent } from '@vben/types';

import type { ServiceItem } from '#/store/aggregation';
import type {
  Brand,
  MarkDownDes,
  OpenAPISpec,
  PathMenuItem,
  Paths,
  SchemaObject,
  SwaggerConfig,
} from '#/typings/openApi';

import {
  SvgFileDownIcon,
  SvgGlobalConfigIcon,
  SvgMenuApiIcon,
  SvgMenuDocumentIcon,
  SvgMenuDocumentManageIcon,
  SvgMenuEntityIcon,
  SvgMenuSafetyIcon,
} from '@vben/icons';
import { updatePreferences } from '@vben/preferences';

import { getOpenAPIConfig } from '#/api/core/openApi';
import { baseRequestClient } from '#/api/request';
import { useApiStore, useApiTestCacheStore } from '#/store';
import { useAggregationStore } from '#/store/aggregation';
import { compareOperationLike, compareTagNames } from '#/utils/openapi-sort';

interface TagGroups {
  [tag: string]: Record<string, PathMenuItem[]>;
  all: Record<string, PathMenuItem[]>;
}

const hasGlobalSecurityConfig = (doc?: OpenAPISpec) => {
  return Object.keys(doc?.components?.securitySchemes ?? {}).length > 0;
};

const DEFAULT_WATERMARK_CONTENT = 'Nextdoc4j';

const resolveWatermarkContent = (doc?: OpenAPISpec) => {
  const brandTitle = doc?.['x-nextdoc4j']?.brand?.title?.trim?.();
  if (brandTitle) {
    return brandTitle;
  }

  const infoTitle = doc?.info?.title?.trim?.();
  if (infoTitle) {
    return infoTitle;
  }

  return DEFAULT_WATERMARK_CONTENT;
};

const createAuthorizeRoute = (): RouteRecordStringComponent<string> => ({
  meta: {
    icon: SvgMenuSafetyIcon,
    title: '全局认证',
  },
  name: '全局认证',
  path: '/authorize',
  component: 'views/authorize/index.vue',
});

/**
 * 生成「文档管理」菜单。全局认证作为其子项，仅在文档存在安全配置时挂载；
 * 全局配置与文档下载为固定子项。doc 用于判断当前文档是否包含安全方案。
 */
const createDocManageRoute = (
  doc?: OpenAPISpec,
): RouteRecordStringComponent<string> => {
  const children: RouteRecordStringComponent<string>[] = [
    {
      meta: {
        title: '全局配置',
        icon: SvgGlobalConfigIcon,
      },
      name: '全局配置',
      path: '/doc-manage/global-params',
      component: 'views/doc-manage/global-params/index.vue',
    },
    {
      meta: {
        title: '文档下载',
        icon: SvgFileDownIcon,
      },
      name: '文档下载',
      path: '/doc-manage/export',
      component: 'views/doc-manage/export/index.vue',
    },
  ];

  if (hasGlobalSecurityConfig(doc)) {
    children.unshift(createAuthorizeRoute());
  }

  return {
    meta: {
      icon: SvgMenuDocumentManageIcon,
      order: 1,
      title: '文档管理',
    },
    name: '文档管理',
    path: '/doc-manage',
    redirect: '/doc-manage/global-params',
    component: 'BasicLayout',
    children,
  };
};

/** 分组概览页路由名/路径中的标记，用于在概览组件中识别概览路由 */
const GROUP_OVERVIEW_MARKER = '__overview__';

/**
 * 生成接口分组的「概览」子路由，作为分组下第一个可点击的叶子节点。
 * 点击分组时自动跳转到此概览页，但不在左侧菜单和顶部标签中显示。
 * @param namePrefix 以 `*` 拼接的分组前缀（如 `all*用户管理`），概览组件据此读取分组下全部接口
 * @param groupPath 分组路由路径（如 `/document/all/用户管理`）
 * @returns 分组概览子路由配置
 */
const createGroupOverviewRoute = (
  namePrefix: string,
  groupPath: string,
): RouteRecordStringComponent<string> => ({
  meta: {
    keepAlive: true,
    title: '概览',
    activePath: groupPath,
    // 概览页不在左侧菜单和顶部标签中显示
    hideInMenu: true,
    hideInTab: true,
  },
  name: `${namePrefix}*${GROUP_OVERVIEW_MARKER}`,
  path: `${groupPath}/${GROUP_OVERVIEW_MARKER}`,
  // 复用 document/index.vue：其内部检测路由名中的 __overview__ 标记后渲染分组概览，
  // 与接口详情共用同一渲染出口，避免概览作为独立子路由无出口渲染。
  component: '/views/document/index.vue',
});

const SCHEMA_REF_PREFIX = '#/components/schemas/';

const appendSearchToken = (tokens: Set<string>, value?: unknown) => {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'function' ||
    typeof value === 'object'
  ) {
    return;
  }
  const text = `${value}`.trim();
  if (text) {
    tokens.add(text);
  }
};

const parseSchemaRefName = (ref?: string) => {
  if (!ref || !ref.startsWith(SCHEMA_REF_PREFIX)) {
    return '';
  }
  return ref.slice(SCHEMA_REF_PREFIX.length);
};

const collectSchemaSearchTokens = (
  schema: null | SchemaObject | undefined,
  tokens: Set<string>,
  seenObjects = new WeakSet<object>(),
  seenRefs = new Set<string>(),
) => {
  if (!schema || typeof schema !== 'object') {
    return;
  }

  if (seenObjects.has(schema)) {
    return;
  }
  seenObjects.add(schema);

  appendSearchToken(tokens, schema.title);
  appendSearchToken(tokens, schema.description);
  appendSearchToken(tokens, schema.type);
  appendSearchToken(tokens, schema.format);
  schema.required?.forEach((item) => appendSearchToken(tokens, item));
  schema.enum?.forEach((item) => appendSearchToken(tokens, item));

  const refName = parseSchemaRefName(schema.$ref);
  if (refName) {
    appendSearchToken(tokens, refName);
    if (seenRefs.has(refName)) {
      return;
    }
    seenRefs.add(refName);
  }

  Object.entries(schema.properties ?? {}).forEach(
    ([propertyName, property]) => {
      appendSearchToken(tokens, propertyName);
      collectSchemaSearchTokens(property, tokens, seenObjects, seenRefs);
    },
  );

  if (schema.items) {
    collectSchemaSearchTokens(schema.items, tokens, seenObjects, seenRefs);
  }

  schema.allOf?.forEach((item) =>
    collectSchemaSearchTokens(item, tokens, seenObjects, seenRefs),
  );
  schema.oneOf?.forEach((item) =>
    collectSchemaSearchTokens(item, tokens, seenObjects, seenRefs),
  );
  (schema as any).anyOf?.forEach((item: SchemaObject) =>
    collectSchemaSearchTokens(item, tokens, seenObjects, seenRefs),
  );
};

const createApiSearchText = (api: PathMenuItem) => {
  const tokens = new Set<string>();

  appendSearchToken(tokens, api.summary);
  appendSearchToken(tokens, api.description);
  appendSearchToken(tokens, api.operationId);
  appendSearchToken(tokens, api.path);
  appendSearchToken(tokens, api.method);
  api.tags?.forEach((tag) => appendSearchToken(tokens, tag));

  api.parameters?.forEach((parameter) => {
    appendSearchToken(tokens, parameter.name);
    appendSearchToken(tokens, parameter.in);
    appendSearchToken(tokens, parameter.description);
    collectSchemaSearchTokens(parameter.schema, tokens);
  });

  appendSearchToken(tokens, api.requestBody?.description);
  Object.entries(api.requestBody?.content ?? {}).forEach(
    ([contentType, body]) => {
      appendSearchToken(tokens, contentType);
      collectSchemaSearchTokens(body?.schema, tokens);
    },
  );

  Object.entries(api.responses ?? {}).forEach(([code, response]) => {
    appendSearchToken(tokens, code);
    appendSearchToken(tokens, response?.description);
    if (response?.schema) {
      collectSchemaSearchTokens(response.schema, tokens);
    }
    Object.entries(response?.content ?? {}).forEach(([contentType, body]) => {
      appendSearchToken(tokens, contentType);
      collectSchemaSearchTokens(body?.schema, tokens);
    });
  });

  return [...tokens].join(' ');
};

const createEntitySearchText = (name: string, schema?: null | SchemaObject) => {
  const tokens = new Set<string>();
  appendSearchToken(tokens, name);
  collectSchemaSearchTokens(schema, tokens);
  return [...tokens].join(' ');
};

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
  const apiTestCacheStore = useApiTestCacheStore();
  const groupOverviewEnabled = apiTestCacheStore.groupOverviewEnabled;
  const { openApi: gatewayOpenApi } = await aggregationStore.getMainConfig();

  const gatewayExtension = gatewayOpenApi?.['x-nextdoc4j'];
  if (gatewayExtension?.brand) {
    initBrand(gatewayExtension.brand);
  }

  let markDownMenus: RouteRecordStringComponent<string>[] = [];
  if (gatewayExtension?.markdown) {
    markDownMenus = initMarkdown(gatewayExtension.markdown);
  }
  const gatewayFallbackRoutes: RouteRecordStringComponent<string>[] = [
    ...markDownMenus,
  ];
  gatewayFallbackRoutes.unshift(createDocManageRoute(gatewayOpenApi));

  if (gatewayOpenApi?.info?.title) {
    updatePreferences({
      app: {
        name: gatewayOpenApi.info.title,
      },
    });
  }

  updatePreferences({
    app: {
      watermarkContent: resolveWatermarkContent(gatewayOpenApi),
    },
  });

  // 初始化聚合模式（获取服务列表，使用缓存）
  await aggregationStore.initAggregation();

  const currentService = aggregationStore.currentService;

  if (!currentService) {
    return gatewayFallbackRoutes;
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
    return gatewayFallbackRoutes;
  }

  // 检查服务数据是否有效
  if (!serviceData || !serviceData.paths) {
    console.error('Invalid service data:', serviceData);
    return gatewayFallbackRoutes;
  }

  const { paths, components } = serviceData;

  // 初始化主路由（all 分组）
  const { access, allPath } = initGroupRoute(paths, serviceData);

  // 处理服务内部的分组（类似单体模式）
  const { urls } = config;
  const entries: RouteRecordStringComponent<string>[] = [];

  // 处理实体路由
  Object.keys(components?.schemas ?? {}).forEach((key: string) => {
    const schemaDescription = components?.schemas?.[key]?.description || '';
    entries.push({
      component: '/views/entity/index.vue',
      name: `all*${key}`,
      meta: {
        title: key,
        keepAlive: true,
        description: schemaDescription,
        searchText: createEntitySearchText(key, components?.schemas?.[key]),
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
          const tagGroups = apiByTag(groupPaths, data);

          // 从 url 中提取 tag（如 "/v3/api-docs/user" -> "user"）
          const code = filterUrls?.[index]?.url?.split('/') ?? '';
          const tag = code[code.length - 1] ?? '';

          const accessRoutes: RouteRecordStringComponent[] = [];
          allPath[tag] = tagGroups;

          Object.entries(tagGroups).forEach(([key, groupedApis]) => {
            const children = groupedApis?.map((api) => {
              return {
                name: `${tag}*${key}*${api.operationId}`,
                path: `/document/${tag}/${key}/${api.operationId}`,
                meta: {
                  title: api.summary,
                  method: api.method,
                  keepAlive: true,
                  description: api.description,
                  searchText: createApiSearchText(api),
                  apiPath: api.path,
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
              // 点击分组默认打开概览页，同时左侧展开具体接口
              redirect: groupOverviewEnabled
                ? `/document/${tag}/${key}/${GROUP_OVERVIEW_MARKER}`
                : (children?.[0]?.path ?? '/empty'),
              children: groupOverviewEnabled
                ? [
                    createGroupOverviewRoute(
                      `${tag}*${key}`,
                      `/document/${tag}/${key}`,
                    ),
                    ...(children ?? []),
                  ]
                : (children ?? []),
            });
          });

          access.push({
            name: tag,
            path: `/document/${tag}`,
            component: '/views/document/index.vue',
            meta: {
              title: filterUrls?.[index]?.name ?? '默认分组',
            },
            children: groupOverviewEnabled
              ? [
                  createGroupOverviewRoute(tag, `/document/${tag}`),
                  ...accessRoutes,
                ]
              : accessRoutes,
            redirect: groupOverviewEnabled
              ? `/document/${tag}/${GROUP_OVERVIEW_MARKER}`
              : (accessRoutes[0]?.path ?? '/empty'),
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
            const schemaDescription =
              groupComponents?.schemas?.[key]?.description || '';
            entityGroup.children.push({
              component: '/views/entity/index.vue',
              name: `${tag}*${key}`,
              path: `/entity/${tag}/${key}`,
              meta: {
                title: key,
                description: schemaDescription,
                searchText: createEntitySearchText(
                  key,
                  groupComponents?.schemas?.[key],
                ),
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
          icon: SvgMenuApiIcon,
          title: '接口文档',
        },
        children: access,
      },
      {
        name: 'entity',
        path: '/entity',
        component: '/views/entity/index.vue',
        meta: {
          icon: SvgMenuEntityIcon,
          title: '实体模型',
        },
        children: accessEntries,
      },
      ...markDownMenus,
    ];

    routes.unshift(createDocManageRoute(gatewayOpenApi));

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
  const apiTestCacheStore = useApiTestCacheStore();
  const groupOverviewEnabled = apiTestCacheStore.groupOverviewEnabled;
  const { paths, components, 'x-nextdoc4j': xNextdoc4j } = data;
  const { access, allPath } = initGroupRoute(paths, data);

  if (xNextdoc4j && xNextdoc4j.brand) {
    initBrand(xNextdoc4j.brand);
  }
  let markDownMenus: RouteRecordStringComponent<string>[] = [];
  if (xNextdoc4j && xNextdoc4j.markdown) {
    markDownMenus = initMarkdown(xNextdoc4j.markdown);
  }
  Object.keys(components?.schemas ?? {}).forEach((key: string) => {
    const schemaDescription = components?.schemas?.[key]?.description || '';
    entries.push({
      component: '/views/entity/index.vue',
      name: `all*${key}`,
      meta: {
        title: key,
        keepAlive: true,
        description: schemaDescription,
        searchText: createEntitySearchText(key, components?.schemas?.[key]),
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
          const tagGroups = apiByTag(paths, data);

          const code = filterUrls?.[index]?.url?.split('/') ?? '';
          const tag = code[code.length - 1] ?? '';
          const accessRoutes: RouteRecordStringComponent[] = [];
          allPath[tag] = tagGroups;
          Object.entries(tagGroups).forEach(([key, groupedApis]) => {
            const children = groupedApis?.map((api) => {
              return {
                name: `${tag}*${key}*${api.operationId}`,
                path: `/document/${tag}/${key}/${api.operationId}`,
                meta: {
                  title: api.summary,
                  method: api.method,
                  keepAlive: true,
                  description: api.description,
                  searchText: createApiSearchText(api),
                  apiPath: api.path,
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
              // 点击分组默认打开概览页，同时左侧展开具体接口
              redirect: groupOverviewEnabled
                ? `/document/${tag}/${key}/${GROUP_OVERVIEW_MARKER}`
                : (children?.[0]?.path ?? '/empty'),
              children: groupOverviewEnabled
                ? [
                    createGroupOverviewRoute(
                      `${tag}*${key}`,
                      `/document/${tag}/${key}`,
                    ),
                    ...(children ?? []),
                  ]
                : (children ?? []),
            });
          });

          access.push({
            name: tag,
            path: `/document/${tag}`,
            component: '/views/document/index.vue',
            meta: {
              title: filterUrls?.[index]?.name ?? '默认分组',
            },
            children: groupOverviewEnabled
              ? [
                  createGroupOverviewRoute(tag, `/document/${tag}`),
                  ...accessRoutes,
                ]
              : accessRoutes,
            redirect: groupOverviewEnabled
              ? `/document/${tag}/${GROUP_OVERVIEW_MARKER}`
              : (accessRoutes[0]?.path ?? '/empty'),
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
            const schemaDescription =
              components?.schemas?.[key]?.description || '';
            entityGroup.children.push({
              component: '/views/entity/index.vue',
              name: `${tag}*${key}`,
              path: `/entity/${tag}/${key}`,
              meta: {
                title: key,
                description: schemaDescription,
                searchText: createEntitySearchText(
                  key,
                  components?.schemas?.[key],
                ),
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

  updatePreferences({
    app: {
      watermarkContent: resolveWatermarkContent(data),
    },
  });

  return new Promise((resolve) => {
    useApiStore().initConfig(allPath, data, config);
    const routes: RouteRecordStringComponent<string>[] = [
      {
        name: 'document',
        path: '/document',
        component: '/views/document/index.vue',
        meta: {
          icon: SvgMenuApiIcon,
          title: '接口文档',
        },
        children: access,
      },
      {
        name: 'entity',
        path: '/entity',
        component: '/views/entity/index.vue',
        meta: {
          icon: SvgMenuEntityIcon,
          title: '实体模型',
        },
        children: accessEntries,
      },
      ...markDownMenus,
    ];
    routes.unshift(createDocManageRoute(data));

    resolve(routes);
  });
};

export const apiByTag = (paths: Paths, spec?: OpenAPISpec) => {
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
  return Object.fromEntries(
    Object.entries(tagGroups)
      .sort(([leftTag], [rightTag]) => compareTagNames(leftTag, rightTag, spec))
      .map(([tag, items]) => [
        tag,
        [...items].sort((left, right) => compareOperationLike(left, right)),
      ]),
  );
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
          icon: SvgMenuDocumentIcon,
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

const initGroupRoute = (paths: Paths, spec?: OpenAPISpec) => {
  const accessRoutes: RouteRecordStringComponent<string>[] = [];
  const apiTestCacheStore = useApiTestCacheStore();
  const groupOverviewEnabled = apiTestCacheStore.groupOverviewEnabled;
  const tagGroups = apiByTag(paths, spec);
  const allPath: TagGroups = {
    all: {},
  };
  allPath.all = tagGroups;

  Object.entries(tagGroups).forEach(([key, groupedApis]) => {
    const children = groupedApis?.map((api) => {
      return {
        name: `all*${key}*${api.operationId}`,
        path: `/document/all/${key}/${api.operationId}`,
        meta: {
          title: api.summary,
          method: api.method,
          keepAlive: true,
          description: api.description,
          searchText: createApiSearchText(api),
          apiPath: api.path,
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
      // 点击分组默认打开概览页，同时左侧展开具体接口
      redirect: groupOverviewEnabled
        ? `/document/all/${key}/${GROUP_OVERVIEW_MARKER}`
        : (children?.[0]?.path ?? '/empty'),
      children: groupOverviewEnabled
        ? [
            createGroupOverviewRoute(`all*${key}`, `/document/all/${key}`),
            ...(children ?? []),
          ]
        : (children ?? []),
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
      redirect: groupOverviewEnabled
        ? `/document/all/${GROUP_OVERVIEW_MARKER}`
        : (accessRoutes[0]?.path ?? '/empty'),
      children: groupOverviewEnabled
        ? [createGroupOverviewRoute('all', '/document/all'), ...accessRoutes]
        : accessRoutes,
    },
  ];

  return { access, allPath };
};
