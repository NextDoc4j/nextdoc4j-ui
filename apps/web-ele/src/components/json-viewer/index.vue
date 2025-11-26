<script setup lang="ts">
import { computed, ref } from 'vue';

import { preferences } from '@vben/preferences';

import { generateExample } from '#/utils/schema';

import JsonNode from './json-node.vue';

const props = withDefaults(
  defineProps<{
    defaultExpanded?: boolean;
    schema: any;
  }>(),
  {
    defaultExpanded: true,
  },
);

const rootNode = ref<InstanceType<typeof JsonNode> | null>(null);

const parsedData = computed(() => {
  if (!props.schema) {
    return null;
  }
  try {
    return generateExample(props.schema);
  } catch (error) {
    console.error('Failed to generate example from schema:', error);
    return null;
  }
});

const parseError = computed(() => {
  if (parsedData.value === null && props.schema) {
    return 'Invalid schema format';
  }
  return null;
});

function expandAll() {
  rootNode.value?.expandAll();
}

function collapseAll() {
  rootNode.value?.collapseAll();
}

defineExpose({
  expandAll,
  collapseAll,
});
</script>

<template>
  <div
    class="overflow-auto rounded p-4 font-mono text-sm"
    :class="`theme-${preferences.theme.mode}`"
  >
    <div v-if="parseError" class="json-error">
      <span class="text-sm">⚠️</span>
      <span>{{ parseError }}</span>
    </div>
    <div v-else-if="!parsedData" class="json-empty">
      <span>暂无数据</span>
    </div>
    <JsonNode
      v-else
      ref="rootNode"
      :value="parsedData"
      :key-name="null"
      :depth="0"
      :default-expanded="defaultExpanded"
      :schema="schema"
      :parent-schema="null"
    />
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
</style>
