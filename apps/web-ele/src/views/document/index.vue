<script setup lang="ts">
import { computed, defineAsyncComponent, ref, shallowRef } from 'vue';

import { Pane, Splitpanes } from 'splitpanes';

import 'splitpanes/dist/splitpanes.css';

// 懒加载组件
const apiTest = defineAsyncComponent(() => import('#/components/api-test.vue'));
const document = defineAsyncComponent(
  () => import('./components/document.vue'),
);

const drawer = ref(false);
const method = ref();
const path = ref();
const parameters = ref();
const requestBody = ref();
const security = ref();
const testDrawRef = ref();
const info = ref();

// 使用 shallowRef 优化大对象响应性
const documentRef = shallowRef();

const handleTest = (data: any) => {
  info.value = data;
  method.value = data.method;
  path.value = data.path;
  parameters.value = data?.parameters ?? [];
  requestBody.value = data.requestBody;
  security.value = data.security;
  drawer.value = true;
};

const requestBodyType = computed(() => {
  return documentRef.value?.requestBodyType ?? '';
});

const handleClose = () => {
  drawer.value = false;
};
</script>

<template>
  <Splitpanes class="default-theme h-full" ref="testDrawRef">
    <Pane :size="70" :min-size="50">
      <Suspense>
        <template #default>
          <document ref="documentRef" @test="handleTest" :show-test="drawer" />
        </template>
        <template #fallback>
          <div class="flex h-full items-center justify-center">
            <div class="text-center">
              <div class="loading">
                <div class="loader"></div>
                <div class="title">正在加载API文档</div>
              </div>
            </div>
          </div>
        </template>
      </Suspense>
    </Pane>
    <Pane :size="30" :min-size="30" :max-size="50" v-if="drawer">
      <Suspense>
        <template #default>
          <api-test
            :method="method"
            :path="path"
            :parameters="parameters"
            :request-body="info.requestBody"
            :security="security"
            :request-body-type="requestBodyType"
            @cancel="handleClose"
          />
        </template>
        <template #fallback>
          <div class="flex h-full items-center justify-center">
            <div class="text-center">
              <div class="loading">
                <div class="loader"></div>
                <div class="title">正在加载API测试工具</div>
              </div>
            </div>
          </div>
        </template>
      </Suspense>
    </Pane>
  </Splitpanes>
</template>

<style lang="scss">
.full-space {
  > :deep(.el-space__item) {
    width: 100%;
  }
}

.app-json-schema-viewer {
  width: 100%;
  max-width: 800px;

  & > .index-node-wrap:first-child {
    & > .index-node {
      @apply pt-0;
    }
  }

  .index-node {
    @apply relative max-w-full;
  }

  /* stylelint-disable-next-line selector-class-pattern */
  .index_child-stack {
    @apply my-0 ms-5;

    .index-node-wrap {
      @apply border-l last:border-0;

      &:last-child {
        /* stylelint-disable-next-line selector-class-pattern */
        .index_sub-border {
          margin-left: 0;
          border-left: 1px solid var(--el-border-color);
        }
      }
    }

    .index-node {
      @apply ps-5;
    }

    /* stylelint-disable-next-line selector-class-pattern */
    .index_sub-border {
      position: absolute;
      top: -1.65rem;
      left: -1.25rem;
      width: 1.25rem;
      height: 2.5rem;
      margin-left: -12px;
      border-bottom: 1px solid var(--el-border-color);
      border-radius: 0;
    }
  }

  .index-key {
    flex-grow: 0;
    flex-shrink: 0;
    margin-right: 4px;
    font-weight: 400;
    color: #667085;
  }

  .index-value {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 6px;
    font-size: 12px;
    font-weight: 400;
    line-height: 20px;
    color: #667085;
    word-break: break-all;
    background: rgb(16 24 40 / 4%);
    border-radius: 6px;
  }

  .text-muted-big {
    font-size: 14px;
    font-weight: 500;
    color: #667085;
  }

  /* stylelint-disable-next-line selector-class-pattern */
  .index_additionalInformation__title {
    margin: 0 8px;
    color: #667085;
  }

  .property-name {
    padding: 0 8px;
    margin-right: 8px;
    font-size: 12px;
    font-weight: 600;
    line-height: 22px;
    color: #1890ff;
    background-color: rgb(24 144 255 / 4%);
    border-radius: 6px;
  }
}

.index-required {
  height: 22px;
  padding: 0 12px;
  font-size: 12px;
  line-height: 22px;
  color: #f79009;
  white-space: nowrap;
}

.index-optional {
  height: 22px;
  padding: 0 12px;
  font-size: 12px;
  line-height: 22px;
  color: #667085;
  white-space: nowrap;
}

.index-divider {
  flex: 1;
  height: 0;
  margin: 0 6px;
  border: 1px dashed transparent !important;
}

.index-node:hover {
  .index-divider {
    border: 1px dashed var(--el-border-color) !important;
  }
}

.el-card {
  border-radius: 12px;
}

.default-theme.splitpanes {
  background-color: transparent;
  transition: none;

  .splitpanes__pane {
    background-color: transparent;
    transition: none;
  }

  .splitpanes__splitter {
    background-color: var(--el-bg-color);
    border: 1px dashed var(--el-border-color);
    border-left: 1px dashed var(--el-border-color) !important;
  }
}
</style>
