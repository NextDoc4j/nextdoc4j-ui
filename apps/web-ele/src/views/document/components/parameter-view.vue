<script setup lang="ts">
import type { Parameter } from '#/typings/openApi';

import { computed, ref, watch } from 'vue';

import SchemaView from '#/components/schema-view.vue';
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

/**
 * query/path 参数 schema 是否为多分支 oneOf/anyOf，需复用 SchemaView 分支切换
 */
const hasCompositionVariants = computed(() => {
  const source = schema.value;
  if (!source || typeof source !== 'object') {
    return false;
  }
  if (Array.isArray(source.oneOf) && source.oneOf.length > 1) {
    return true;
  }
  if (Array.isArray(source.anyOf) && source.anyOf.length > 1) {
    return true;
  }
  return false;
});

/** 当前选中的 oneOf/anyOf 分支下标（与嵌入的 SchemaView 根 tabs 同步） */
const selectedVariantIndex = ref(0);

watch(
  () => props.parameter.name,
  () => {
    selectedVariantIndex.value = 0;
  },
);

/**
 * 多分支 composition 的选项列表
 */
const compositionOptions = computed(() => {
  const source = schema.value;
  if (!source || typeof source !== 'object') {
    return [] as any[];
  }
  if (Array.isArray(source.oneOf) && source.oneOf.length > 1) {
    return source.oneOf as any[];
  }
  if (Array.isArray(source.anyOf) && source.anyOf.length > 1) {
    return source.anyOf as any[];
  }
  return [] as any[];
});

/**
 * 当前展示用 schema：多分支时取选中分支，与 body SchemaView 类型/示例一致
 */
const displaySchema = computed(() => {
  const options = compositionOptions.value;
  if (options.length > 0) {
    const idx = selectedVariantIndex.value;
    const safe =
      typeof idx === 'number' && idx >= 0 && idx < options.length ? idx : 0;
    return options[safe] ?? options[0] ?? schema.value;
  }
  return schema.value;
});

/** SchemaView 根路径为 $ 的分支切换才驱动参数头类型/示例 */
const handleVariantChange = (payload: { index: number; path: string }) => {
  if (!payload.path || payload.path === '$') {
    selectedVariantIndex.value = Number.isFinite(payload.index)
      ? payload.index
      : 0;
  }
};

/**
 * 从 schema / examples 取可用示例（null 视为未提供）
 */
const pickUsableExample = (source: any): unknown => {
  if (!source || typeof source !== 'object') {
    return undefined;
  }
  if (source.example !== undefined && source.example !== null) {
    return source.example;
  }
  if (Array.isArray(source.examples) && source.examples.length > 0) {
    const first = source.examples[0];
    if (first === undefined || first === null) {
      return undefined;
    }
    if (typeof first === 'object' && first !== null && 'value' in first) {
      return (first as { value: unknown }).value ?? undefined;
    }
    return first;
  }
  return undefined;
};

const constraintTokens = computed(() => {
  const source = displaySchema.value || props.parameter;
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
  const schemaSource = displaySchema.value || props.parameter.schema;
  if (!schemaSource) return [];

  return getEnumItems(schemaSource);
});

const typeLabel = computed(() => {
  // 多分支时用选中分支类型，避免 composition 根始终显示 any
  return getSchemaTypeLabel(displaySchema.value);
});

const exampleValue = computed(() => {
  // 参数级示例优先
  if (
    props.parameter.example !== undefined &&
    props.parameter.example !== null
  ) {
    return props.parameter.example;
  }
  // 选中分支 / 展示 schema
  const fromDisplay = pickUsableExample(displaySchema.value);
  if (fromDisplay !== undefined) {
    return fromDisplay;
  }
  // 回退原始 schema 根（非 null）
  return pickUsableExample(schema.value);
});

const patternValue = computed(() => {
  return displaySchema.value?.pattern || '';
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
        </div>
        <div class="parameter-item__type">{{ typeLabel }}</div>
        <span v-if="parameter.required" class="parameter-item__required-tag">
          必填
        </span>
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
          <span
            v-for="item in constraintTokens"
            :key="item"
            class="meta-chip meta-chip--constraint"
          >
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
          <span class="meta-chip meta-chip--mono">
            {{ formatValue(exampleValue) }}
          </span>
        </div>
      </div>

      <div v-if="patternValue" class="parameter-item__detail-row">
        <span class="parameter-item__detail-label">正则匹配:</span>
        <div class="parameter-item__detail-content">
          <span class="meta-chip meta-chip--mono">{{ patternValue }}</span>
        </div>
      </div>
    </div>

    <!-- 多分支 oneOf/anyOf：复用 SchemaView 根级分支切换；类型/示例随 variant-change 同步 -->
    <div
      v-if="hasCompositionVariants && schema"
      class="parameter-item__composition"
    >
      <SchemaView
        :data="schema"
        mode="request"
        @variant-change="handleVariantChange"
      />
    </div>
  </div>
</template>

<style scoped>
.parameter-item {
  --field-chip-radius: 8px;
  --field-chip-bg: var(--doc-field-chip-bg, var(--el-fill-color-light));
  --field-chip-border: var(--doc-field-chip-border, var(--el-border-color));
  --field-chip-text: var(--el-text-color-primary);
  --field-chip-value-weight: 600;
  --field-required: var(--el-color-danger);

  padding: 18px 0;
  margin: 0;
  border-bottom: 1px solid var(--field-chip-border);
  transition: background-color 0.2s ease;
}

.parameter-item:hover {
  background-color: var(
    --doc-row-hover-bg,
    color-mix(in srgb, var(--el-fill-color-light) 42%, transparent)
  );
}

.parameter-item:last-child {
  border-bottom: none;
}

.parameter-item__headline {
  min-width: 0;
  padding: 0 20px;
}

.parameter-item__title-line {
  /* 流式布局：与请求体/响应参数（SchemaView）保持一致，
     字段名与类型 chip 同行按自然宽度排列，描述另起一行占满整行 */
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  align-items: center;
  min-width: 0;
}

.parameter-item__name {
  position: relative;
  display: inline-flex;
  flex: 0 1 auto;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  min-width: 0;
  max-width: 100%;
  font-family: 'JetBrains Mono', 'Fira Code', SFMono-Regular, monospace;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.5;
  color: var(--el-text-color-primary);
  word-break: normal;
  overflow-wrap: break-word;
}

.parameter-item__name--required {
  color: var(--el-text-color-primary);
}

.parameter-item__required-tag {
  display: inline-flex;
  flex: none;
  align-items: center;
  min-height: 18px;
  padding: 0 6px;
  font-family:
    Inter,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
  font-size: 10px;
  font-weight: 700;
  line-height: 18px;
  color: var(--field-required);
  background: color-mix(
    in srgb,
    var(--el-color-danger-light-9) 88%,
    transparent
  );
  border: 1px solid
    color-mix(in srgb, var(--el-color-danger-light-7) 86%, transparent);
  border-radius: 6px;
}

.parameter-item__composition {
  padding: 0 20px 4px;
  margin-top: 10px;
}

.parameter-item__type {
  display: inline-flex;
  flex: 0 1 auto;
  align-items: center;
  width: fit-content;
  min-width: 0;
  max-width: 100%;
  min-height: 24px;
  padding: 2px 8px;
  font-family: 'JetBrains Mono', 'Fira Code', SFMono-Regular, monospace;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.5;
  color: var(--el-color-primary);
  overflow-wrap: anywhere;
  white-space: normal;
  background: var(--el-color-primary-light-9);
  border-radius: 7px;
}

.parameter-item__summary,
.parameter-item__description {
  min-width: 0;
  font-size: 12px;
  line-height: 1.5;

  /* 描述用 regular 色：与请求体/响应参数（SchemaView）一致，
     浅色模式近黑、深色模式近白，比 secondary 灰色更清晰 */
  color: var(--el-text-color-regular);
}

.parameter-item__summary {
  /* 流式布局中占满整行，稳定换到字段名/类型下一行显示 */
  flex: 0 0 100%;
  min-width: 0;
  margin-top: 2px;
}

.parameter-item__description {
  padding: 0 20px;
  margin-top: 8px;
}

.parameter-item__details {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 6px 8px;
  padding: 0 20px;
  margin-top: 10px;
}

.parameter-item__detail-row {
  display: contents;
}

.parameter-item__detail-label {
  align-self: center;
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

@media (max-width: 768px) {
  .parameter-item__title-line {
    gap: 6px 8px;
  }

  .parameter-item__details {
    grid-template-columns: 1fr;
    row-gap: 4px;
  }

  .parameter-item__detail-row {
    display: grid;
    grid-template-columns: 1fr;
    gap: 2px;
  }

  .parameter-item__detail-label {
    min-width: 0;
  }
}
</style>
