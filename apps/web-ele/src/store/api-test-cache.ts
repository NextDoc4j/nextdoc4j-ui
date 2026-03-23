import { ref } from 'vue';

import { defineStore } from 'pinia';

export interface ApiTestParamCacheItem {
  contentType?: string;
  description?: string;
  enabled: boolean;
  format?: string;
  fromGlobal?: boolean;
  name: string;
  required?: boolean;
  type?: string;
  value: string | string[];
}

export interface ApiTestRequestCache {
  activeTab: string;
  bodyContent?: string;
  bodyType?: string;
  cookies: ApiTestParamCacheItem[];
  formDataParams: ApiTestParamCacheItem[];
  headers: ApiTestParamCacheItem[];
  pathParams: ApiTestParamCacheItem[];
  queryParams: ApiTestParamCacheItem[];
  requestUrl: string;
  urlEncodedParams: ApiTestParamCacheItem[];
}

export const useApiTestCacheStore = defineStore(
  'api-test-cache',
  () => {
    const debugCacheEnabled = ref(true);
    const requestCache = ref<Record<string, ApiTestRequestCache>>({});

    const getRequestCache = (cacheKey: string) => {
      return requestCache.value[cacheKey];
    };

    const saveRequestCache = (
      cacheKey: string,
      payload: ApiTestRequestCache,
    ) => {
      requestCache.value[cacheKey] = payload;
    };

    const removeRequestCache = (cacheKey: string) => {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete requestCache.value[cacheKey];
    };

    const clearAllRequestCache = () => {
      requestCache.value = {};
    };

    return {
      debugCacheEnabled,
      requestCache,
      getRequestCache,
      saveRequestCache,
      removeRequestCache,
      clearAllRequestCache,
    };
  },
  {
    persist: true,
  },
);
