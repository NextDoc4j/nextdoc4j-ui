import type { OpenAPISpec, SwaggerConfig } from '#/typings/openApi';

import { ref } from 'vue';

import { defineStore } from 'pinia';

export const useApiStore = defineStore('api', () => {
  const isInitConfig = ref(false);
  const apiData = ref<any>([]);
  const openApi = ref<OpenAPISpec>();
  const swaggerConfig = ref<SwaggerConfig>();
  const initConfig = (data, api: OpenAPISpec, config: SwaggerConfig) => {
    if (isInitConfig.value) return;
    apiData.value = data;
    isInitConfig.value = true;
    openApi.value = api;
    swaggerConfig.value = config;
  };
  const searchPathData = (group: string, tag: string, operationId: string) => {
    const paths = apiData.value[group][tag];
    const data = paths.find((item) => item.operationId === operationId);
    return data;
  };
  return {
    initConfig,
    isInitConfig,
    apiData,
    searchPathData,
    swaggerConfig,
    openApi,
  };
});
