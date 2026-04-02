<script setup lang="ts">
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
    renderChunkSize?: number;
    schema?: any;
    value?: unknown;
  }>(),
  {
    autoExpandDepth: Number.POSITIVE_INFINITY,
    defaultExpanded: true,
    enableChunkedRender: false,
    initialRenderCount: 120,
    renderChunkSize: 120,
    schema: undefined,
    value: undefined,
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
      data: generateExample(props.schema),
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
    :class="`theme-${resolvedThemeMode}`"
  >
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
</template>

<style scoped>
.theme-dark {
  contain: layout paint style;
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
  contain: layout paint style;
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

.json-viewer-scroll-host :deep(*) {
  transition: none !important;
  animation: none !important;
}
</style>
