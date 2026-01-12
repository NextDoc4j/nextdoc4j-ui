import type { TabDefinition } from '@vben/types';

import type { ApiData, OpenAPISpec, SwaggerConfig } from '#/typings/openApi';

import { ref } from 'vue';

import { defineStore } from 'pinia';

import { getOpenAPI, getOpenAPIConfig } from '#/api/core/openApi';
import { baseRequestClient } from '#/api/request';

const STORAGE_KEY = 'nextdoc4j-current-service';
const STORAGE_TABS_KEY = 'nextdoc4j-service-tabs';

export interface ServiceItem {
  name: string;
  url: string;
}

/**
 * 微服务缓存数据结构
 */
interface ServiceCache {
  openApi: OpenAPISpec;
  config: SwaggerConfig;
  apiData: ApiData;
  groupDocs?: Map<string, OpenAPISpec>; // 分组文档缓存
}

/**
 * 微服务标签页状态
 */
interface ServiceTabsState {
  tabs: TabDefinition[];
  currentTab: null | string;
}

export const useAggregationStore = defineStore('aggregation', () => {
  const isAggregation = ref(false);
  const services = ref<ServiceItem[]>([]);
  const currentService = ref<null | ServiceItem>(null);
  const isInit = ref(false);

  // 主配置缓存（避免重复请求）
  const mainConfigCache = ref<{
    config?: SwaggerConfig;
    openApi?: OpenAPISpec;
  }>({});

  // 微服务数据缓存
  const serviceCache = ref<Map<string, ServiceCache>>(new Map());

  // 各微服务的标签页状态
  const serviceTabsState = ref<Map<string, ServiceTabsState>>(new Map());

  /**
   * 从 localStorage 获取保存的服务
   */
  const getStoredService = (): null | ServiceItem => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch {
      // ignore
    }
    return null;
  };

  /**
   * 保存当前服务到 localStorage
   */
  const storeService = (service: ServiceItem) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(service));
    } catch {
      // ignore
    }
  };

  /**
   * 获取主配置（带缓存）
   */
  const getMainConfig = async () => {
    if (mainConfigCache.value.openApi && mainConfigCache.value.config) {
      return {
        openApi: mainConfigCache.value.openApi,
        config: mainConfigCache.value.config,
      };
    }

    const [openApiResult, configResult] = await Promise.all([
      getOpenAPI(),
      getOpenAPIConfig(),
    ]);

    mainConfigCache.value.openApi = openApiResult.data;
    mainConfigCache.value.config = configResult.data;

    return {
      openApi: openApiResult.data,
      config: configResult.data,
    };
  };

  /**
   * 获取微服务数据（带缓存）
   */
  const getServiceData = async (
    service: ServiceItem,
  ): Promise<{
    apiData: ApiData;
    config: SwaggerConfig;
    openApi: OpenAPISpec;
  }> => {
    const cacheKey = service.url;

    const cached = serviceCache.value.get(cacheKey);
    if (cached) {
      return cached;
    }

    // 获取服务文档 - baseRequestClient 返回 AxiosResponse，需要 .data 获取实际数据
    const openApiResponse = await baseRequestClient.get<{
      data: OpenAPISpec;
    }>(service.url);
    const openApi = (openApiResponse as any).data || openApiResponse;

    // 获取服务配置
    const configResponse = await baseRequestClient.get<{
      data: SwaggerConfig;
    }>(`${service.url}/swagger-config`);
    const config = (configResponse as any).data || configResponse;

    // 构建 apiData（这里需要返回，后续由路由生成逻辑填充）
    const apiData: ApiData = {};

    const cacheData: ServiceCache = {
      openApi,
      config,
      apiData,
      groupDocs: new Map(),
    };

    serviceCache.value.set(cacheKey, cacheData);

    return cacheData;
  };

  /**
   * 获取微服务的分组文档（带缓存）
   */
  const getServiceGroupDoc = async (
    service: ServiceItem,
    groupUrl: string,
  ): Promise<OpenAPISpec> => {
    const cacheKey = service.url;
    const cache = serviceCache.value.get(cacheKey);

    if (!cache) {
      throw new Error('Service cache not found');
    }

    const cachedDoc = cache.groupDocs?.get(groupUrl);
    if (cachedDoc) {
      return cachedDoc;
    }

    const response = await baseRequestClient.get<{ data: OpenAPISpec }>(
      groupUrl,
    );
    const data = (response as any).data || response;

    if (!cache.groupDocs) {
      cache.groupDocs = new Map();
    }
    cache.groupDocs.set(groupUrl, data);

    return data;
  };

  /**
   * 更新微服务的 apiData
   */
  const updateServiceApiData = (serviceUrl: string, apiData: ApiData) => {
    const cache = serviceCache.value.get(serviceUrl);
    if (cache) {
      cache.apiData = apiData;
    }
  };

  /**
   * 保存当前微服务的标签页状态
   */
  const saveCurrentTabsState = (tabs: TabDefinition[], currentTab: string) => {
    if (!currentService.value) return;

    serviceTabsState.value.set(currentService.value.url, {
      tabs,
      currentTab,
    });

    persistTabsState();
  };

  /**
   * 获取指定微服务的标签页状态
   */
  const getServiceTabsState = (service: ServiceItem): ServiceTabsState => {
    return (
      serviceTabsState.value.get(service.url) || {
        tabs: [],
        currentTab: null,
      }
    );
  };

  /**
   * 持久化标签页状态到 localStorage
   */
  const persistTabsState = () => {
    try {
      const state = [...serviceTabsState.value.entries()].map(([url, data]) => [
        url,
        data,
      ]);
      localStorage.setItem(STORAGE_TABS_KEY, JSON.stringify(state));
    } catch {
      // ignore
    }
  };

  /**
   * 从 localStorage 恢复标签页状态
   */
  const restoreTabsState = () => {
    try {
      const stored = localStorage.getItem(STORAGE_TABS_KEY);
      if (stored) {
        const state = JSON.parse(stored);
        serviceTabsState.value = new Map(state);
      }
    } catch {
      // ignore
    }
  };

  /**
   * 初始化聚合模式
   */
  const initAggregation = async () => {
    if (isInit.value) return;

    // 先设置为聚合模式，确保 UI 能显示
    isAggregation.value = true;
    isInit.value = true;

    // 恢复标签页状态
    restoreTabsState();

    try {
      const { config } = await getMainConfig();

      if (config.urls && config.urls.length > 0) {
        services.value = config.urls.map((item) => ({
          name: item.name,
          url: item.url,
        }));

        // 尝试从 localStorage 恢复之前选择的服务
        const storedService = getStoredService();

        // 验证保存的服务是否仍在列表中
        const validStoredService =
          storedService &&
          services.value.find((s) => s.url === storedService.url);

        // 默认选中第一个服务
        currentService.value = validStoredService || services.value[0] || null;
      }
    } catch (error) {
      console.error('Failed to load aggregation config:', error);
      // 加载失败时关闭聚合模式
      isAggregation.value = false;
    }
  };

  /**
   * 切换当前服务
   * @param service 服务项
   */
  const switchService = (service: ServiceItem) => {
    currentService.value = service;
    // 保存到 localStorage
    storeService(service);
  };

  /**
   * 重置聚合模式
   */
  const reset = () => {
    isAggregation.value = false;
    services.value = [];
    currentService.value = null;
    isInit.value = false;
    mainConfigCache.value = {};
    serviceCache.value.clear();
    serviceTabsState.value.clear();
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_TABS_KEY);
    } catch {
      // ignore
    }
  };

  return {
    isAggregation,
    services,
    currentService,
    isInit,
    mainConfigCache,
    serviceCache,
    serviceTabsState,
    getMainConfig,
    getServiceData,
    getServiceGroupDoc,
    updateServiceApiData,
    saveCurrentTabsState,
    getServiceTabsState,
    initAggregation,
    switchService,
    reset,
  };
});
