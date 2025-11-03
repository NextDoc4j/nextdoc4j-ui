import type {
  ApiData,
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
    if (isInitConfig.value) return;
    apiData.value = data;
    isInitConfig.value = true;
    openApi.value = api;
    swaggerConfig.value = config;
  };
  const searchPathData = (group: string, tag: string, operationId: string) => {
    const paths = apiData.value[group]?.[tag];
    const data = paths?.find((item) => item.operationId === operationId);
    return data;
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
    initMarkDown,
    searchMarkDown,
  };
});
