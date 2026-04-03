<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import { ElButton } from 'element-plus';

import JsonViewer from '#/components/json-viewer/index.vue';
import SchemaView from '#/components/schema-view.vue';
import { useApiStore } from '#/store';
import { adaptSchemaForView, hasRenderableSchema } from '#/utils/schema';

const route = useRoute();
const apiStore = useApiStore();
const exampleOpen = ref(false);
const entityVariantState = ref<Record<string, number>>({});

const entityName = computed(() => {
  const routeName = route.name;
  if (typeof routeName !== 'string') {
    return '';
  }
  const [, name] = routeName.split('*') ?? [];
  return name || '';
});

const entityInfo = computed(() => {
  const name = entityName.value;
  if (!name) {
    return null;
  }

  const schema = apiStore.openApi?.components?.schemas?.[name];
  if (!schema) {
    return null;
  }

  return {
    name,
    ...schema,
  };
});

const hasHtmlDescription = computed(() => {
  return entityInfo.value?.description?.includes?.('<') ?? false;
});

const plainDescription = computed(() => {
  if (!entityInfo.value?.description || hasHtmlDescription.value) {
    return null;
  }
  return entityInfo.value.description;
});

const htmlDescription = computed(() => {
  if (!entityInfo.value?.description || !hasHtmlDescription.value) {
    return null;
  }
  return entityInfo.value.description;
});

const entitySchema = computed(() => {
  if (!entityInfo.value) {
    return null;
  }
  return adaptSchemaForView(entityInfo.value, { mode: 'entity' });
});


const mergeComposedSchema = (baseSchema: any, pickedSchema: any) => {
  if (!pickedSchema || typeof pickedSchema !== 'object') {
    return baseSchema;
  }

  const merged: any = {
    ...baseSchema,
    ...pickedSchema,
  };

  if (baseSchema?.properties || pickedSchema?.properties) {
    merged.properties = {
      ...(baseSchema?.properties || {}),
      ...(pickedSchema?.properties || {}),
    };
  }

  const required = [
    ...(Array.isArray(baseSchema?.required) ? baseSchema.required : []),
    ...(Array.isArray(pickedSchema?.required) ? pickedSchema.required : []),
  ];
  if (required.length > 0) {
    merged.required = [...new Set(required)];
  }

  if (!merged.type && merged.properties) {
    merged.type = 'object';
  }

  return merged;
};

const applyEntityVariantState = (
  schema: any,
  state: Record<string, number>,
) => {
  const pickVariantIndex = (path: string, options: any[]) => {
    const selected = state[path];
    if (!Array.isArray(options) || options.length <= 0) {
      return 0;
    }
    if (
      typeof selected !== 'number' ||
      !Number.isInteger(selected) ||
      selected < 0 ||
      selected >= options.length
    ) {
      return 0;
    }
    return selected;
  };

  const visit = (node: any, path: string): any => {
    if (node === null || node === undefined) {
      return null;
    }
    if (typeof node !== 'object') {
      return node;
    }
    if (Array.isArray(node)) {
      return node.map((item, index) => visit(item, `${path}.${index}`));
    }

    let current: any = { ...node };

    if (Array.isArray(current.oneOf) && current.oneOf.length > 0) {
      const index = pickVariantIndex(path, current.oneOf);
      const base = { ...current };
      delete base.oneOf;
      delete base.anyOf;
      delete base.allOf;
      delete base['x-nextdoc4j-allOfMerged'];
      const picked = current.oneOf[index] ?? current.oneOf[0];
      current = mergeComposedSchema(base, picked);
    } else if (Array.isArray(current.anyOf) && current.anyOf.length > 0) {
      const index = pickVariantIndex(path, current.anyOf);
      const base = { ...current };
      delete base.oneOf;
      delete base.anyOf;
      delete base.allOf;
      delete base['x-nextdoc4j-allOfMerged'];
      const picked = current.anyOf[index] ?? current.anyOf[0];
      current = mergeComposedSchema(base, picked);
    } else if (Array.isArray(current.allOf) && current.allOf.length > 0) {
      const mergedAllOf = current.allOf.reduce((acc: any, item: any) => {
        return mergeComposedSchema(acc, visit(item, path));
      }, {});
      const base = { ...current };
      delete base.allOf;
      delete base['x-nextdoc4j-allOfMerged'];
      current = mergeComposedSchema(base, mergedAllOf);
    }

    if (current.properties && typeof current.properties === 'object') {
      const nextProperties: Record<string, any> = {};
      Object.entries(current.properties).forEach(([key, value]) => {
        nextProperties[key] = visit(value, `${path}.${key}`);
      });
      current.properties = nextProperties;
    }

    if (current.items) {
      current.items = visit(current.items, path);
    }

    if (Array.isArray(current.prefixItems)) {
      current.prefixItems = current.prefixItems.map((item: any, index: number) =>
        visit(item, `${path}.${index}`),
      );
    }

    return current;
  };

  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  return visit(schema, '$');
};

const propertyCount = computed(() => {
  return Object.keys(entitySchema.value?.properties || {}).length;
});

watch(entityName, () => {
  entityVariantState.value = {};
});

const handleEntitySchemaVariantChange = (payload: {
  index: number;
  path: string;
}) => {
  entityVariantState.value = {
    ...entityVariantState.value,
    [payload.path]: payload.index,
  };
};

const schemaWithExamples = computed(() => {
  if (!entitySchema.value || !hasRenderableSchema(entitySchema.value)) {
    return null;
  }
  return applyEntityVariantState(entitySchema.value, entityVariantState.value);
});
</script>

<template>
  <div class="entity-detail">
    <section class="entity-hero">
      <div class="entity-hero__title">{{ entityInfo?.name || '实体模型' }}</div>
      <div v-if="plainDescription" class="entity-hero__description">
        {{ plainDescription }}
      </div>
      <div
        v-else-if="htmlDescription"
        class="entity-hero__description prose prose-sm max-w-none"
        v-html="htmlDescription"
      ></div>
      <div v-else class="entity-hero__description">暂无描述</div>
    </section>

    <section class="entity-panel">
      <div class="entity-panel__header">
        <div class="entity-panel__title-wrap">
          <div class="entity-panel__title">字段定义</div>
          <span class="entity-panel__count">
            {{ propertyCount > 0 ? `${propertyCount} 字段` : '结构定义' }}
          </span>
        </div>
        <ElButton
          v-if="schemaWithExamples"
          size="small"
          class="example-toggle-button"
          :class="{ 'example-toggle-button--active': exampleOpen }"
          @click="exampleOpen = !exampleOpen"
        >
          {{ exampleOpen ? '收起示例' : 'JSON 示例' }}
        </ElButton>
      </div>

      <div
        v-if="hasRenderableSchema(entitySchema)"
        class="schema-layout"
        :class="{ 'schema-layout--open': exampleOpen && schemaWithExamples }"
      >
        <div class="schema-layout__main">
          <SchemaView :data="entitySchema" mode="entity" @variant-change="handleEntitySchemaVariantChange" />
        </div>

        <div
          v-if="exampleOpen && schemaWithExamples"
          class="schema-layout__aside"
        >
          <JsonViewer
            class="json-panel app-json-schema-viewer"
            :schema="schemaWithExamples" mode="entity"
          />
        </div>
      </div>

      <div v-else class="empty-hint">暂无可展示的实体结构</div>
    </section>
  </div>
</template>

<style scoped lang="scss">
.entity-detail {
  --doc-chip-radius: calc(var(--radius) * 0.62);
  --doc-radius-xs: calc(var(--radius) * 0.56);
  --doc-radius-sm: calc(var(--radius) * 0.72);
  --doc-radius-md: calc(var(--radius) * 0.94);
  --doc-panel-bg: var(--el-bg-color);
  --doc-soft-bg: color-mix(
    in srgb,
    var(--el-bg-color) 86%,
    var(--el-fill-color-light) 14%
  );
  --doc-soft-bg-alt: color-mix(
    in srgb,
    var(--el-bg-color) 82%,
    var(--el-fill-color-light) 18%
  );
  --doc-panel-border: color-mix(
    in srgb,
    var(--el-text-color-primary) 12%,
    transparent
  );
  --doc-page-bg: var(--el-bg-color);
  --el-border-radius-base: calc(var(--radius) * 0.75);
  --el-border-radius-small: calc(var(--radius) * 0.62);

  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  padding: 20px;
  overflow-y: auto;
  background: var(--doc-page-bg);

  &::-webkit-scrollbar {
    width: 6px;
  }
}

.entity-hero,
.entity-panel {
  padding: 14px 16px;
  background: var(--doc-panel-bg);
  border: 1px solid var(--doc-panel-border);
  border-radius: var(--doc-radius-md);
}

.entity-hero {
  background: var(--doc-soft-bg);
}

.entity-hero__title {
  font-family:
    'HarmonyOS Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 22px;
  font-weight: 800;
  color: var(--el-text-color-primary);
}

.entity-hero__description {
  margin-top: 8px;
  font-size: 13px;
  line-height: 1.75;
  color: var(--el-text-color-secondary);
}

.entity-panel__header {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.entity-panel__title-wrap {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.entity-panel__title {
  font-size: 14px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.entity-panel__count {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 10px;
  font-size: 11px;
  font-weight: 700;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--doc-chip-radius);
}

.example-toggle-button {
  min-width: 88px;
  height: 30px;
  padding: 0 12px;
  color: var(--el-color-primary);
  background: color-mix(
    in srgb,
    var(--doc-panel-bg) 88%,
    var(--el-color-primary-light-9) 12%
  );
  border: 1px solid color-mix(in srgb, var(--el-color-primary) 28%, transparent);
  border-radius: var(--doc-chip-radius);
  box-shadow: inset 0 0 0 1px
    color-mix(in srgb, var(--el-color-primary) 8%, transparent);
}

.example-toggle-button:hover {
  color: var(--el-color-primary);
  background: color-mix(
    in srgb,
    var(--doc-panel-bg) 74%,
    var(--el-color-primary-light-9) 26%
  );
  border-color: color-mix(in srgb, var(--el-color-primary) 42%, transparent);
}

.example-toggle-button--active {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary-light-7);
}

.schema-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
}

.schema-layout--open {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}

.schema-layout__main {
  min-width: 0;
}

.schema-layout__aside {
  min-width: 0;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 0;
}

.json-panel {
  background: var(--doc-soft-bg-alt);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--doc-radius-xs);
}

.json-panel :deep(.theme-light),
.json-panel :deep(.theme-dark) {
  padding: 10px;
  background: transparent;
  border: none;
}

.json-panel :deep(.json-node) {
  margin: 0;
}

.json-panel :deep(.node-header),
.json-panel :deep(.node-primitive) {
  min-height: 20px;
  font-size: 12px;
}

.empty-hint {
  display: inline-flex;
  align-items: center;
  min-height: 40px;
  padding: 0 12px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--doc-radius-xs);
}

@media (max-width: 992px) {
  .schema-layout--open {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 767px) {
  .entity-detail {
    padding: 12px;
  }

  .entity-hero,
  .entity-panel {
    padding: 12px;
  }

  .entity-hero__title {
    font-size: 20px;
  }
}
</style>

