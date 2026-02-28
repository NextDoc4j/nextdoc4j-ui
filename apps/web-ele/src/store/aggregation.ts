import type { TabDefinition } from '@vben/types';

import type {
  OpenAPISpec,
  SwaggerConfig,
  SwaggerServiceItem,
} from '#/typings/openApi';

import { ref } from 'vue';

import { defineStore } from 'pinia';

import { getOpenAPI, getOpenAPIConfig } from '#/api/core/openApi';
import { baseRequestClient } from '#/api/request';

const STORAGE_KEY = 'nextdoc4j-current-service';
const STORAGE_TABS_KEY = 'nextdoc4j-service-tabs';

export interface ServiceItem {
  name: string;
  url: string;
  contextPath?: string;
  disabled?: boolean;
  reason?: string;
  serviceId?: string;
  status?: 'DOWN' | 'UNKNOWN' | 'UP';
}

/**
 * 微服务缓存数据结构
 */
interface ServiceCache {
  openApi?: OpenAPISpec;
  config?: SwaggerConfig;
  apiData: ServiceApiData;
  groupDocs: Map<string, OpenAPISpec>; // 分组文档缓存
}

/**
 * 微服务标签页状态
 */
interface ServiceTabsState {
  tabs: TabDefinition[];
  currentTab: null | string;
}

interface ServiceData {
  apiData: ServiceApiData;
  config: SwaggerConfig;
  openApi: OpenAPISpec;
}

type ServiceApiData = Record<string, Record<string, any[]>>;

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
  const serviceDataPending = ref<Map<string, Promise<ServiceData>>>(new Map());

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

  const buildServiceItem = (item: SwaggerServiceItem): ServiceItem => ({
    name: item.name,
    url: item.url,
    contextPath: item.contextPath,
    disabled: item.disabled ?? false,
    reason: item.reason,
    serviceId: item.serviceId,
    status: item.status ?? 'UNKNOWN',
  });

  const updateServiceStatus = (
    serviceUrl: string,
    patch: Partial<ServiceItem>,
  ) => {
    services.value = services.value.map((service) =>
      service.url === serviceUrl ? { ...service, ...patch } : service,
    );

    if (currentService.value?.url === serviceUrl) {
      currentService.value =
        services.value.find((service) => service.url === serviceUrl) || null;
    }
  };

  const getOrCreateServiceCache = (serviceUrl: string): ServiceCache => {
    const cache = serviceCache.value.get(serviceUrl);
    if (cache) {
      return cache;
    }

    const created: ServiceCache = {
      apiData: {},
      groupDocs: new Map(),
    };
    serviceCache.value.set(serviceUrl, created);
    return created;
  };

  const resolveResponseData = <T>(response: unknown): T => {
    return ((response as any)?.data ?? response) as T;
  };

  const probeServiceAvailability = async (service: ServiceItem) => {
    try {
      const openApiResponse = await baseRequestClient.get<{
        data: OpenAPISpec;
      }>(service.url, { timeout: 3000 });
      const cache = getOrCreateServiceCache(service.url);
      cache.openApi = resolveResponseData<OpenAPISpec>(openApiResponse);

      updateServiceStatus(service.url, {
        disabled: false,
        reason: '',
        status: 'UP',
      });
      return true;
    } catch (error: any) {
      updateServiceStatus(service.url, {
        disabled: true,
        reason: error?.message || 'Service unavailable',
        status: 'DOWN',
      });
      return false;
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
  const getServiceData = async (service: ServiceItem): Promise<ServiceData> => {
    const cacheKey = service.url;
    const pending = serviceDataPending.value.get(cacheKey);
    if (pending) {
      return pending;
    }

    const task = (async (): Promise<ServiceData> => {
      const cache = getOrCreateServiceCache(cacheKey);

      // 首次进入聚合页时，probe 已经拉过 openApi，这里只做增量补全
      if (!cache.openApi) {
        const openApiResponse = await baseRequestClient.get<{
          data: OpenAPISpec;
        }>(service.url);
        cache.openApi = resolveResponseData<OpenAPISpec>(openApiResponse);
      }

      if (!cache.config) {
        const configResponse = await baseRequestClient.get<{
          data: SwaggerConfig;
        }>(`${service.url}/swagger-config`);
        cache.config = resolveResponseData<SwaggerConfig>(configResponse);
      }

      if (!cache.openApi || !cache.config) {
        throw new Error('Incomplete service cache data');
      }

      return {
        apiData: cache.apiData,
        config: cache.config,
        openApi: cache.openApi,
      };
    })().finally(() => {
      serviceDataPending.value.delete(cacheKey);
    });

    serviceDataPending.value.set(cacheKey, task);
    return task;
  };

  /**
   * 获取微服务的分组文档（带缓存）
   */
  const getServiceGroupDoc = async (
    service: ServiceItem,
    groupUrl: string,
  ): Promise<OpenAPISpec> => {
    const cacheKey = service.url;
    const cache = getOrCreateServiceCache(cacheKey);

    const cachedDoc = cache.groupDocs.get(groupUrl);
    if (cachedDoc) {
      return cachedDoc;
    }

    const response = await baseRequestClient.get<{ data: OpenAPISpec }>(
      groupUrl,
    );
    const data = (response as any).data || response;

    cache.groupDocs.set(groupUrl, data);

    return data;
  };

  /**
   * 更新微服务的 apiData
   */
  const updateServiceApiData = (
    serviceUrl: string,
    apiData: ServiceApiData,
  ) => {
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
        services.value = config.urls.map((item) => buildServiceItem(item));

        // 预探测服务可用性，并同步为 UI 状态
        await Promise.all(
          services.value.map((service) => probeServiceAvailability(service)),
        );

        // 尝试从 localStorage 恢复之前选择的服务
        const storedService = getStoredService();

        // 验证保存的服务是否仍在列表中
        const validStoredService =
          storedService &&
          services.value.find((s) => s.url === storedService.url);

        // 只优先选择可用服务；如果都不可用，回退到列表第一项
        const firstEnabledService =
          services.value.find((service) => !service.disabled) || null;
        currentService.value =
          (validStoredService && !validStoredService.disabled
            ? validStoredService
            : null) ||
          firstEnabledService ||
          services.value[0] ||
          null;
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
    if (service.disabled) {
      return;
    }
    currentService.value = service;
    // 保存到 localStorage
    storeService(service);
  };

  /**
   * 获取可用服务的文档数据（自动容错回退）
   */
  const getAvailableServiceData = async (preferred?: null | ServiceItem) => {
    const candidateServices = [
      ...(preferred ? [preferred] : []),
      ...services.value.filter(
        (service) => !preferred || service.url !== preferred.url,
      ),
    ];

    let latestError: null | unknown = null;
    for (const service of candidateServices) {
      try {
        const data = await getServiceData(service);
        updateServiceStatus(service.url, {
          disabled: false,
          reason: '',
          status: 'UP',
        });
        if (!currentService.value || currentService.value.url !== service.url) {
          currentService.value = service;
          storeService(service);
        }
        return {
          service,
          ...data,
        };
      } catch (error: any) {
        latestError = error;
        updateServiceStatus(service.url, {
          disabled: true,
          reason: error?.message || 'Service unavailable',
          status: 'DOWN',
        });
      }
    }

    throw latestError || new Error('No available service');
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
    serviceDataPending.value.clear();
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
    getAvailableServiceData,
    updateServiceApiData,
    saveCurrentTabsState,
    getServiceTabsState,
    initAggregation,
    switchService,
    reset,
  };
});
