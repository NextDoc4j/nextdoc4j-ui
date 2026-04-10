<script setup lang="ts">
import type { Parameter } from '#/typings/openApi';

import { computed } from 'vue';

import { ElTooltip } from 'element-plus';

import { getEnumItems } from '#/utils/enumexpand';
import { getSchemaTypeLabel, resolveSchema } from '#/utils/schema';

defineOptions({
  name: 'ParameterView',
});

const props = defineProps<{
  parameter: Parameter;
}>();

const schema = computed(() => {
  return props.parameter.schema ? resolveSchema(props.parameter.schema) : null;
});

const constraintTokens = computed(() => {
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

  return parts;
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

const typeLabel = computed(() => {
  return getSchemaTypeLabel(schema.value);
});

const exampleValue = computed(() => {
  return props.parameter.example ?? schema.value?.example;
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
    <div class="parameter-item__headline">
      <div class="parameter-item__title-line">
        <div
          class="parameter-item__name"
          :class="{ 'parameter-item__name--required': parameter.required }"
        >
          {{ parameter.name }}
          <sup v-if="parameter.required" class="parameter-item__required-star">
            *
          </sup>
        </div>
        <div class="parameter-item__type">{{ typeLabel }}</div>
        <div v-if="plainDescription" class="parameter-item__summary">
          {{ plainDescription }}
        </div>
      </div>
    </div>

    <div
      v-if="htmlDescription"
      class="parameter-item__description prose prose-sm max-w-none"
      v-html="htmlDescription"
    ></div>

    <div
      v-if="
        constraintTokens.length > 0 ||
        enumItems.length > 0 ||
        (exampleValue !== undefined && exampleValue !== null) ||
        patternValue
      "
      class="parameter-item__details"
    >
      <div
        v-if="constraintTokens.length > 0"
        class="parameter-item__detail-row"
      >
        <span class="parameter-item__detail-label">约束:</span>
        <div class="parameter-item__detail-content">
          <span v-for="item in constraintTokens" :key="item" class="meta-chip">
            {{ item }}
          </span>
        </div>
      </div>

      <div v-if="enumItems.length > 0" class="parameter-item__detail-row">
        <span class="parameter-item__detail-label">枚举值:</span>
        <div class="parameter-item__detail-content">
          <span v-for="item in enumItems" :key="item.value" class="enum-entry">
            <span class="meta-chip meta-chip--mono">{{ item.value }}</span>
            <span v-if="item.description" class="enum-entry__description">
              - {{ item.description }}
            </span>
          </span>
        </div>
      </div>

      <div
        v-if="exampleValue !== undefined && exampleValue !== null"
        class="parameter-item__detail-row"
      >
        <span class="parameter-item__detail-label">示例:</span>
        <div class="parameter-item__detail-content">
          <ElTooltip :content="formatValue(exampleValue)" placement="top">
            <span class="meta-chip meta-chip--mono">
              {{ formatValue(exampleValue) }}
            </span>
          </ElTooltip>
        </div>
      </div>

      <div v-if="patternValue" class="parameter-item__detail-row">
        <span class="parameter-item__detail-label">正则匹配:</span>
        <div class="parameter-item__detail-content">
          <ElTooltip :content="patternValue" placement="top">
            <span class="meta-chip meta-chip--mono">{{ patternValue }}</span>
          </ElTooltip>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.parameter-item {
  --field-chip-radius: calc(var(--radius, 12px) * 0.82);
  --field-chip-bg: var(--el-fill-color-light);
  --field-chip-border: var(--el-border-color);
  --field-chip-text: var(--el-text-color-primary);
  --field-chip-value-weight: 600;
  --field-required: var(--el-color-danger);

  padding: 10px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.parameter-item:last-child {
  padding-bottom: 0;
  border-bottom: none;
}

.parameter-item__headline {
  min-width: 0;
}

.parameter-item__title-line {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  gap: 4px 10px;
  align-items: center;
  min-width: 0;
}

.parameter-item__name {
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

.parameter-item__name--required {
  color: var(--field-required);
}

.parameter-item__required-star {
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

.parameter-item__type {
  font-family: 'JetBrains Mono', 'Fira Code', SFMono-Regular, monospace;
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
}

.parameter-item__summary,
.parameter-item__description {
  min-width: 0;
  font-size: 12px;
  line-height: 1.65;
  color: var(--el-text-color-secondary);
}

.parameter-item__summary {
  min-width: 0;
}

.parameter-item__description {
  margin-top: 6px;
}

.parameter-item__details {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  column-gap: 8px;
  row-gap: 6px;
  margin-top: 8px;
}

.parameter-item__detail-row {
  display: contents;
}

.parameter-item__detail-label {
  align-self: start;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.45;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}

.parameter-item__detail-content {
  display: flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  gap: 4px 6px;
  align-items: center;
  min-width: 0;
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

@media (max-width: 768px) {
  .parameter-item__details {
    grid-template-columns: 1fr;
    row-gap: 4px;
  }

  .parameter-item__detail-row {
    display: grid;
    grid-template-columns: 1fr;
    gap: 2px;
  }

  .parameter-item__title-line {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .parameter-item__summary {
    grid-column: 1 / -1;
  }

  .parameter-item__detail-label {
    min-width: 0;
  }
}
</style>
