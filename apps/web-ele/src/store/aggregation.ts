import { ref } from 'vue';

import { defineStore } from 'pinia';

import { getOpenAPIConfig } from '#/api/core/openApi';

const STORAGE_KEY = 'nextdoc4j-current-service';

export interface ServiceItem {
  name: string;
  url: string;
}

export const useAggregationStore = defineStore('aggregation', () => {
  const isAggregation = ref(false);
  const services = ref<ServiceItem[]>([]);
  const currentService = ref<null | ServiceItem>(null);
  const isInit = ref(false);

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
   * 初始化聚合模式
   */
  const initAggregation = async () => {
    if (isInit.value) return;

    // 先设置为聚合模式，确保 UI 能显示
    isAggregation.value = true;
    isInit.value = true;

    try {
      const { data: config } = await getOpenAPIConfig();
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
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  };

  return {
    isAggregation,
    services,
    currentService,
    isInit,
    initAggregation,
    switchService,
    reset,
  };
});
