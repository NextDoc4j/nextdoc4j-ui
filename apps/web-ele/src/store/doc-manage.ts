import { computed, ref } from 'vue';

import { defineStore } from 'pinia';

export interface GlobalParamItem {
  description?: string;
  enabled: boolean;
  id: string;
  name: string;
  value: string;
}

interface ScopeParams {
  headerParams: GlobalParamItem[];
  queryParams: GlobalParamItem[];
}

const ALL_SCOPE_KEY = 'all';

const createEmptyScope = (): ScopeParams => ({
  headerParams: [],
  queryParams: [],
});

const normalizeHeaderName = (name: string) => name.trim().toLowerCase();

const cloneParams = (params: ScopeParams): ScopeParams => {
  return {
    headerParams: params.headerParams.map((item) => ({ ...item })),
    queryParams: params.queryParams.map((item) => ({ ...item })),
  };
};

const toScopeKey = (serviceUrl?: null | string) => {
  return serviceUrl ? `service:${serviceUrl}` : ALL_SCOPE_KEY;
};

export const useDocManageStore = defineStore(
  'doc-manage',
  () => {
    const scopedParams = ref<Record<string, ScopeParams>>({
      [ALL_SCOPE_KEY]: createEmptyScope(),
    });

    const ensureScope = (scopeKey: string) => {
      if (!scopedParams.value[scopeKey]) {
        scopedParams.value[scopeKey] = createEmptyScope();
      }
      return scopedParams.value[scopeKey];
    };

    const setScopeParams = (
      scopeKey: string,
      payload: Partial<ScopeParams>,
    ) => {
      const current = ensureScope(scopeKey);
      scopedParams.value[scopeKey] = {
        headerParams:
          payload.headerParams?.map((item) => ({ ...item })) ??
          current.headerParams,
        queryParams:
          payload.queryParams?.map((item) => ({ ...item })) ??
          current.queryParams,
      };
    };

    const getScopeParams = (scopeKey: string): ScopeParams => {
      return cloneParams(ensureScope(scopeKey));
    };

    const getMergedQueryParams = (serviceUrl?: null | string) => {
      const allParams = ensureScope(ALL_SCOPE_KEY).queryParams;
      const serviceScope = ensureScope(toScopeKey(serviceUrl)).queryParams;

      const map = new Map<string, GlobalParamItem>();
      allParams.forEach((item) => {
        if (!item.name) return;
        map.set(item.name, { ...item });
      });
      serviceScope.forEach((item) => {
        if (!item.name) return;
        map.set(item.name, { ...item });
      });

      return [...map.values()];
    };

    const getMergedHeaderParams = (serviceUrl?: null | string) => {
      const allParams = ensureScope(ALL_SCOPE_KEY).headerParams;
      const serviceScope = ensureScope(toScopeKey(serviceUrl)).headerParams;

      const map = new Map<string, GlobalParamItem>();
      allParams.forEach((item) => {
        if (!item.name) return;
        map.set(normalizeHeaderName(item.name), { ...item });
      });
      serviceScope.forEach((item) => {
        if (!item.name) return;
        map.set(normalizeHeaderName(item.name), { ...item });
      });

      return [...map.values()];
    };

    const mergedAllQueryParams = computed(() => getMergedQueryParams());
    const mergedAllHeaderParams = computed(() => getMergedHeaderParams());

    return {
      ALL_SCOPE_KEY,
      scopedParams,
      ensureScope,
      getScopeParams,
      getMergedHeaderParams,
      getMergedQueryParams,
      mergedAllHeaderParams,
      mergedAllQueryParams,
      setScopeParams,
      toScopeKey,
    };
  },
  {
    persist: true,
  },
);
