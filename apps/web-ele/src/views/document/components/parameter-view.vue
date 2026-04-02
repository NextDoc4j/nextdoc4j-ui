<script setup lang="ts">
import type { Parameter } from '#/typings/openApi';

import { computed } from 'vue';

import { ElTooltip } from 'element-plus';

import { getEnumItems } from '#/utils/enumexpand';
import { resolveSchema } from '#/utils/schema';

defineOptions({
  name: 'ParameterView',
});

const props = defineProps<{
  parameter: Parameter;
}>();

const schema = computed(() => {
  return props.parameter.schema ? resolveSchema(props.parameter.schema) : null;
});

const constraints = computed(() => {
  const source = schema.value || props.parameter;
  const parts: string[] = [];

  if (source.minLength !== undefined) {
    parts.push(
      `>=${source.minLength}${source.type === 'string' ? ' 字符' : ''}`,
    );
  }
  if (source.maxLength !== undefined) {
    parts.push(
      `<=${source.maxLength}${source.type === 'string' ? ' 字符' : ''}`,
    );
  }
  if (source.minimum !== undefined) {
    parts.push(`>=${source.minimum}`);
  }
  if (source.maximum !== undefined) {
    parts.push(`<=${source.maximum}`);
  }

  return parts.join(' 或 ');
});

const hasHtmlDescription = computed(() => {
  const desc = props.parameter.description || schema.value?.items?.description;
  return desc?.includes('<');
});

const plainDescription = computed(() => {
  const desc = props.parameter.description || schema.value?.items?.description;
  return hasHtmlDescription.value ? null : desc;
});

const htmlDescription = computed(() => {
  const desc = props.parameter.description || schema.value?.items?.description;
  return hasHtmlDescription.value ? desc : null;
});

const enumItems = computed(() => {
  const schemaSource = schema.value || props.parameter.schema;
  if (!schemaSource) return [];

  return getEnumItems(schemaSource);
});

const enumValueList = computed(() => {
  return enumItems.value.map((item) => String(item.value)).join(', ');
});

const typeLabel = computed(() => {
  const target = schema.value;
  if (!target) return '-';

  if (target.type === 'array') {
    const itemType = target.items?.type || 'any';
    const itemSuffix = target.items?.format ? `<${target.items.format}>` : '';
    return `array<${itemType}${itemSuffix}>`;
  }

  const suffix = target.format ? `<${target.format}>` : '';
  return `${target.type || 'unknown'}${suffix}`;
});

const exampleValue = computed(() => {
  return props.parameter.example ?? schema.value?.example;
});

const defaultValue = computed(() => {
  return props.parameter.default;
});

const patternValue = computed(() => {
  return schema.value?.pattern || '';
});

const formatValue = (value: unknown) => {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
};
</script>

<template>
  <div class="parameter-item">
    <div class="parameter-item__top">
      <div class="parameter-item__headline">
        <div class="parameter-item__name">
          {{ parameter.name }}
        </div>
        <div class="parameter-item__meta">
          <span
            class="meta-pill"
            :class="
              parameter.required ? 'meta-pill--required' : 'meta-pill--optional'
            "
          >
            {{ parameter.required ? '必填' : '可选' }}
          </span>
          <span class="meta-pill meta-pill--type">
            {{ typeLabel }}
          </span>
          <ElTooltip
            v-if="exampleValue !== undefined && exampleValue !== null"
            :content="formatValue(exampleValue)"
            placement="top"
          >
            <span class="meta-pill meta-pill--example">
              示例 {{ formatValue(exampleValue) }}
            </span>
          </ElTooltip>
          <ElTooltip
            v-if="defaultValue !== undefined && defaultValue !== null"
            :content="formatValue(defaultValue)"
            placement="top"
          >
            <span class="meta-pill meta-pill--default">
              默认 {{ formatValue(defaultValue) }}
            </span>
          </ElTooltip>
          <ElTooltip
            v-if="patternValue"
            :content="patternValue"
            placement="top"
          >
            <span class="meta-pill meta-pill--pattern">
              正则 {{ patternValue }}
            </span>
          </ElTooltip>
          <span v-if="constraints" class="meta-pill meta-pill--constraint">
            约束 {{ constraints }}
          </span>
        </div>
      </div>
    </div>

    <div v-if="plainDescription" class="parameter-item__description">
      {{ plainDescription }}
    </div>
    <div
      v-if="htmlDescription"
      class="parameter-item__description prose prose-sm max-w-none"
      v-html="htmlDescription"
    ></div>

    <div v-if="enumItems.length > 0" class="parameter-item__enum">
      <span class="parameter-item__enum-label">枚举</span>
      <div class="parameter-item__enum-values">
        <span v-for="item in enumItems" :key="item.value" class="enum-pill">
          <span class="enum-pill__value">{{ item.value }}</span>
          <span v-if="item.description" class="enum-pill__description">
            {{ item.description }}
          </span>
        </span>
      </div>
      <span v-if="enumValueList" class="parameter-item__enum-available">
        可用值: {{ enumValueList }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.parameter-item {
  --doc-chip-radius: calc(var(--radius) * 999);
  --doc-radius-sm: calc(var(--radius) * 1.25);

  padding: 10px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.parameter-item:last-child {
  padding-bottom: 0;
  border-bottom: none;
}

.parameter-item__top {
  display: block;
}

.parameter-item__headline {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 10px;
  align-items: center;
}

.parameter-item__name {
  font-family: 'JetBrains Mono', 'Fira Code', SFMono-Regular, monospace;
  font-size: 14px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.parameter-item__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.parameter-item__description {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.parameter-item__enum {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin-top: 8px;
}

.parameter-item__enum-label {
  flex: none;
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
}

.parameter-item__enum-values {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.meta-pill {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 5px;
  align-items: center;
  min-height: 24px;
  padding: 0 8px;
  font-size: 11px;
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

.meta-pill--default {
  color: #475569;
  background: #f5f7fa;
  border-color: #d5dde8;
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

.enum-pill {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  min-height: 26px;
  padding: 0 10px;
  color: #1f4ba8;
  background: #eff4ff;
  border: 1px solid #c7d5ef;
  border-radius: var(--doc-radius-sm);
}

.enum-pill__value {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  min-width: 18px;
  font-family: 'JetBrains Mono', 'Fira Code', SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 700;
  color: #1e3f8a;
  text-align: center;
}

.enum-pill__description {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.parameter-item__enum-available {
  flex: none;
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

:deep(.document-page--dark .parameter-item .meta-pill),
:deep(html.dark .parameter-item .meta-pill) {
  color: #bfcad9;
  background: #232a36;
  border-color: #3f4d61;
}

:deep(.document-page--dark .parameter-item .meta-pill--type),
:deep(html.dark .parameter-item .meta-pill--type) {
  color: #a9c0eb;
  background: #1e2838;
  border-color: #3b4d67;
}

:deep(.document-page--dark .parameter-item .meta-pill--default),
:deep(html.dark .parameter-item .meta-pill--default) {
  color: #c3cfde;
  background: #252d3a;
  border-color: #435368;
}

:deep(.document-page--dark .parameter-item .meta-pill--required),
:deep(html.dark .parameter-item .meta-pill--required) {
  color: #f0b2ad;
  background: #372228;
  border-color: #5c3840;
}

:deep(.document-page--dark .parameter-item .meta-pill--optional),
:deep(html.dark .parameter-item .meta-pill--optional) {
  color: #aad8be;
  background: #1d3127;
  border-color: #385a49;
}

:deep(.document-page--dark .parameter-item .meta-pill--example),
:deep(html.dark .parameter-item .meta-pill--example) {
  color: #e3c199;
  background: #372d22;
  border-color: #5a4a35;
}

:deep(.document-page--dark .parameter-item .meta-pill--pattern),
:deep(html.dark .parameter-item .meta-pill--pattern) {
  color: #c8b8e6;
  background: #2d2539;
  border-color: #4c4061;
}

:deep(.document-page--dark .parameter-item .meta-pill--constraint),
:deep(html.dark .parameter-item .meta-pill--constraint) {
  color: #9fcec9;
  background: #1d3131;
  border-color: #385956;
}

:deep(.document-page--dark .parameter-item .enum-pill),
:deep(html.dark .parameter-item .enum-pill) {
  color: #a9c0eb;
  background: #1e2d42;
  border-color: #3a4f6e;
}

:deep(.document-page--dark .parameter-item .enum-pill__value),
:deep(html.dark .parameter-item .enum-pill__value) {
  color: #d4e1f5;
}
</style>
