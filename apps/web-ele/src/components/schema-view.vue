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
.schema-root-pill {
  --doc-chip-radius: calc(var(--radius) * 999);
  --doc-radius-sm: calc(var(--radius) * 1.25);

  display: inline-flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  min-height: 40px;
  padding: 0 14px;
  background: var(--el-color-primary-light-9);
  border: 1px solid var(--el-color-primary-light-7);
  border-radius: calc(var(--radius) * 2.5);
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
  color: var(--el-color-primary);
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
  gap: 8px 10px;
  align-items: center;
}

.schema-item__meta,
.schema-item__enum-values {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.schema-item__enum {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin-top: 8px;
}

.schema-item__enum-label {
  flex: none;
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
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
  gap: 5px;
  align-items: center;
  min-height: 24px;
  padding: 0 8px;
  font-size: 11px;
  color: var(--el-text-color-regular);
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--doc-chip-radius);
}

.meta-pill--type {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary-light-7);
}

.meta-pill--required {
  color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
  border-color: var(--el-color-danger-light-7);
}

.meta-pill--optional {
  color: var(--el-color-success);
  background: var(--el-color-success-light-9);
  border-color: var(--el-color-success-light-7);
}

.meta-pill--example {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary-light-7);
}

.meta-pill--pattern {
  color: var(--el-color-warning-dark-2);
  background: var(--el-color-warning-light-9);
  border-color: var(--el-color-warning-light-7);
}

.meta-pill--constraint {
  color: var(--el-color-success);
  background: var(--el-color-success-light-9);
  border-color: var(--el-color-success-light-7);
}

.enum-pill {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  min-height: 26px;
  padding: 0 10px;
  background: var(--el-color-primary-light-9);
  border: 1px solid var(--el-color-primary-light-7);
  border-radius: var(--doc-radius-sm);
}

.enum-pill__value {
  font-family: 'JetBrains Mono', 'Fira Code', SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 700;
  color: var(--el-color-primary);
}

.enum-pill__description {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
</style>
