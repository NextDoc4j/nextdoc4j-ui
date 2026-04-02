<script setup lang="ts">
import { ref } from 'vue';

import { SvgCaretRightIcon } from '@vben/icons';

import { ElTooltip } from 'element-plus';

import { getEnumItems } from '#/utils/enumexpand';

defineOptions({
  name: 'SchemaView',
});

defineProps<{
  data: any;
}>();

const foldState = ref<Record<string, boolean>>({});

const isExpandable = (item: any) => {
  if (item?.type === 'object' && item?.properties) {
    return Object.keys(item.properties).length > 0;
  }
  if (item?.type === 'array' && item?.items?.type === 'object') {
    return true;
  }
  return false;
};

const getChildSchema = (item: any) => {
  if (!item?.type || item.type === 'object') {
    return item?.properties || {};
  }
  if (item.type === 'array' && item?.items?.type === 'object') {
    return item.items.properties || {};
  }
  return {};
};

const toggleFold = (key: string, value: any) => {
  if (isExpandable(value)) {
    foldState.value[key] = !foldState.value[key];
  }
};

const getConstraints = (value: any) => {
  const source = value?.schema || value;
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
};

const hasHtmlDescription = (desc: string) => desc?.includes('<');

const getPropertyEnumItems = (value: any) => {
  return getEnumItems(value);
};

const getEnumValueList = (value: any) => {
  return getPropertyEnumItems(value)
    .map((item) => String(item.value))
    .join(', ');
};

const getTypeLabel = (value: any) => {
  if (!value) return '-';

  if (value.type === 'array') {
    const itemType = value.items?.type || 'any';
    const itemSuffix = value.items?.format ? `<${value.items.format}>` : '';
    return `array<${itemType}${itemSuffix}>`;
  }

  const suffix = value.format ? `<${value.format}>` : '';
  if (value.title && value.type === 'object') {
    return `${value.type}<${value.title}>`;
  }
  return `${value.type || 'unknown'}${suffix}`;
};

const getExampleValue = (value: any) => {
  return value?.example;
};

const getPatternValue = (value: any) => {
  return value?.pattern || '';
};

const isRequired = (data: any, key: string, value: any) => {
  return Boolean(data?.required?.includes?.(key) || value?.required === true);
};

const formatValue = (value: unknown) => {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
};
</script>

<template>
  <div
    v-if="data?.type === 'array' && data?.items?.type !== 'object'"
    class="schema-root-pill"
  >
    <span class="schema-root-pill__title">数组结构</span>
    <span class="schema-root-pill__value">{{ getTypeLabel(data) }}</span>
  </div>

  <div v-else class="schema-stack">
    <div
      v-for="(value, key) in getChildSchema(data)"
      :key="key"
      class="schema-item"
    >
      <div class="schema-item__top">
        <button
          v-if="isExpandable(value)"
          class="schema-item__toggle"
          @click="toggleFold(String(key), value)"
        >
          <SvgCaretRightIcon
            class="size-4 transition-transform"
            :class="{ 'rotate-90': !foldState[key] }"
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
                  isRequired(data, String(key), value)
                    ? 'meta-pill--required'
                    : 'meta-pill--optional'
                "
              >
                {{ isRequired(data, String(key), value) ? '必填' : '可选' }}
              </span>
              <span class="meta-pill meta-pill--type">
                {{ getTypeLabel(value) }}
              </span>
              <ElTooltip
                v-if="getExampleValue(value) !== undefined"
                :content="formatValue(getExampleValue(value))"
                placement="top"
              >
                <span class="meta-pill meta-pill--example">
                  示例 {{ formatValue(getExampleValue(value)) }}
                </span>
              </ElTooltip>
              <ElTooltip
                v-if="getPatternValue(value)"
                :content="getPatternValue(value)"
                placement="top"
              >
                <span class="meta-pill meta-pill--pattern">
                  正则 {{ getPatternValue(value) }}
                </span>
              </ElTooltip>
              <span
                v-if="getConstraints(value)"
                class="meta-pill meta-pill--constraint"
              >
                约束 {{ getConstraints(value) }}
              </span>
            </div>
          </div>

          <div
            v-if="value.description && !hasHtmlDescription(value.description)"
            class="schema-item__description"
          >
            {{ value.description }}
          </div>
          <div
            v-if="value.description && hasHtmlDescription(value.description)"
            class="schema-item__description prose prose-sm max-w-none"
            v-html="value.description"
          ></div>

          <div
            v-if="getPropertyEnumItems(value).length > 0"
            class="schema-item__enum"
          >
            <span class="schema-item__enum-label">枚举</span>
            <div class="schema-item__enum-values">
              <span
                v-for="item in getPropertyEnumItems(value)"
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
              v-if="getEnumValueList(value)"
              class="schema-item__enum-available"
            >
              可用值: {{ getEnumValueList(value) }}
            </span>
          </div>

          <div
            v-if="isExpandable(value) && !foldState[key]"
            class="schema-item__children"
          >
            <SchemaView :data="value" />
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
  display: inline-flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  min-height: 34px;
  padding: 0 11px;
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
  font-family: 'JetBrains Mono', 'Fira Code', SFMono-Regular, monospace;
  font-size: 14px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.schema-item__headline {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 8px;
  align-items: center;
}

.schema-item__meta,
.schema-item__enum-values {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
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
