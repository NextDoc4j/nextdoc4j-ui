<script setup lang="ts">
import type { ApiInfo } from '#/typings/openApi';

import {
  computed,
  defineAsyncComponent,
  onBeforeUnmount,
  onMounted,
  nextTick,
  ref,
  shallowRef,
  watch,
} from 'vue';

import { usePreferences } from '@vben/preferences';

import { ElEmpty, ElTabPane, ElTabs } from 'element-plus';

import Loading from '#/components/loading.vue';

const loadApiTestPanel = () => import('#/components/api-test.vue');
const ApiTestPanel = defineAsyncComponent(loadApiTestPanel);
const DocumentPanel = defineAsyncComponent(
  () => import('./components/document.vue'),
);

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

const activeView = ref<'debug' | 'detail'>('detail');
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
const { isDark } = usePreferences();
let apiTestPanelPreloadPromise: null | Promise<unknown> = null;
let debugPreloadTimer: null | number = null;
let debugPreloadIdleHandle: null | number = null;

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
};

const scheduleDebugPanelPreload = () => {
  if (typeof window === 'undefined' || apiTestPanelPreloadPromise) {
    return;
  }

  const warmUp = () => {
    debugPreloadTimer = null;
    debugPreloadIdleHandle = null;
    void preloadApiTestPanel();
  };

  if (
    'requestIdleCallback' in window &&
    typeof window.requestIdleCallback === 'function'
  ) {
    debugPreloadIdleHandle = window.requestIdleCallback(warmUp, {
      timeout: 1200,
    });
    return;
  }

  debugPreloadTimer = window.setTimeout(warmUp, 360);
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
  requestBodyVariantState.value = {
    ...(selectedRequestBodyVariantState ??
      detailPayload?.requestBodyVariantState),
  };
  return true;
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
  if (view === 'detail') {
    return;
  }

  await nextTick();
  syncDebugState();
});

const debugReady = computed(() =>
  Boolean(info.value && method.value && path.value),
);

onMounted(() => {
  scheduleDebugPanelPreload();
});

onBeforeUnmount(() => {
  clearDebugPreloadTask();
});
</script>

<template>
  <div
    class="document-page h-full overflow-hidden"
    :class="{ 'document-page--dark': isDark }"
  >
    <ElTabs v-model="activeView" class="document-tabs h-full">
      <ElTabPane name="detail" lazy>
        <template #label>
          <div class="document-tab-label">
            <span class="document-tab-label__title">接口详情</span>
          </div>
        </template>

        <Suspense>
          <template #default>
            <DocumentPanel
              ref="documentRef"
              @test="handleTest"
              :show-test="activeView === 'debug'"
            />
          </template>
          <template #fallback>
            <Loading />
          </template>
        </Suspense>
      </ElTabPane>

      <ElTabPane name="debug" lazy>
        <template #label>
          <div class="document-tab-label">
            <span class="document-tab-label__title">在线调试</span>
          </div>
        </template>

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
              v-else
              class="document-empty flex h-full items-center justify-center"
            >
              <ElEmpty description="未获取到当前接口信息，请先进入详情页" />
            </div>
          </template>
          <template #fallback>
            <Loading />
          </template>
        </Suspense>
      </ElTabPane>
    </ElTabs>
  </div>
</template>

<style scoped lang="scss">
.document-page {
  --doc-radius-xl: calc(var(--radius) * 1.42);
  --doc-radius-lg: calc(var(--radius) * 1.18);
  --doc-radius-md: calc(var(--radius) * 0.94);
  --doc-radius-sm: calc(var(--radius) * 0.72);
  --doc-page-bg: var(--el-bg-color);
  --el-border-radius-base: calc(var(--radius) * 0.75);
  --el-border-radius-small: calc(var(--radius) * 0.62);

  padding: 20px;
  background: var(--doc-page-bg);
}

.document-page--dark {
  --doc-page-bg: color-mix(
    in srgb,
    var(--el-bg-color) 90%,
    var(--el-fill-color-light) 10%
  );
}

.document-tabs {
  :deep(.el-tabs__header) {
    margin: 0 0 12px;
    overflow: hidden;
    background: var(--doc-page-bg);
    border: 1px solid
      color-mix(in srgb, var(--el-border-color) 92%, transparent);
    border-radius: var(--doc-radius-lg);
    box-shadow: 0 8px 18px
      color-mix(in srgb, var(--el-text-color-primary) 4%, transparent);
  }

  :deep(.el-tabs__nav-wrap) {
    padding: 4px;
    border-radius: var(--doc-radius-md);
  }

  :deep(.el-tabs__nav-wrap::after) {
    display: none;
  }

  :deep(.el-tabs__nav) {
    gap: 6px;
  }

  :deep(.el-tabs__active-bar) {
    display: none;
  }

  :deep(.el-tabs__item) {
    height: auto;
    padding: 0;
  }

  :deep(.el-tabs__content) {
    height: calc(100% - 60px);
    overflow: hidden;
  }

  :deep(.el-tab-pane) {
    height: 100%;
    overflow: hidden;
  }

  :deep(.is-active .document-tab-label) {
    color: var(--el-color-primary);
    background: color-mix(
      in srgb,
      var(--el-bg-color) 82%,
      var(--el-color-primary-light-9) 18%
    );
    border-color: color-mix(in srgb, var(--el-color-primary) 45%, transparent);
    box-shadow:
      inset 0 0 0 1px
        color-mix(in srgb, var(--el-color-primary) 28%, transparent),
      0 10px 22px color-mix(in srgb, var(--el-color-primary) 20%, transparent);
    transform: translateY(-1px);
  }

  :deep(.is-active .document-tab-label__title) {
    font-weight: 800;
  }

  :deep(.el-tabs__item:not(.is-active) .document-tab-label:hover) {
    color: var(--el-text-color-primary);
    background: color-mix(
      in srgb,
      var(--el-bg-color) 90%,
      var(--el-fill-color-light) 10%
    );
    border-color: color-mix(
      in srgb,
      var(--el-text-color-primary) 16%,
      transparent
    );
  }
}

.document-tab-label {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 108px;
  padding: 8px 14px;
  color: var(--el-text-color-secondary);
  background: color-mix(
    in srgb,
    var(--el-bg-color) 92%,
    var(--el-fill-color-light) 8%
  );
  border: 1px solid transparent;
  border-radius: var(--doc-radius-sm);
  transition: all 0.18s ease;
}

.document-tab-label__title {
  font-size: 13px;
  font-weight: 700;
  line-height: 1.2;
}

.document-empty {
  background: var(--doc-page-bg);
  border: 1px dashed var(--el-border-color);
  border-radius: var(--doc-radius-xl);
}
</style>
