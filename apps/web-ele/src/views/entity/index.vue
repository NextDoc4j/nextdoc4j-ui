<script setup lang="ts">
import { computed, onBeforeMount, ref } from 'vue';
import { useRoute } from 'vue-router';

import { ElCard, ElCol, ElRow } from 'element-plus';

import JsonViewer from '#/components/json-viewer/index.vue';
import { useApiStore } from '#/store';
import { processSchema, resolveSchema } from '#/utils/schema';

import entityTr from './components/entity-tr.vue';

const route = useRoute();
const entityInfo = ref();
const apiStore = useApiStore();

const treeData = ref();
const fold = ref(false);
const defaultExpanded = ref(true);

const schemaWithExamples = computed(() => {
  if (!entityInfo.value) return null;
  const resolved = resolveSchema(entityInfo.value);
  return normalizeSchemaForExample(resolved);
});

function normalizeSchemaForExample(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;

  if (Array.isArray(schema)) {
    return schema.map((item) => normalizeSchemaForExample(item));
  }

  if (schema.oneOf?.length) {
    return normalizeSchemaForExample(schema.oneOf[0]);
  }

  if (schema.allOf?.length) {
    const merged: any = { type: 'object', properties: {} };
    schema.allOf.forEach((item: any) => {
      const normalized = normalizeSchemaForExample(item);
      if (normalized?.properties) {
        Object.assign(merged.properties, normalized.properties);
      }
    });
    return merged;
  }

  if (['error', 'ref', 'unknown'].includes(schema.type)) {
    return { type: 'object', properties: {} };
  }

  const cloned: any = { ...schema };

  if (!cloned.type) {
    if (cloned.properties) {
      cloned.type = 'object';
    } else if (cloned.items) {
      cloned.type = 'array';
    } else if (cloned.enum) {
      cloned.type = 'string';
    }
  }

  if (cloned.type === 'array' && cloned.items) {
    cloned.items = normalizeSchemaForExample(cloned.items);
  }

  if (cloned.type === 'object' || cloned.properties) {
    const properties = cloned.properties ?? {};
    cloned.properties = Object.fromEntries(
      Object.entries(properties).map(([key, value]) => [
        key,
        normalizeSchemaForExample(value),
      ]),
    );
  }

  if (
    cloned.example === undefined &&
    cloned.type &&
    !['array', 'object'].includes(cloned.type)
  ) {
    cloned.example = '';
  }

  return cloned;
}

onBeforeMount(() => {
  const [, entityName] = (route.name as string).split('*') ?? [];
  if (entityName) {
    entityInfo.value = {
      name: entityName,
      ...apiStore.openApi?.components.schemas[entityName],
    };
  }
  const data = processSchema(entityInfo.value);
  treeData.value = data;
});
</script>
<template>
  <div class="relative box-border h-full w-full overflow-y-auto p-5">
    <h3 class="text-xl">{{ entityInfo?.name }}</h3>
    <h4 class="mt-4 text-sm">{{ entityInfo?.description }}</h4>
    <ElRow class="mt-6" :gutter="16">
      <ElCol :span="16">
        <ElCard shadow="never">
          <template #header>
            <span class="text-sm font-medium">字段定义</span>
          </template>
          <table class="entity-table">
            <thead>
              <tr>
                <th width="20%">属性名</th>
                <th width="25%">类型</th>
                <th width="20%">示例</th>
                <th width="35%">描述</th>
              </tr>
            </thead>
            <tbody>
              <entityTr v-if="!fold" :tree-data="treeData" />
            </tbody>
          </table>
        </ElCard>
      </ElCol>
      <ElCol :span="8">
        <ElCard shadow="never">
          <template #header>
            <span class="text-sm font-medium">JSON 示例</span>
          </template>
          <div v-if="schemaWithExamples" class="max-h-[70vh] overflow-auto">
            <JsonViewer
              :schema="schemaWithExamples"
              :default-expanded="defaultExpanded"
            />
          </div>
          <div v-else class="py-8 text-center text-sm text-gray-400">
            暂无示例数据
          </div>
        </ElCard>
      </ElCol>
    </ElRow>
  </div>
</template>
<style lang="scss">
.entity-table {
  thead {
    @apply border-b text-start;

    th {
      @apply px-6 py-3 text-sm;
    }
  }
}
</style>
