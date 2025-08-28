import { ref } from 'vue';

import { defineStore } from 'pinia';

export const useApiStore = defineStore('api', () => {
  const isInitConfig = ref(false);
  const apiData = ref<any>([]);
  const swaggerConfig = ref();
  const initConfig = (data, components) => {
    if (isInitConfig.value) return;
    apiData.value = data;
    isInitConfig.value = true;
    swaggerConfig.value = components;
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
  };
});
