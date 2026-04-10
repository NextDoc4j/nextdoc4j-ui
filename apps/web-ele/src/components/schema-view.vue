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

const getConstraintTokens = (value: any, path: string) => {
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

  return parts;
};

const getPropertyEnumItems = (value: any, path: string) => {
  return getEnumItems(getDisplaySchema(value, path));
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

const getFlagTokens = (value: any, path: string) => {
  const tokens: string[] = [];

  if (isNullable(value, path)) {
    tokens.push('可空');
  }
  if (isDeprecated(value, path)) {
    tokens.push('已弃用');
  }
  if (isReadOnly(value, path)) {
    tokens.push('只读');
  }
  if (isWriteOnly(value, path)) {
    tokens.push('只写');
  }

  return tokens;
};

const getDescription = (value: any, path: string) => {
  return value?.description || getDisplaySchema(value, path)?.description || '';
};

const getPlainDescription = (value: any, path: string) => {
  const description = getDescription(value, path);
  return description && !hasHtmlDescription(description) ? description : '';
};

const getHtmlDescription = (value: any, path: string) => {
  const description = getDescription(value, path);
  return description && hasHtmlDescription(description) ? description : '';
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
    <span class="schema-root-pill__value">
      {{ getTypeLabel(resolvedRootSchema, rootPath) }}
    </span>
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
        <div class="schema-item__control">
          <button
            v-if="isExpandable(value, getNodePath(String(key)))"
            type="button"
            class="schema-item__toggle"
            :class="{
              'schema-item__toggle--expanded':
                !foldState[getNodePath(String(key))],
            }"
            @click="toggleFold(getNodePath(String(key)), value)"
          >
            <SvgCaretRightIcon
              class="size-4 transition-transform"
              :class="{ 'rotate-90': !foldState[getNodePath(String(key))] }"
            />
          </button>
          <span
            v-else
            class="schema-item__control-spacer"
            aria-hidden="true"
          ></span>
        </div>

        <div class="schema-item__content">
          <div class="schema-item__headline">
            <div class="schema-item__headline-main">
              <div
                class="schema-item__name"
                :class="{
                  'schema-item__name--required': isRequired(
                    resolvedRootSchema,
                    String(key),
                    value,
                  ),
                }"
              >
                {{ key }}
                <sup
                  v-if="isRequired(resolvedRootSchema, String(key), value)"
                  class="schema-item__required-star"
                >
                  *
                </sup>
              </div>
              <div class="schema-item__type">
                {{ getTypeLabel(value, getNodePath(String(key))) }}
              </div>
              <div
                v-if="getPlainDescription(value, getNodePath(String(key)))"
                class="schema-item__summary"
              >
                {{ getPlainDescription(value, getNodePath(String(key))) }}
              </div>
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
            v-if="getHtmlDescription(value, getNodePath(String(key)))"
            class="schema-item__description prose prose-sm max-w-none"
            v-html="getHtmlDescription(value, getNodePath(String(key)))"
          ></div>

          <div
            v-if="
              getFlagTokens(value, getNodePath(String(key))).length > 0 ||
              getConstraintTokens(value, getNodePath(String(key))).length > 0 ||
              getPropertyEnumItems(value, getNodePath(String(key))).length >
                0 ||
              getExampleValue(value, getNodePath(String(key))) !== undefined ||
              getPatternValue(value, getNodePath(String(key)))
            "
            class="schema-item__details"
          >
            <div
              v-if="getFlagTokens(value, getNodePath(String(key))).length > 0"
              class="schema-item__detail-row"
            >
              <span class="schema-item__detail-label">属性:</span>
              <div class="schema-item__detail-content">
                <span
                  v-for="item in getFlagTokens(value, getNodePath(String(key)))"
                  :key="item"
                  class="meta-chip"
                >
                  {{ item }}
                </span>
              </div>
            </div>

            <div
              v-if="
                getConstraintTokens(value, getNodePath(String(key))).length > 0
              "
              class="schema-item__detail-row"
            >
              <span class="schema-item__detail-label">约束:</span>
              <div class="schema-item__detail-content">
                <span
                  v-for="item in getConstraintTokens(
                    value,
                    getNodePath(String(key)),
                  )"
                  :key="item"
                  class="meta-chip meta-chip--constraint"
                >
                  {{ item }}
                </span>
              </div>
            </div>

            <div
              v-if="
                getPropertyEnumItems(value, getNodePath(String(key))).length > 0
              "
              class="schema-item__detail-row"
            >
              <span class="schema-item__detail-label">枚举值:</span>
              <div class="schema-item__detail-content">
                <span
                  v-for="item in getPropertyEnumItems(
                    value,
                    getNodePath(String(key)),
                  )"
                  :key="item.value"
                  class="enum-entry"
                >
                  <span class="meta-chip meta-chip--mono">{{
                    item.value
                  }}</span>
                  <span v-if="item.description" class="enum-entry__description">
                    - {{ item.description }}
                  </span>
                </span>
              </div>
            </div>

            <div
              v-if="
                getExampleValue(value, getNodePath(String(key))) !== undefined
              "
              class="schema-item__detail-row"
            >
              <span class="schema-item__detail-label">示例:</span>
              <div class="schema-item__detail-content">
                <ElTooltip
                  :content="
                    formatValue(
                      getExampleValue(value, getNodePath(String(key))),
                    )
                  "
                  placement="top"
                >
                  <span class="meta-chip meta-chip--mono">
                    {{
                      formatValue(
                        getExampleValue(value, getNodePath(String(key))),
                      )
                    }}
                  </span>
                </ElTooltip>
              </div>
            </div>

            <div
              v-if="getPatternValue(value, getNodePath(String(key)))"
              class="schema-item__detail-row"
            >
              <span class="schema-item__detail-label">正则匹配:</span>
              <div class="schema-item__detail-content">
                <ElTooltip
                  :content="getPatternValue(value, getNodePath(String(key)))"
                  placement="top"
                >
                  <span class="meta-chip meta-chip--mono">
                    {{ getPatternValue(value, getNodePath(String(key))) }}
                  </span>
                </ElTooltip>
              </div>
            </div>
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
  --field-chip-radius: calc(var(--radius, 12px) * 0.82);
  --field-chip-bg: var(--el-fill-color-light);
  --field-chip-border: var(--el-border-color);
  --field-chip-text: var(--el-text-color-primary);
  --field-chip-value-weight: 600;
  --field-required: var(--el-color-danger);
}

.schema-root-pill {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 10px;
  align-items: center;
  width: 100%;
  min-width: 0;
  min-height: 36px;
  padding: 6px 12px;
  margin-bottom: 10px;
  background: var(--field-chip-bg);
  border: 1px solid var(--field-chip-border);
  border-radius: calc(var(--radius, 12px) * 0.92);
}

.schema-root-pill__title {
  font-size: 12px;
  font-weight: 700;
  color: var(--el-text-color-secondary);
  letter-spacing: 0.04em;
}

.schema-root-pill__value {
  font-family: 'JetBrains Mono', 'Fira Code', SFMono-Regular, monospace;
  font-size: 12px;
  font-weight: var(--field-chip-value-weight);
  color: var(--field-chip-text);
}

.schema-stack {
  display: grid;
  width: 100%;
}

.schema-stack > .schema-item + .schema-item {
  border-top: 1px solid var(--el-border-color-lighter);
}

.composition-switch__buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin-left: auto;
}

.schema-item {
  box-sizing: border-box;
  width: 100%;
  padding: 10px 0;
}

.schema-item__top {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  width: 100%;
}

.schema-item__control {
  display: flex;
  flex: none;
  align-items: flex-start;
  justify-content: center;
  width: 18px;
  min-width: 18px;
  padding-top: 2px;
}

.schema-item__toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: calc(var(--field-chip-radius) * 0.78);
  transition:
    color 0.16s ease,
    background-color 0.16s ease,
    box-shadow 0.16s ease,
    transform 0.16s ease;
}

.schema-item__toggle:hover {
  color: var(--el-color-primary);
  background: color-mix(
    in srgb,
    var(--el-color-primary-light-9) 82%,
    transparent
  );
}

.schema-item__toggle:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px
    color-mix(in srgb, var(--el-color-primary-light-8) 75%, transparent);
}

.schema-item__toggle--expanded {
  color: var(--el-color-primary);
  background: color-mix(
    in srgb,
    var(--el-color-primary-light-9) 88%,
    transparent
  );
}

.schema-item__toggle:active {
  transform: scale(0.95);
}

.schema-item__control-spacer {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
}

.schema-item__content {
  flex: 1;
  width: 100%;
  min-width: 0;
}

.schema-item__headline {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px 12px;
  align-items: start;
  min-width: 0;
}

.schema-item__headline-main {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  gap: 4px 10px;
  align-items: center;
  min-width: 0;
}

.schema-item__name {
  position: relative;
  display: inline-block;
  max-width: 100%;
  padding-right: 8px;
  font-family: 'JetBrains Mono', 'Fira Code', SFMono-Regular, monospace;
  font-size: 14px;
  font-weight: 700;
  color: var(--el-text-color-primary);
  overflow-wrap: anywhere;
}

.schema-item__name--required {
  color: var(--field-required);
}

.schema-item__required-star {
  position: absolute;
  top: 0;
  right: 0;
  margin-left: 0;
  font-size: 10px;
  font-style: normal;
  font-weight: 700;
  line-height: 1;
  color: var(--field-required);
  transform: translate(42%, -34%);
}

.schema-item__type {
  font-family: 'JetBrains Mono', 'Fira Code', SFMono-Regular, monospace;
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
}

.schema-item__summary,
.schema-item__description {
  min-width: 0;
  font-size: 12px;
  line-height: 1.65;
  color: var(--el-text-color-secondary);
}

.schema-item__summary {
  min-width: 0;
}

.schema-item__description {
  margin-top: 6px;
}

.schema-item__details {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 6px 8px;
  margin-top: 8px;
}

.schema-item__detail-row {
  display: contents;
}

.schema-item__detail-label {
  align-self: center;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.45;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}

.schema-item__detail-content {
  display: flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  gap: 4px 6px;
  align-items: center;
  min-width: 0;
}

.schema-item__meta-variant {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  justify-content: flex-end;
}

.meta-chip {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  max-width: 100%;
  min-height: 22px;
  padding: 1px 6px;
  font-size: 11.5px;
  font-weight: var(--field-chip-value-weight);
  line-height: 1.35;
  color: var(--field-chip-text);
  overflow-wrap: anywhere;
  white-space: normal;
  background: var(--field-chip-bg);
  border: 1px solid var(--field-chip-border);
  border-radius: var(--field-chip-radius);
}

.meta-chip--mono {
  font-family: 'JetBrains Mono', 'Fira Code', SFMono-Regular, monospace;
  font-weight: inherit;
}

.meta-chip--constraint {
  font-weight: 500;
  color: var(--el-text-color-secondary);
}

.enum-entry {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 3px 5px;
  align-items: center;
  min-width: 0;
  max-width: 100%;
}

.enum-entry__description {
  font-size: 12px;
  line-height: 1.45;
  color: var(--el-text-color-secondary);
  overflow-wrap: anywhere;
  white-space: normal;
}

.variant-switch-button {
  min-width: 28px;
  height: 24px;
  padding: 0 8px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  background: var(--field-chip-bg);
  border: 1px solid var(--field-chip-border);
  border-radius: var(--field-chip-radius);
}

.variant-switch-button--active {
  color: var(--el-color-primary);
  background: color-mix(
    in srgb,
    var(--el-color-primary-light-9) 78%,
    var(--el-bg-color) 22%
  );
  border-color: color-mix(
    in srgb,
    var(--el-color-primary-light-7) 86%,
    transparent
  );
}

.schema-item__children {
  box-sizing: border-box;
  width: 100%;
  padding-left: 12px;
  margin-top: 10px;
  margin-left: 2px;
  border-left: 1px solid
    color-mix(in srgb, var(--el-border-color-lighter) 88%, transparent);
}

@media (max-width: 768px) {
  .schema-item__details {
    grid-template-columns: 1fr;
    row-gap: 4px;
  }

  .schema-item__detail-row {
    display: grid;
    grid-template-columns: 1fr;
    gap: 2px;
  }

  .schema-item__headline {
    grid-template-columns: minmax(0, 1fr);
  }

  .schema-item__headline-main {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .schema-item__summary {
    grid-column: 1 / -1;
  }

  .schema-item__detail-label {
    min-width: 0;
  }
}
</style>
