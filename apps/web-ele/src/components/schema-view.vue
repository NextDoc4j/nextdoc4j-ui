<script setup lang="ts">
import { computed, ref } from 'vue';

import { SvgCaretRightIcon } from '@vben/icons';

import { ElButton, ElTooltip } from 'element-plus';

import { getEnumItems } from '#/utils/enumexpand';
import { getSchemaTypeLabel } from '#/utils/schema';

defineOptions({
  name: 'SchemaView',
});

const props = withDefaults(
  defineProps<{
    data: any;
    mode?: 'entity' | 'request' | 'response';
    pathPrefix?: string;
  }>(),
  {
    mode: 'entity',
    pathPrefix: '$',
  },
);

const emits = defineEmits<{
  variantChange: [payload: { index: number; path: string }];
}>();

type CompositionKeyword = 'allOf' | 'anyOf' | 'oneOf';

const foldState = ref<Record<string, boolean>>({});
const variantState = ref<Record<string, number>>({});

const mode = computed(() => props.mode);
const rootPath = computed(() => props.pathPrefix || '$');

const hasHtmlDescription = (desc?: string) => Boolean(desc?.includes('<'));

const formatValue = (value: unknown) => {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
};

const getCompositionKeyword = (item: any): '' | CompositionKeyword => {
  if (Array.isArray(item?.oneOf) && item.oneOf.length > 0) {
    return 'oneOf';
  }
  if (Array.isArray(item?.anyOf) && item.anyOf.length > 0) {
    return 'anyOf';
  }
  if (Array.isArray(item?.allOf) && item.allOf.length > 0) {
    return 'allOf';
  }
  return '';
};

const getCompositionItems = (item: any, keyword: '' | CompositionKeyword) => {
  if (!keyword || !Array.isArray(item?.[keyword])) {
    return [];
  }
  return item[keyword] as any[];
};

const getSelectedVariantIndex = (item: any, path: string) => {
  const keyword = getCompositionKeyword(item);
  if (!keyword || keyword === 'allOf') {
    return 0;
  }
  const options = getCompositionItems(item, keyword);
  if (options.length <= 1) {
    return 0;
  }
  const current = variantState.value[path];
  if (typeof current !== 'number' || current < 0 || current >= options.length) {
    return 0;
  }
  return current;
};

const updateVariant = (path: string, value: number | string) => {
  const parsed = Number(value);
  const nextIndex = Number.isFinite(parsed) ? parsed : 0;
  variantState.value[path] = nextIndex;
  emits('variantChange', {
    index: nextIndex,
    path,
  });
};

const handleChildVariantChange = (payload: { index: number; path: string }) => {
  emits('variantChange', payload);
};

const mergeSchema = (baseSchema: any, pickedSchema: any) => {
  if (!pickedSchema || typeof pickedSchema !== 'object') {
    return baseSchema;
  }

  const merged: any = {
    ...baseSchema,
    ...pickedSchema,
  };

  const required = [
    ...(Array.isArray(baseSchema?.required) ? baseSchema.required : []),
    ...(Array.isArray(pickedSchema?.required) ? pickedSchema.required : []),
  ];
  if (required.length > 0) {
    merged.required = [...new Set(required)];
  }

  if (baseSchema?.properties || pickedSchema?.properties) {
    merged.properties = {
      ...baseSchema?.properties,
      ...pickedSchema?.properties,
    };
  }

  if (!merged.type) {
    if (merged.properties) {
      merged.type = 'object';
    } else if (merged.items) {
      merged.type = 'array';
    }
  }

  if (baseSchema?.description) {
    merged.description = baseSchema.description;
  }

  if (pickedSchema?.title && !baseSchema?.title) {
    merged.title = pickedSchema.title;
  }

  return merged;
};

const resolveAllOfSchema = (item: any) => {
  const merged = item?.['x-nextdoc4j-allOfMerged'];
  if (merged && typeof merged === 'object') {
    return merged;
  }

  const options = Array.isArray(item?.allOf) ? item.allOf : [];
  const fallback = {
    properties: {},
    required: [],
    type: 'object',
  } as any;

  options.forEach((entry: any) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }
    if (entry.properties && typeof entry.properties === 'object') {
      Object.assign(fallback.properties, entry.properties);
    }
    if (Array.isArray(entry.required)) {
      fallback.required.push(...entry.required);
    }
  });

  if (Object.keys(fallback.properties).length <= 0) {
    delete fallback.properties;
  }
  if (fallback.required.length <= 0) {
    delete fallback.required;
  } else {
    fallback.required = [...new Set(fallback.required)];
  }

  return fallback;
};

const getDisplaySchema = (item: any, path: string): any => {
  if (!item || typeof item !== 'object') {
    return item;
  }

  const keyword = getCompositionKeyword(item);
  if (!keyword) {
    return item;
  }

  const baseSchema = {
    ...item,
  };
  delete baseSchema.oneOf;
  delete baseSchema.anyOf;
  delete baseSchema.allOf;
  delete baseSchema['x-nextdoc4j-allOfMerged'];

  if (keyword === 'allOf') {
    return mergeSchema(baseSchema, resolveAllOfSchema(item));
  }

  const options = getCompositionItems(item, keyword);
  if (options.length <= 0) {
    return baseSchema;
  }

  const selected = options[getSelectedVariantIndex(item, path)] ?? options[0];
  return mergeSchema(baseSchema, selected);
};

const isExpandable = (item: any, path: string) => {
  const schema = getDisplaySchema(item, path);
  if (schema?.type === 'object' && schema?.properties) {
    return Object.keys(schema.properties).length > 0;
  }
  if (schema?.type === 'array' && schema?.items?.type === 'object') {
    return true;
  }
  return false;
};

const getChildSchema = (item: any, path: string) => {
  const schema = getDisplaySchema(item, path);
  if (!schema?.type || schema.type === 'object') {
    return schema?.properties || {};
  }
  if (schema.type === 'array' && schema?.items?.type === 'object') {
    return schema.items.properties || {};
  }
  return {};
};

const getNodePath = (key: string) => `${rootPath.value}.${key}`;

const toggleFold = (path: string, value: any) => {
  if (isExpandable(value, path)) {
    foldState.value[path] = !foldState.value[path];
  }
};

const getConstraints = (value: any, path: string) => {
  const source = getDisplaySchema(value, path);
  const parts: string[] = [];

  if (source?.minLength !== undefined) {
    parts.push(
      `>=${source.minLength}${source.type === 'string' ? ' 字符' : ''}`,
    );
  }
  if (source?.maxLength !== undefined) {
    parts.push(
      `<=${source.maxLength}${source.type === 'string' ? ' 字符' : ''}`,
    );
  }
  if (source?.minimum !== undefined) {
    parts.push(`>=${source.minimum}`);
  }
  if (source?.maximum !== undefined) {
    parts.push(`<=${source.maximum}`);
  }

  return parts.join(' 或 ');
};

const getPropertyEnumItems = (value: any, path: string) => {
  return getEnumItems(getDisplaySchema(value, path));
};

const getEnumValueList = (value: any, path: string) => {
  return getPropertyEnumItems(value, path)
    .map((item) => String(item.value))
    .join(', ');
};

const getTypeLabel = (value: any, path: string) => {
  const schema = getDisplaySchema(value, path);
  return getSchemaTypeLabel(schema);
};

const getExampleValue = (value: any, path: string) => {
  return getDisplaySchema(value, path)?.example;
};

const getPatternValue = (value: any, path: string) => {
  return getDisplaySchema(value, path)?.pattern || '';
};

const isRequired = (parentSchema: any, key: string, value: any) => {
  return Boolean(
    parentSchema?.required?.includes?.(key) || value?.required === true,
  );
};

const isNullable = (value: any, path: string) => {
  return getDisplaySchema(value, path)?.nullable === true;
};

const isDeprecated = (value: any, path: string) => {
  return getDisplaySchema(value, path)?.deprecated === true;
};

const isReadOnly = (value: any, path: string) => {
  const schema = getDisplaySchema(value, path);
  const accessMode = `${schema?.accessMode || ''}`.toUpperCase();
  return schema?.readOnly === true || accessMode === 'READ_ONLY';
};

const isWriteOnly = (value: any, path: string) => {
  const schema = getDisplaySchema(value, path);
  const accessMode = `${schema?.accessMode || ''}`.toUpperCase();
  return schema?.writeOnly === true || accessMode === 'WRITE_ONLY';
};

const getDescription = (value: any, path: string) => {
  return value?.description || getDisplaySchema(value, path)?.description || '';
};

const hasVariantSelector = (item: any) => {
  const keyword = getCompositionKeyword(item);
  if (keyword !== 'oneOf' && keyword !== 'anyOf') {
    return false;
  }
  return getCompositionItems(item, keyword).length > 1;
};

const getVariantOptions = (item: any) => {
  const keyword = getCompositionKeyword(item);
  if (!keyword || keyword === 'allOf') {
    return [];
  }
  return getCompositionItems(item, keyword);
};

const getVariantOptionLabel = (option: any, index: number) => {
  const title = option?.title || '';
  const type = option?.type ? ` · ${option.type}` : '';
  if (title) {
    return `${index + 1}. ${title}${type}`;
  }
  return `方案 ${index + 1}${type}`;
};

const resolvedRootSchema = computed(() => {
  return getDisplaySchema(props.data, rootPath.value);
});

const rootChildren = computed(() => {
  return getChildSchema(resolvedRootSchema.value, rootPath.value);
});

const showRootArrayPill = computed(() => {
  return (
    resolvedRootSchema.value?.type === 'array' &&
    resolvedRootSchema.value?.items?.type !== 'object'
  );
});

const showRootPrimitivePill = computed(() => {
  if (showRootArrayPill.value) {
    return false;
  }
  return Object.keys(rootChildren.value).length <= 0;
});

const rootHasVariantSelector = computed(() => {
  return hasVariantSelector(props.data);
});

const showRootHeader = computed(() => {
  return (
    showRootArrayPill.value ||
    showRootPrimitivePill.value ||
    rootHasVariantSelector.value
  );
});

const showSchemaStack = computed(() => {
  return !showRootArrayPill.value && !showRootPrimitivePill.value;
});
</script>

<template>
  <div v-if="showRootHeader" class="schema-root-pill">
    <span class="schema-root-pill__title">
      {{ showRootArrayPill || showRootPrimitivePill ? '结构' : '根' }}
    </span>
    <span class="schema-root-pill__value">{{
      getTypeLabel(resolvedRootSchema, rootPath)
    }}</span>
    <div v-if="rootHasVariantSelector" class="composition-switch__buttons">
      <ElTooltip
        v-for="(option, index) in getVariantOptions(data)"
        :key="`${rootPath}-${index}`"
        :content="getVariantOptionLabel(option, index)"
        placement="top"
      >
        <ElButton
          size="small"
          class="variant-switch-button"
          :class="{
            'variant-switch-button--active':
              getSelectedVariantIndex(data, rootPath) === index,
          }"
          @click="updateVariant(rootPath, index)"
        >
          {{ index + 1 }}
        </ElButton>
      </ElTooltip>
    </div>
  </div>

  <div v-if="showSchemaStack" class="schema-stack">
    <div v-for="(value, key) in rootChildren" :key="key" class="schema-item">
      <div class="schema-item__top">
        <button
          v-if="isExpandable(value, getNodePath(String(key)))"
          class="schema-item__toggle"
          @click="toggleFold(getNodePath(String(key)), value)"
        >
          <SvgCaretRightIcon
            class="size-4 transition-transform"
            :class="{ 'rotate-90': !foldState[getNodePath(String(key))] }"
          />
        </button>

        <div class="schema-item__content">
          <div class="schema-item__headline">
            <div class="schema-item__name">
              {{ key }}
            </div>
            <div class="schema-item__meta">
              <span
                class="meta-pill"
                :class="
                  isRequired(resolvedRootSchema, String(key), value)
                    ? 'meta-pill--required'
                    : 'meta-pill--optional'
                "
              >
                {{
                  isRequired(resolvedRootSchema, String(key), value)
                    ? '必填'
                    : '可选'
                }}
              </span>
              <span class="meta-pill meta-pill--type">
                {{ getTypeLabel(value, getNodePath(String(key))) }}
              </span>
              <span
                v-if="isNullable(value, getNodePath(String(key)))"
                class="meta-pill meta-pill--nullable"
              >
                可空
              </span>
              <span
                v-if="isDeprecated(value, getNodePath(String(key)))"
                class="meta-pill meta-pill--deprecated"
              >
                已弃用
              </span>
              <span
                v-if="isReadOnly(value, getNodePath(String(key)))"
                class="meta-pill meta-pill--access"
              >
                只读
              </span>
              <span
                v-if="isWriteOnly(value, getNodePath(String(key)))"
                class="meta-pill meta-pill--access"
              >
                只写
              </span>
              <ElTooltip
                v-if="
                  getExampleValue(value, getNodePath(String(key))) !== undefined
                "
                :content="
                  formatValue(getExampleValue(value, getNodePath(String(key))))
                "
                placement="top"
              >
                <span class="meta-pill meta-pill--example">
                  示例
                  {{
                    formatValue(
                      getExampleValue(value, getNodePath(String(key))),
                    )
                  }}
                </span>
              </ElTooltip>
              <ElTooltip
                v-if="getPatternValue(value, getNodePath(String(key)))"
                :content="getPatternValue(value, getNodePath(String(key)))"
                placement="top"
              >
                <span class="meta-pill meta-pill--pattern">
                  正则 {{ getPatternValue(value, getNodePath(String(key))) }}
                </span>
              </ElTooltip>
              <span
                v-if="getConstraints(value, getNodePath(String(key)))"
                class="meta-pill meta-pill--constraint"
              >
                约束 {{ getConstraints(value, getNodePath(String(key))) }}
              </span>
            </div>
            <div
              v-if="hasVariantSelector(value)"
              class="schema-item__meta-variant"
            >
              <ElTooltip
                v-for="(option, index) in getVariantOptions(value)"
                :key="`${getNodePath(String(key))}-${index}`"
                :content="getVariantOptionLabel(option, index)"
                placement="top"
              >
                <ElButton
                  size="small"
                  class="variant-switch-button"
                  :class="{
                    'variant-switch-button--active':
                      getSelectedVariantIndex(
                        value,
                        getNodePath(String(key)),
                      ) === index,
                  }"
                  @click="updateVariant(getNodePath(String(key)), index)"
                >
                  {{ index + 1 }}
                </ElButton>
              </ElTooltip>
            </div>
          </div>

          <div
            v-if="
              getDescription(value, getNodePath(String(key))) &&
              !hasHtmlDescription(
                getDescription(value, getNodePath(String(key))),
              )
            "
            class="schema-item__description"
          >
            {{ getDescription(value, getNodePath(String(key))) }}
          </div>
          <div
            v-if="
              getDescription(value, getNodePath(String(key))) &&
              hasHtmlDescription(
                getDescription(value, getNodePath(String(key))),
              )
            "
            class="schema-item__description prose prose-sm max-w-none"
            v-html="getDescription(value, getNodePath(String(key)))"
          ></div>

          <div
            v-if="
              getPropertyEnumItems(value, getNodePath(String(key))).length > 0
            "
            class="schema-item__enum"
          >
            <span class="schema-item__enum-label">枚举</span>
            <div class="schema-item__enum-values">
              <span
                v-for="item in getPropertyEnumItems(
                  value,
                  getNodePath(String(key)),
                )"
                :key="item.value"
                class="enum-pill"
              >
                <span class="enum-pill__value">{{ item.value }}</span>
                <span v-if="item.description" class="enum-pill__description">
                  {{ item.description }}
                </span>
              </span>
            </div>
            <span
              v-if="getEnumValueList(value, getNodePath(String(key)))"
              class="schema-item__enum-available"
            >
              可用值: {{ getEnumValueList(value, getNodePath(String(key))) }}
            </span>
          </div>

          <div
            v-if="
              isExpandable(value, getNodePath(String(key))) &&
              !foldState[getNodePath(String(key))]
            "
            class="schema-item__children"
          >
            <SchemaView
              :data="getDisplaySchema(value, getNodePath(String(key)))"
              :mode="mode"
              :path-prefix="getNodePath(String(key))"
              @variant-change="handleChildVariantChange"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
<style scoped>
.schema-root-pill,
.schema-stack {
  --doc-chip-radius: calc(var(--radius) * 0.62);
  --doc-radius-sm: calc(var(--radius) * 0.72);
}

.schema-root-pill {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  width: 100%;
  min-width: 0;
  min-height: 34px;
  padding: 0 11px;
  margin-bottom: 8px;
  color: #175cd3;
  background: #e8f1ff;
  border: 1px solid #b7cdfb;
  border-radius: var(--doc-radius-sm);
}

.schema-root-pill__title {
  font-size: 12px;
  font-weight: 700;
  color: var(--el-text-color-secondary);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.schema-root-pill__value {
  font-family: 'JetBrains Mono', 'Fira Code', SFMono-Regular, monospace;
  font-size: 13px;
  font-weight: 700;
  color: #1e40af;
}

.schema-stack {
  display: grid;
}

.composition-switch__buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  justify-content: flex-end;
  margin-left: auto;
}

.schema-item {
  padding: 10px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.schema-item:last-child {
  padding-bottom: 0;
  border-bottom: none;
}

.schema-item__top {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.schema-item__toggle {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin-top: 2px;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  background: var(--el-fill-color-light);
  border: none;
  border-radius: var(--doc-chip-radius);
}

.schema-item__content {
  flex: 1;
  min-width: 0;
}

.schema-item__name {
  font-family:
    'HarmonyOS Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 14px;
  font-weight: 900;
  color: var(--el-text-color-primary);
}

.schema-item__headline {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 6px 8px;
  align-items: center;
  min-width: 0;
}

.schema-item__meta,
.schema-item__enum-values {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

.schema-item__meta {
  min-width: 0;
}

.schema-item__meta-variant {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  justify-self: end;
  justify-content: flex-end;
}

.schema-item__enum {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  min-width: 0;
  margin-top: 6px;
}

.schema-item__enum-label {
  flex: none;
  font-size: 11px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
}

.schema-item__enum-available {
  flex: 1 1 100%;
  min-width: 0;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  word-break: normal;
  overflow-wrap: anywhere;
  white-space: normal;
}

.schema-item__description {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.variant-switch-button {
  min-width: 26px;
  height: 22px;
  padding: 0 7px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--doc-chip-radius);
}

.variant-switch-button--active {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary-light-7);
}

.schema-item__children {
  padding-left: 14px;
  margin-top: 10px;
  margin-left: 8px;
  border-left: 1px solid var(--el-border-color-lighter);
}

.meta-pill {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  min-height: 22px;
  padding: 0 7px;
  font-size: 10.5px;
  line-height: 1.2;
  color: #334155;
  background: #f8fafc;
  border: 1px solid #cfd8e3;
  border-radius: var(--doc-chip-radius);
}

.meta-pill--type {
  color: #1f4ba8;
  background: #ecf2ff;
  border-color: #b8c9eb;
}

.meta-pill--required {
  color: #b42318;
  background: #feeceb;
  border-color: #f6b4ad;
}

.meta-pill--optional {
  color: #0f7a43;
  background: #e9f8ee;
  border-color: #9fd9b7;
}

.meta-pill--example {
  color: #8b5a1e;
  background: #fff5e6;
  border-color: #ebc48c;
}

.meta-pill--pattern {
  color: #5b3fa3;
  background: #f3efff;
  border-color: #cdc0ef;
}

.meta-pill--constraint {
  color: #11605b;
  background: #e9fbf8;
  border-color: #9fd7cf;
}

.meta-pill--composition {
  color: #14532d;
  background: #ecfdf3;
  border-color: #a7f3d0;
}

.meta-pill--nullable {
  color: #1d4ed8;
  background: #eff6ff;
  border-color: #bfdbfe;
}

.meta-pill--deprecated {
  color: #9a3412;
  background: #fff7ed;
  border-color: #fed7aa;
}

.meta-pill--access {
  color: #7c3aed;
  background: #f5f3ff;
  border-color: #ddd6fe;
}

.enum-pill {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  min-width: 0;
  max-width: 100%;
  min-height: 22px;
  padding: 2px 8px;
  color: #1f4ba8;
  background: #eff4ff;
  border: 1px solid #c7d5ef;
  border-radius: var(--doc-radius-sm);
}

.enum-pill__value {
  display: inline-flex;
  flex: 0 1 auto;
  align-items: center;
  justify-content: center;
  min-width: 14px;
  max-width: 100%;
  padding: 0 2px;
  font-family: 'JetBrains Mono', 'Fira Code', SFMono-Regular, monospace;
  font-size: 10.5px;
  font-weight: 700;
  line-height: 1.2;
  color: #1e3f8a;
  text-align: center;
  word-break: normal;
  overflow-wrap: anywhere;
  white-space: normal;
}

.enum-pill__description {
  display: inline-flex;
  flex: 1 1 auto;
  gap: 3px;
  align-items: center;
  min-width: 0;
  font-size: 10.5px;
  line-height: 1.2;
  color: var(--el-text-color-secondary);
  text-align: left;
  word-break: normal;
  overflow-wrap: anywhere;
  white-space: normal;
}

.enum-pill__description::before {
  flex: none;
  font-weight: 600;
  color: color-mix(in srgb, var(--el-text-color-secondary) 82%, transparent);
  content: '-';
}

:deep(.document-page--dark .schema-root-pill),
:deep(html.dark .schema-root-pill) {
  color: #a9c0eb;
  background: #1e2838;
  border-color: #3b4d67;
}

:deep(.document-page--dark .schema-root-pill__value),
:deep(html.dark .schema-root-pill__value) {
  color: #d4e1f5;
}

:deep(.document-page--dark .meta-pill),
:deep(html.dark .meta-pill) {
  color: #bfcad9;
  background: #232a36;
  border-color: #3f4d61;
}

:deep(.document-page--dark .meta-pill--type),
:deep(html.dark .meta-pill--type) {
  color: #a9c0eb;
  background: #1e2838;
  border-color: #3b4d67;
}

:deep(.document-page--dark .meta-pill--required),
:deep(html.dark .meta-pill--required) {
  color: #f0b2ad;
  background: #372228;
  border-color: #5c3840;
}

:deep(.document-page--dark .meta-pill--optional),
:deep(html.dark .meta-pill--optional) {
  color: #aad8be;
  background: #1d3127;
  border-color: #385a49;
}

:deep(.document-page--dark .meta-pill--example),
:deep(html.dark .meta-pill--example) {
  color: #e3c199;
  background: #372d22;
  border-color: #5a4a35;
}

:deep(.document-page--dark .meta-pill--pattern),
:deep(html.dark .meta-pill--pattern) {
  color: #c8b8e6;
  background: #2d2539;
  border-color: #4c4061;
}

:deep(.document-page--dark .meta-pill--constraint),
:deep(html.dark .meta-pill--constraint) {
  color: #9fcec9;
  background: #1d3131;
  border-color: #385956;
}

:deep(.document-page--dark .enum-pill),
:deep(html.dark .enum-pill) {
  color: #a9c0eb;
  background: #1e2d42;
  border-color: #3a4f6e;
}

:deep(.document-page--dark .enum-pill__value),
:deep(html.dark .enum-pill__value) {
  color: #d4e1f5;
}
</style>
