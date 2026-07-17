<script setup lang="ts">
import type { ApiInfo } from '#/typings/openApi';

import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue';
import { useRoute } from 'vue-router';

import { usePreferences } from '@vben/preferences';

import { ElEmpty } from 'element-plus';

import Loading from '#/components/loading.vue';
import { useApiStore } from '#/store';

const loadApiTestPanel = () => import('#/components/api-test.vue');
const ApiTestPanel = defineAsyncComponent(loadApiTestPanel);
const DocumentPanel = defineAsyncComponent(
  () => import('./components/document.vue'),
);
// 分组概览页：当路由名以 __overview__ 结尾时，于本组件内直接渲染概览内容。
// 因为详情/概览同为分组的叶子路由且共用本组件，需按 route.name 分支渲染。
const GroupOverview = defineAsyncComponent(() => import('./overview.vue'));
const GROUP_OVERVIEW_MARKER = '__overview__';

interface DocumentExpose {
  getDebugPayload?: () => {
    info?: ApiInfo;
    requestBodyType?: string;
    requestBodyVariantState?: Record<string, number>;
  };
}

interface DebugTriggerPayload {
  info: ApiInfo;
  requestBodyType?: string;
  requestBodyVariantState?: Record<string, number>;
}

const { isDark } = usePreferences();
const route = useRoute();
const apiStore = useApiStore();

// 当前路由是否为分组概览页（路由名以 __overview__ 结尾）
const isOverview = computed(() => {
  const routeName = route.name;
  return (
    typeof routeName === 'string' && routeName.endsWith(GROUP_OVERVIEW_MARKER)
  );
});

const getViewStorageKey = () => `doc:activeView:${route.fullPath}`;
const activeView = ref<'debug' | 'detail'>(
  sessionStorage.getItem(getViewStorageKey()) === 'debug' ? 'debug' : 'detail',
);

const method = ref('');
const path = ref('');
const parameters = ref<any[]>([]);
const responses = ref<Record<string, any>>({});
const requestBody = ref();
const requestBodyType = ref('');
const requestBodyVariantState = ref<Record<string, number>>({});
const security = ref();
const info = ref<ApiInfo | null>(null);

const documentRef = shallowRef<DocumentExpose | null>(null);
let apiTestPanelPreloadPromise: null | Promise<unknown> = null;
let debugPreloadTimer: null | number = null;
let debugPreloadIdleHandle: null | number = null;
let debugPreloadLoadHandler: (() => void) | null = null;

interface NetworkInformationLike {
  effectiveType?: string;
  saveData?: boolean;
}

const preloadApiTestPanel = () => {
  apiTestPanelPreloadPromise ||= loadApiTestPanel();
  return apiTestPanelPreloadPromise;
};

const clearDebugPreloadTask = () => {
  if (debugPreloadTimer !== null) {
    window.clearTimeout(debugPreloadTimer);
    debugPreloadTimer = null;
  }

  if (
    debugPreloadIdleHandle !== null &&
    'cancelIdleCallback' in window &&
    typeof window.cancelIdleCallback === 'function'
  ) {
    window.cancelIdleCallback(debugPreloadIdleHandle);
    debugPreloadIdleHandle = null;
  }

  if (debugPreloadLoadHandler) {
    window.removeEventListener('load', debugPreloadLoadHandler);
    debugPreloadLoadHandler = null;
  }
};

const canAutoPreloadDebugPanel = () => {
  if (
    document.visibilityState !== 'visible' ||
    isOverview.value ||
    navigator.onLine === false
  ) {
    return false;
  }

  const connection = (
    navigator as Navigator & { connection?: NetworkInformationLike }
  ).connection;
  return (
    !connection?.saveData &&
    connection?.effectiveType !== 'slow-2g' &&
    connection?.effectiveType !== '2g'
  );
};

const preloadDebugPanelOnIntent = () => {
  clearDebugPreloadTask();
  void preloadApiTestPanel();
};

const scheduleDebugPanelPreload = () => {
  if (
    typeof window === 'undefined' ||
    apiTestPanelPreloadPromise ||
    isOverview.value
  ) {
    return;
  }

  const warmUpWhenIdle = () => {
    debugPreloadIdleHandle = null;
    if (!canAutoPreloadDebugPanel() || apiTestPanelPreloadPromise) {
      return;
    }
    void preloadApiTestPanel();
  };

  const scheduleWhenIdle = () => {
    debugPreloadTimer = null;
    if (!canAutoPreloadDebugPanel() || apiTestPanelPreloadPromise) {
      return;
    }

    if (
      'requestIdleCallback' in window &&
      typeof window.requestIdleCallback === 'function'
    ) {
      debugPreloadIdleHandle = window.requestIdleCallback(warmUpWhenIdle);
      return;
    }

    debugPreloadTimer = window.setTimeout(warmUpWhenIdle, 3000);
  };

  const scheduleAfterPageLoad = () => {
    debugPreloadLoadHandler = null;
    debugPreloadTimer = window.setTimeout(scheduleWhenIdle, 2000);
  };

  if (document.readyState === 'complete') {
    scheduleAfterPageLoad();
    return;
  }

  debugPreloadLoadHandler = scheduleAfterPageLoad;
  window.addEventListener('load', debugPreloadLoadHandler, { once: true });
};

const syncDebugState = (
  payload?: ApiInfo,
  selectedRequestBodyType?: string,
  selectedRequestBodyVariantState?: Record<string, number>,
) => {
  const detailPayload = documentRef.value?.getDebugPayload?.();
  const currentInfo = payload || detailPayload?.info;

  if (!currentInfo) {
    return false;
  }

  info.value = currentInfo;
  method.value = currentInfo.method;
  path.value = currentInfo.path;
  parameters.value = currentInfo.parameters ?? [];
  responses.value = currentInfo.responses ?? {};
  requestBody.value = currentInfo.requestBody;
  security.value = currentInfo.security;
  requestBodyType.value =
    selectedRequestBodyType ?? detailPayload?.requestBodyType ?? '';
  const nextRequestBodyVariantState = {
    ...(selectedRequestBodyVariantState ??
      detailPayload?.requestBodyVariantState),
  };
  if (
    JSON.stringify(requestBodyVariantState.value) !==
    JSON.stringify(nextRequestBodyVariantState)
  ) {
    requestBodyVariantState.value = nextRequestBodyVariantState;
  }
  return true;
};

const syncDebugFromStore = () => {
  const routeName = route.name;
  if (typeof routeName !== 'string') return false;
  const [group = '', tag = '', operationId = ''] = routeName.split('*');
  const apiInfo = apiStore.searchPathData(group, tag, operationId);
  if (apiInfo) {
    syncDebugState(apiInfo);
    return true;
  }
  return false;
};

const handleTest = (payload: DebugTriggerPayload) => {
  syncDebugState(
    payload.info,
    payload.requestBodyType,
    payload.requestBodyVariantState,
  );
  void preloadApiTestPanel();
  activeView.value = 'debug';
};

const handleClose = () => {
  activeView.value = 'detail';
};

watch(activeView, async (view) => {
  sessionStorage.setItem(getViewStorageKey(), view);
  if (view === 'detail') return;

  await nextTick();
  if (!syncDebugState()) {
    syncDebugFromStore();
  }
});

const debugReady = computed(() =>
  Boolean(info.value && method.value && path.value),
);

onMounted(() => {
  scheduleDebugPanelPreload();
  if (activeView.value === 'debug' && !syncDebugFromStore()) {
    // store 数据未就绪，等待 apiStore.isInitConfig 变为 true 后再同步
    const stop = watch(
      () => apiStore.isInitConfig,
      (ready) => {
        if (!ready) return;
        syncDebugFromStore();
        stop();
      },
    );
  }
});

watch(isOverview, (overview) => {
  clearDebugPreloadTask();
  if (!overview) {
    scheduleDebugPanelPreload();
  }
});

onBeforeUnmount(() => {
  clearDebugPreloadTask();
});
</script>

<template>
  <div
    class="document-page h-full overflow-hidden"
    :class="{
      'document-page--dark': isDark,
      'document-page--overview': isOverview,
    }"
  >
    <!-- 分组概览页：路由名以 __overview__ 结尾时渲染，展示该分组下全部接口 -->
    <div v-if="isOverview" class="document-view">
      <Suspense>
        <template #default>
          <GroupOverview />
        </template>
        <template #fallback>
          <Loading />
        </template>
      </Suspense>
    </div>

    <!-- 接口详情：常驻挂载，切换在线调试时通过 v-show 隐藏以保留状态 -->
    <div v-show="!isOverview && activeView === 'detail'" class="document-view">
      <Suspense>
        <template #default>
          <DocumentPanel
            ref="documentRef"
            @test="handleTest"
            @preload-test="preloadDebugPanelOnIntent"
            :show-test="activeView === 'debug'"
          />
        </template>
        <template #fallback>
          <Loading />
        </template>
      </Suspense>
    </div>

    <!-- 在线调试：首次进入调试后才挂载（依赖 debugReady） -->
    <div v-show="!isOverview && activeView === 'debug'" class="document-view">
      <Suspense>
        <template #default>
          <ApiTestPanel
            v-if="debugReady && info"
            :method="method"
            :path="path"
            :parameters="parameters"
            :responses="responses"
            :request-body="requestBody"
            :security="security"
            :request-body-type="requestBodyType"
            :request-body-variant-state="requestBodyVariantState"
            @cancel="handleClose"
          />
          <div
            v-else-if="apiStore.isInitConfig"
            class="document-empty flex h-full items-center justify-center"
          >
            <ElEmpty description="未获取到当前接口信息，请先进入详情页" />
          </div>
          <div v-else class="h-full">
            <Loading />
          </div>
        </template>
        <template #fallback>
          <Loading />
        </template>
      </Suspense>
    </div>
  </div>
</template>

<style scoped lang="scss">
.document-page {
  --doc-radius-xl: calc(var(--radius) * 1.42);
  --doc-radius-lg: calc(var(--radius) * 1.18);
  --doc-radius-md: calc(var(--radius) * 0.94);
  --doc-radius-sm: calc(var(--radius) * 0.72);
  --doc-page-bg: #f8fafc;
  --doc-overview-bg: var(--el-fill-color-light);
  --el-border-radius-base: calc(var(--radius) * 0.75);
  --el-border-radius-small: calc(var(--radius) * 0.62);

  padding: 0;
  background: var(--doc-page-bg);
}

.document-page--dark {
  --doc-page-bg: var(--el-bg-color);
}

.document-page--overview {
  padding: 0;
  background: var(--doc-overview-bg);
}

.document-view {
  height: 100%;
  overflow: hidden;
}

.document-empty {
  background: var(--doc-page-bg);
  border: 1px dashed var(--el-border-color);
  border-radius: var(--doc-radius-xl);
}
</style>
