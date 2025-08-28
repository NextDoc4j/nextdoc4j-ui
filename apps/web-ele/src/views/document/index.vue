<script setup lang="ts">
import { computed, ref } from 'vue';

import { Pane, Splitpanes } from 'splitpanes';

import apiTest from '#/components/api-test.vue';

import document from './components/document.vue';

import 'splitpanes/dist/splitpanes.css';

const drawer = ref(false);
const method = ref();
const path = ref();
const parameters = ref();
const requestBody = ref();
const security = ref();
const testDrawRef = ref();
const info = ref();
const handleTest = (data) => {
  info.value = data;
  method.value = data.method;
  path.value = data.path;
  parameters.value = data?.parameters ?? [];
  requestBody.value = data.requestBody;
  security.value = data.security;
  drawer.value = true;
};
const documentRef = ref();
const requestBodyType = computed(() => {
  return documentRef.value.requestBodyType ?? '';
});
const handleClose = () => {
  drawer.value = false;
};
</script>

<template>
  <Splitpanes class="default-theme h-full" ref="testDrawRef">
    <Pane :size="70" :min-size="50">
      <document ref="documentRef" @test="handleTest" :show-test="drawer" />
    </Pane>
    <Pane :size="30" :min-size="30" :max-size="50" v-if="drawer">
      <api-test
        :method="method"
        :path="path"
        :parameters="parameters"
        :request-body="info.requestBody"
        :security="security"
        :request-body-type="requestBodyType"
        @cancel="handleClose"
      />
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

.el-collapse {
  .el-collapse-item__header {
    padding: 0 20px;
    border-bottom: 1px solid var(--el-border-color) !important;
  }

  .el-collapse-item__wrap {
    padding: 0 20px 20px;
  }
}

.default-theme.splitpanes .splitpanes__pane {
  background-color: transparent;
  transition: none;
}
</style>
