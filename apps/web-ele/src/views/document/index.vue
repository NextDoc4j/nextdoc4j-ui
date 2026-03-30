<script setup lang="ts">
import type { ApiInfo } from '#/typings/openApi';

import {
  computed,
  defineAsyncComponent,
  nextTick,
  ref,
  shallowRef,
  watch,
} from 'vue';

import { usePreferences } from '@vben/preferences';

import { ElEmpty, ElTabPane, ElTabs } from 'element-plus';

import Loading from '#/components/loading.vue';

const ApiTestPanel = defineAsyncComponent(
  () => import('#/components/api-test.vue'),
);
const DocumentPanel = defineAsyncComponent(
  () => import('./components/document.vue'),
);

interface DocumentExpose {
  getDebugPayload?: () => {
    info?: ApiInfo;
    requestBodyType?: string;
  };
}

const activeView = ref<'debug' | 'detail'>('detail');
const method = ref('');
const path = ref('');
const parameters = ref<any[]>([]);
const requestBody = ref();
const requestBodyType = ref('');
const security = ref();
const info = ref<ApiInfo | null>(null);

const documentRef = shallowRef<DocumentExpose | null>(null);
const { isDark } = usePreferences();

const syncDebugState = (payload?: ApiInfo) => {
  const detailPayload = documentRef.value?.getDebugPayload?.();
  const currentInfo = payload || detailPayload?.info;

  if (!currentInfo) {
    return false;
  }

  info.value = currentInfo;
  method.value = currentInfo.method;
  path.value = currentInfo.path;
  parameters.value = currentInfo.parameters ?? [];
  requestBody.value = currentInfo.requestBody;
  security.value = currentInfo.security;
  requestBodyType.value = detailPayload?.requestBodyType ?? '';
  return true;
};

const handleTest = (data: ApiInfo) => {
  syncDebugState(data);
  activeView.value = 'debug';
};

const handleClose = () => {
  activeView.value = 'detail';
};

watch(activeView, async (view) => {
  if (view !== 'debug') {
    return;
  }

  await nextTick();
  syncDebugState();
});

const debugReady = computed(() =>
  Boolean(info.value && method.value && path.value),
);
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
              :request-body="requestBody"
              :security="security"
              :request-body-type="requestBodyType"
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
  --doc-radius-xl: calc(var(--radius) * 4);
  --doc-radius-lg: calc(var(--radius) * 3);
  --doc-radius-md: calc(var(--radius) * 2.25);
  --doc-radius-sm: calc(var(--radius) * 1.75);
  --doc-page-bg: #fff;

  padding: 20px;
  background: var(--doc-page-bg);
}

.document-page--dark {
  --doc-page-bg: #000;
}

.document-tabs {
  :deep(.el-tabs__header) {
    margin: 0 0 12px;
    background: var(--doc-page-bg);
    border: 1px solid var(--el-border-color-light);
    border-radius: var(--doc-radius-lg);
    box-shadow: 0 8px 18px
      color-mix(in srgb, var(--el-text-color-primary) 4%, transparent);
  }

  :deep(.el-tabs__nav-wrap) {
    padding: 4px;
  }

  :deep(.el-tabs__nav) {
    gap: 4px;
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
    color: var(--el-text-color-primary);
    background: color-mix(
      in srgb,
      var(--el-bg-color) 88%,
      var(--el-color-primary-light-9) 12%
    );
    box-shadow:
      inset 0 0 0 1px
        color-mix(in srgb, var(--el-color-primary) 18%, transparent),
      0 8px 18px color-mix(in srgb, var(--el-color-primary) 12%, transparent);
  }
}

.document-tab-label {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 92px;
  padding: 7px 12px;
  color: var(--el-text-color-secondary);
  border-radius: var(--doc-radius-sm);
  transition: all 0.2s ease;
}

.document-tab-label__title {
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
}

.document-empty {
  background: var(--doc-page-bg);
  border: 1px dashed var(--el-border-color);
  border-radius: var(--doc-radius-xl);
}
</style>
