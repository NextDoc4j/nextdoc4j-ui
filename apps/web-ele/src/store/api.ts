import type {
  ApiData,
  ApiInfo,
  MarkDownDes,
  MarkDownGroup,
  OpenAPISpec,
  SwaggerConfig,
} from '#/typings/openApi';

import { ref } from 'vue';

import { defineStore } from 'pinia';

export const useApiStore = defineStore('api', () => {
  const isInitConfig = ref(false);
  const apiData = ref<ApiData>({});
  const openApi = ref<OpenAPISpec>();
  const swaggerConfig = ref<SwaggerConfig>();
  const markDownGroup = ref<MarkDownGroup>({} as MarkDownGroup);

  const initConfig = (
    data: ApiData,
    api: OpenAPISpec,
    config: SwaggerConfig,
  ) => {
    apiData.value = data;
    isInitConfig.value = true;
    openApi.value = api;
    swaggerConfig.value = config;
  };

  /**
   * 重置配置（用于切换微服务时重新初始化）
   */
  const resetConfig = () => {
    isInitConfig.value = false;
  };

  const searchPathData = (group: string, tag: string, operationId: string) => {
    const paths = apiData.value[group]?.[tag];
    const data = paths?.find((item) => item.operationId === operationId);
    return data as unknown as ApiInfo;
  };
  const initMarkDown = (group: Record<keyof MarkDownDes, MarkDownDes[]>) => {
    markDownGroup.value = group;
  };

  const searchMarkDown = (group: keyof MarkDownDes, name: string) => {
    return markDownGroup.value[group].find((item) => item.displayName === name);
  };

  return {
    isInitConfig,
    apiData,
    swaggerConfig,
    openApi,
    searchPathData,
    initConfig,
    resetConfig,
    initMarkDown,
    searchMarkDown,
  };
});
