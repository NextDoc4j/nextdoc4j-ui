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
const exampleOpen = ref(true);
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
      ...baseSchema?.properties,
      ...pickedSchema?.properties,
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
      let mergedAllOf: any = {};
      for (const item of current.allOf) {
        mergedAllOf = mergeComposedSchema(mergedAllOf, visit(item, path));
      }
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
      current.prefixItems = current.prefixItems.map(
        (item: any, index: number) => visit(item, `${path}.${index}`),
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
    <div
      class="entity-detail__layout"
      :class="{ 'entity-detail__layout--single': !schemaWithExamples }"
    >
      <main class="entity-detail__main">
        <section class="entity-hero">
          <div class="entity-hero__title">
            {{ entityInfo?.name || '实体模型' }}
          </div>
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
          </div>

          <div v-if="hasRenderableSchema(entitySchema)" class="schema-layout">
            <SchemaView
              :data="entitySchema"
              mode="entity"
              @variant-change="handleEntitySchemaVariantChange"
            />
          </div>

          <div v-else class="empty-hint">暂无可展示的实体结构</div>
        </section>
      </main>

      <aside v-if="schemaWithExamples" class="entity-detail__aside">
        <div class="entity-detail__aside-stack">
          <section
            class="example-card"
            :class="{ 'example-card--collapsed': !exampleOpen }"
          >
            <div class="example-card__header">
              <div class="example-card__meta">
                <div class="example-card__title">Entity JSON Example</div>
                <span class="example-card__content-type">
                  application/json
                </span>
              </div>
              <ElButton
                size="small"
                class="example-card__toggle"
                :class="{ 'example-card__toggle--active': exampleOpen }"
                @click="exampleOpen = !exampleOpen"
              >
                {{ exampleOpen ? '收起' : '展开' }}
              </ElButton>
            </div>

            <Transition name="example-expand">
              <div v-if="exampleOpen" class="example-card__body">
                <JsonViewer
                  class="json-panel app-json-schema-viewer"
                  :schema="schemaWithExamples"
                  mode="entity"
                />
              </div>
            </Transition>
          </section>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped lang="scss">
@supports not (scrollbar-gutter: stable) {
  .entity-detail {
    overflow-y: scroll;
  }
}

.entity-detail {
  --doc-chip-radius: var(--radius);
  --doc-radius-xs: calc(var(--radius) * 0.56);
  --doc-radius-sm: calc(var(--radius) * 0.72);
  --doc-radius-md: calc(var(--radius) * 0.94);
  --doc-radius-lg: calc(var(--radius) * 1.18);
  --doc-page-bg: #f8fafc;
  --doc-panel-bg: #fff;
  --doc-panel-border: #e2e8f0;
  --doc-row-border: #f1f5f9;
  --doc-muted-bg: #f1f5f9;
  --doc-text-muted: #64748b;
  --doc-example-bg: #fff;
  --doc-example-header-bg: #f8fafc;
  --doc-example-border: #e2e8f0;
  --doc-example-title: #475569;
  --doc-example-chip-bg: #f1f5f9;
  --el-border-radius-base: calc(var(--radius) * 0.75);
  --el-border-radius-small: calc(var(--radius) * 0.62);

  height: 100%;
  overflow-y: auto;
  scrollbar-gutter: stable;
  background: var(--doc-page-bg);

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-thumb {
    background: color-mix(
      in srgb,
      var(--el-text-color-primary) 14%,
      transparent
    );
    border-radius: var(--doc-chip-radius);
  }
}

.dark .entity-detail {
  --doc-page-bg: var(--el-bg-color);
  --doc-panel-bg: color-mix(in srgb, var(--el-bg-color) 92%, #fff 8%);
  --doc-panel-border: color-mix(
    in srgb,
    var(--el-text-color-primary) 22%,
    transparent
  );
  --doc-row-border: color-mix(
    in srgb,
    var(--el-text-color-primary) 14%,
    transparent
  );
  --doc-muted-bg: color-mix(
    in srgb,
    var(--el-bg-color) 86%,
    var(--el-fill-color-light) 14%
  );
  --doc-text-muted: var(--el-text-color-secondary);
  --doc-example-bg: #0d1117;
  --doc-example-header-bg: #161b22;
  --doc-example-border: #30363d;
  --doc-example-title: #94a3b8;
  --doc-example-chip-bg: #1f2937;
}

.entity-detail__layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 420px);
  gap: 40px;
  max-width: 1280px;
  min-height: 100%;
  padding: 40px 24px 48px;
  margin: 0 auto;
}

.entity-detail__layout--single {
  grid-template-columns: minmax(0, 1fr);
}

.entity-detail__main,
.entity-detail__aside-stack {
  display: flex;
  flex-direction: column;
  gap: 32px;
  min-width: 0;
}

.entity-detail__aside {
  min-width: 0;
}

.entity-detail__aside-stack {
  position: sticky;
  top: 40px;
  align-self: start;
  overflow: visible;
}

.entity-hero,
.entity-panel {
  padding: 18px 20px;
  background: var(--doc-panel-bg);
  border: 1px solid var(--doc-panel-border);
  border-radius: var(--doc-radius-lg);
  box-shadow: 0 8px 18px rgb(15 23 42 / 4%);
}

.entity-hero {
  display: grid;
  gap: 8px;
  background: transparent;
  border: none;
  box-shadow: none;
}

.entity-hero__title {
  margin: 0;
  font-size: 30px;
  font-weight: 800;
  line-height: 1.2;
  color: var(--el-text-color-primary);
  letter-spacing: 0;
}

.entity-hero__description {
  max-width: 760px;
  font-size: 15px;
  line-height: 1.7;
  color: var(--doc-text-muted);
}

.entity-panel__header {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.entity-panel__title-wrap {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.entity-panel__title {
  font-size: 20px;
  font-weight: 700;
  line-height: 1.3;
  color: var(--el-text-color-primary);
}

.entity-panel__count {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 10px;
  font-size: 11px;
  font-weight: 800;
  color: var(--doc-text-muted);
  text-transform: uppercase;
  background: var(--doc-muted-bg);
  border: 1px solid var(--doc-panel-border);
  border-radius: var(--doc-chip-radius);
}

.schema-layout {
  min-width: 0;
  padding: 6px 16px 8px;
  background: var(--doc-panel-bg);
}

.example-card {
  min-width: 0;
  overflow: hidden;
  background: var(--doc-example-bg);
  border: 1px solid var(--doc-example-border);
  border-radius: var(--doc-radius-lg);
  box-shadow: 0 12px 26px rgb(15 23 42 / 7%);
}

.example-card__header {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  min-height: 44px;
  padding: 10px 12px;
  background: var(--doc-example-header-bg);
  border-bottom: 1px solid var(--doc-example-border);
}

.example-card--collapsed .example-card__header {
  border-bottom: none;
}

.example-card__meta {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  gap: 8px 10px;
  align-items: center;
  min-width: 0;
}

.example-card__title {
  font-family: 'JetBrains Mono', 'Fira Code', SFMono-Regular, monospace;
  font-size: 12px;
  font-weight: 700;
  color: var(--doc-example-title);
}

.example-card__content-type {
  max-width: 160px;
  padding: 2px 7px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: 'JetBrains Mono', 'Fira Code', SFMono-Regular, monospace;
  font-size: 12px;
  font-weight: 600;
  color: var(--doc-example-title);
  white-space: nowrap;
  background: var(--doc-example-chip-bg);
  border: 1px solid var(--doc-example-border);
  border-radius: var(--doc-chip-radius);
}

.example-card__toggle {
  --el-button-bg-color: transparent;
  --el-button-border-color: var(--doc-example-border);
  --el-button-hover-bg-color: var(--doc-example-chip-bg);
  --el-button-hover-border-color: var(--doc-example-border);
  --el-button-active-bg-color: var(--doc-example-chip-bg);

  flex: none;
  min-width: 48px;
  height: 26px;
  padding: 0 8px;
  font-size: 12px;
  color: var(--doc-example-title);
  border-radius: var(--doc-chip-radius);
}

.example-card__toggle--active {
  color: #93c5fd;
  border-color: rgb(59 130 246 / 42%);
}

.example-card__body {
  display: grid;
  gap: 10px;
  min-width: 0;
  padding: 12px;
  background: var(--doc-example-bg);
}

.example-expand-enter-active,
.example-expand-leave-active {
  overflow: hidden;
  transition:
    max-height 0.2s ease,
    opacity 0.16s ease;
}

.example-expand-enter-from,
.example-expand-leave-to {
  max-height: 0;
  opacity: 0;
}

.example-expand-enter-to,
.example-expand-leave-from {
  max-height: 1200px;
  opacity: 1;
}

.json-panel {
  width: 100%;
  min-width: 0;
  min-height: 120px;
  max-height: none;
  overflow: auto;
  overscroll-behavior: contain;
  background: var(--doc-example-bg);
  border: none;
  border-radius: 0;
}

.json-panel.app-json-schema-viewer {
  border: none;
  border-radius: 0;
}

.empty-hint {
  display: inline-flex;
  align-items: center;
  min-height: 40px;
  padding: 0 12px;
  font-size: 13px;
  color: var(--doc-text-muted);
  background: var(--doc-muted-bg);
  border: 1px solid var(--doc-panel-border);
  border-radius: var(--doc-radius-xs);
}

@media (max-width: 1180px) {
  .entity-detail__layout {
    grid-template-columns: minmax(0, 1fr);
    gap: 24px;
    padding: 18px 20px 32px;
  }

  .entity-detail__aside-stack {
    position: static;
    max-height: none;
    padding-right: 0;
    overflow: visible;
  }
}

@media (max-width: 767px) {
  .entity-detail__layout {
    gap: 18px;
    padding: 24px 14px 32px;
  }

  .entity-hero,
  .entity-panel {
    padding: 12px;
  }

  .entity-hero__title {
    font-size: 20px;
  }

  .example-card__header {
    flex-direction: column;
    gap: 8px;
    align-items: stretch;
  }
}
</style>
