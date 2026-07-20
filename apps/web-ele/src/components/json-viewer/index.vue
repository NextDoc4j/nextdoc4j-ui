<script setup lang="ts">
import type { SchemaViewMode } from '#/utils/schema';

import { computed, ref } from 'vue';

import { preferences } from '@vben/preferences';

import { usePreferredDark } from '@vueuse/core';

import { generateExample } from '#/utils/schema';

import JsonNode from './json-node.vue';

const props = withDefaults(
  defineProps<{
    autoExpandDepth?: number;
    defaultExpanded?: boolean;
    enableChunkedRender?: boolean;
    initialRenderCount?: number;
    mode?: SchemaViewMode;
    renderChunkSize?: number;
    schema?: any;
    value?: unknown;
    wrapLongValues?: boolean;
  }>(),
  {
    autoExpandDepth: Number.POSITIVE_INFINITY,
    defaultExpanded: true,
    enableChunkedRender: false,
    initialRenderCount: 120,
    mode: 'entity',
    renderChunkSize: 120,
    schema: undefined,
    value: undefined,
    wrapLongValues: false,
  },
);

const rootNode = ref<InstanceType<typeof JsonNode> | null>(null);
const scrollHostRef = ref<HTMLElement | null>(null);
const preferredDark = usePreferredDark();

const resolvedThemeMode = computed(() => {
  if (preferences.theme.mode === 'auto') {
    return preferredDark.value ? 'dark' : 'light';
  }
  return preferences.theme.mode;
});

const parsedResult = computed<{ data: unknown; error: null | string }>(() => {
  if (props.value !== undefined) {
    return {
      data: props.value,
      error: null,
    };
  }

  if (!props.schema) {
    return {
      data: null,
      error: null,
    };
  }

  try {
    return {
      data: generateExample(props.schema, { mode: props.mode }),
      error: null,
    };
  } catch (error) {
    console.error('Failed to generate example from schema:', error);
    return {
      data: null,
      error: 'Invalid schema format',
    };
  }
});

const parsedData = computed(() => parsedResult.value.data);
const parseError = computed(() => parsedResult.value.error);
const isEmptyData = computed(() => {
  return parsedData.value === null || parsedData.value === undefined;
});

function expandAll() {
  rootNode.value?.expandAll();
}

function collapseAll() {
  rootNode.value?.collapseAll();
}

function getScrollTop() {
  return scrollHostRef.value?.scrollTop ?? 0;
}

function setScrollTop(value: number) {
  if (!scrollHostRef.value) {
    return;
  }
  scrollHostRef.value.scrollTop = Math.max(0, value);
}

defineExpose({
  expandAll,
  collapseAll,
  getScrollTop,
  setScrollTop,
});
</script>

<template>
  <div
    ref="scrollHostRef"
    class="json-viewer-scroll-host overflow-auto rounded p-4 font-mono text-sm"
    :class="[
      `theme-${resolvedThemeMode}`,
      { 'json-viewer-scroll-host--wrap-values': wrapLongValues },
    ]"
  >
    <div class="json-viewer-content">
      <div v-if="parseError" class="json-error">
        <span class="text-sm">⚠️</span>
        <span>{{ parseError }}</span>
      </div>
      <div v-else-if="isEmptyData" class="json-empty">
        <span>暂无数据</span>
      </div>
      <JsonNode
        v-else
        ref="rootNode"
        :value="parsedData"
        :key-name="null"
        :depth="0"
        :default-expanded="defaultExpanded"
        :auto-expand-depth="autoExpandDepth"
        :enable-chunked-render="enableChunkedRender"
        :initial-render-count="initialRenderCount"
        :render-chunk-size="renderChunkSize"
        :schema="schema"
        :parent-schema="null"
      />
    </div>
  </div>
</template>

<style scoped>
.theme-dark {
  border: 1px solid #36363a;
}

.theme-dark .json-error {
  color: #f48771;
  background: rgb(244 135 113 / 10%);
}

.theme-dark .json-empty {
  color: #858585;
}

.theme-light {
  border: 1px solid #e4e4e7;
}

.theme-light .json-error {
  color: #d73a49;
}

.theme-light .json-empty {
  color: #6a737d;
}

.json-error,
.json-empty {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px;
  font-weight: 700;
  border-radius: 6px;
}

.json-viewer-content {
  width: max-content;
  min-width: 100%;
}

.json-viewer-scroll-host--wrap-values .json-viewer-content {
  width: 100%;
  min-width: 0;
}

.json-viewer-scroll-host--wrap-values :deep(.json-node),
.json-viewer-scroll-host--wrap-values :deep(.node-virtual-block) {
  min-width: 0;
  max-width: 100%;
}

.json-viewer-scroll-host--wrap-values :deep(.node-primitive) {
  align-items: flex-start;
  min-width: 0;
  max-width: 100%;
}

.json-viewer-scroll-host--wrap-values :deep(.node-primitive > .key-wrapper),
.json-viewer-scroll-host--wrap-values
  :deep(.node-primitive > .primitive-content) {
  flex: none;
}

.json-viewer-scroll-host--wrap-values
  :deep(.node-primitive > .primitive-content) {
  display: block;
  flex: 0 1 auto;
  min-width: 0;
}

.json-viewer-scroll-host--wrap-values
  :deep(.primitive-content > .value-string) {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.json-viewer-scroll-host--wrap-values
  :deep(.primitive-content > .field-description) {
  display: inline-flex;
  white-space: nowrap;
}

.json-viewer-scroll-host :deep(*) {
  transition: none !important;
  animation: none !important;
}
</style>
