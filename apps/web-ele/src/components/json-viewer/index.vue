<script setup lang="ts">
import { computed, ref } from 'vue';

import { preferences } from '@vben/preferences';

import JsonNode from './json-node.vue';

const props = withDefaults(
  defineProps<{
    defaultExpanded?: boolean;
    jsonString: string;
  }>(),
  {
    defaultExpanded: true,
  },
);

const rootNode = ref<InstanceType<typeof JsonNode> | null>(null);

const parsedData = computed(() => {
  try {
    return JSON.parse(props.jsonString);
  } catch {
    return null;
  }
});

const parseError = computed(() => {
  if (parsedData.value === null && props.jsonString.trim()) {
    return 'Invalid JSON format';
  }
  return null;
});

function expandAll() {
  rootNode.value?.expandAll();
}

function collapseAll() {
  rootNode.value?.collapseAll();
}

async function copyJson() {
  try {
    await navigator.clipboard.writeText(JSON.stringify(parsedData.value));
    return true;
  } catch (error) {
    throw new Error(error as string);
  }
}

defineExpose({
  expandAll,
  collapseAll,
  copyJson,
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
    <JsonNode
      v-else
      ref="rootNode"
      :value="parsedData"
      :key-name="null"
      :depth="0"
      :default-expanded="defaultExpanded"
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

.theme-light {
  border: 1px solid #e4e4e7;
}

.theme-light .json-error {
  color: #d73a49;
}

.json-error {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px;
  font-weight: 700;
  border-radius: 6px;
}
</style>
