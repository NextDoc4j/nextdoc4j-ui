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

// 判断是否可展开
const isExpandable = (item: any) => {
  if (item.type === 'object' && item.properties) {
    return Object.keys(item.properties).length > 0;
  }
  if (item.type === 'array' && item.items?.type === 'object') {
    return true;
  }
  return false;
};

// 获取子级 Schema
const getChildSchema = (item: any) => {
  if (!item.type || item.type === 'object') {
    return item.properties || {};
  }
  if (item.type === 'array' && item.items?.type === 'object') {
    return item.items.properties || {};
  }
  return {};
};

// 切换折叠状态
const toggleFold = (key: string, value: any) => {
  if (isExpandable(value)) {
    foldState.value[key] = !foldState.value[key];
  }
};

// 获取类型显示文本
const getTypeText = (value: any) => {
  if (value.enum) {
    return `enum<${value.type}>`;
  }
  return value.type;
};

// 获取约束信息
const getConstraints = (value: any) => {
  const source = value.schema || value;
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

// 判断描述是否包含 HTML
const hasHtmlDescription = (desc: string) => desc?.includes('<');

// 获取枚举项列表
const getPropertyEnumItems = (value: any) => {
  return getEnumItems(value);
};

// 检查是否有扩展枚举
const hasExtendedEnum = (value: any) => {
  const items = getPropertyEnumItems(value);
  return items.some((item) => item.description);
};
</script>

<template>
  <!-- 数组类型且 items 不是对象 -->
  <div
    v-if="data?.type === 'array' && data?.items?.type !== 'object'"
    class="flex items-center gap-2"
  >
    <span class="text-primary font-mono text-base font-bold">
      {{ data.type }}
    </span>
    <div
      v-if="data.items.type"
      class="flex rounded-md bg-gray-100/50 px-1.5 py-0.5 font-mono text-xs font-bold text-gray-600 dark:bg-white/5 dark:text-gray-200"
    >
      <span>{{ data.items.type }}</span>
      <span v-if="data.items.format">{{ `<${data.items.format}>` }}</span>
    </div>
  </div>

  <!-- 对象或数组对象类型 -->
  <div
    v-else
    v-for="(value, key) in getChildSchema(data)"
    :key="key"
    class="border-b border-gray-100 py-6 last:border-b-0 last:pb-0 dark:border-gray-800"
  >
    <div class="flex items-center gap-2">
      <SvgCaretRightIcon
        v-if="isExpandable(value)"
        :class="{
          'rotate-90': !foldState[key],
          'cursor-pointer': isExpandable(value),
        }"
        class="size-4 transition-transform"
        @click="toggleFold(String(key), value)"
      />
      <div class="flex items-center gap-2">
        <!-- 字段名 -->
        <span class="text-primary font-mono text-base font-bold">
          {{ key }}
        </span>

        <div
          v-if="getTypeText(value)"
          class="flex rounded-md bg-gray-100/50 px-1.5 py-0.5 font-mono text-xs font-bold text-gray-600 dark:bg-white/5 dark:text-gray-200"
        >
          <div class="flex items-center">
            <div>{{ getTypeText(value) }}</div>
            <span v-if="value.title">{{ `<${value.title}>` }}</span>
          </div>
          <span
            v-if="value.format"
            class="ml-1 text-xs text-gray-600 dark:text-gray-400"
            >{{ `<${value.format}>` }}
          </span>
        </div>

        <!-- 数组信息 -->
        <template v-if="value.type === 'array'">
          <div
            class="flex rounded-md bg-gray-100/50 px-1.5 py-0.5 font-mono text-xs font-bold text-gray-600 dark:bg-white/5 dark:text-gray-200"
          >
            <div>
              <span>{{ value.items.type }}[{{ value.items.title }}]</span>
              <span
                v-if="value.format"
                class="ml-1 text-xs text-gray-600 dark:text-gray-400"
              >
                {{ `<${value.format}>` }}
              </span>
            </div>
          </div>
        </template>

        <div
          v-if="!isExpandable(value) && value.example"
          class="flex items-center rounded-md bg-gray-100/50 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-white/5 dark:text-gray-200"
        >
          <span class="mr-0.5 text-gray-400 dark:text-gray-500">示例值:</span>
          <ElTooltip placement="top" :content="String(value.example)">
            <span class="max-w-24 truncate font-mono">
              {{ value.example }}
            </span>
          </ElTooltip>
        </div>

        <div
          v-if="!isExpandable(value) && value.default"
          class="flex items-center rounded-md bg-gray-100/50 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-white/5 dark:text-gray-200"
        >
          <span class="mr-0.5 text-gray-400 dark:text-gray-500">默认值:</span>
          <span class="font-mono">{{ value.default }}</span>
        </div>

        <div
          v-if="getConstraints(value)"
          class="flex items-center rounded-md bg-gray-100/50 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-white/5 dark:text-gray-200"
        >
          <span class="mr-0.5 text-gray-400 dark:text-gray-500">
            取值范围:
          </span>
          <span class="font-mono">
            {{ getConstraints(value) }}
          </span>
        </div>

        <div
          v-if="value.pattern"
          class="flex items-center rounded-md bg-gray-100/50 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-white/5 dark:text-gray-200"
        >
          <span class="mr-0.5 text-gray-400 dark:text-gray-500">
            正则匹配:
          </span>
          <ElTooltip placement="top" :content="String(value.pattern)">
            <span class="max-w-24 truncate font-mono">
              {{ value.pattern }}
            </span>
          </ElTooltip>
        </div>

        <div
          v-if="data?.required?.includes(key)"
          class="rounded-md bg-red-100/50 px-1.5 py-0.5 text-xs font-bold text-red-600 dark:bg-red-400/10 dark:text-red-300"
        >
          必须
        </div>
        <div
          v-else
          class="rounded-md bg-green-100/50 px-1.5 py-0.5 text-xs font-bold text-green-600 dark:bg-green-400/10 dark:text-green-300"
        >
          可选
        </div>
      </div>
    </div>

    <!-- 描述 -->
    <div
      v-if="value.description && !hasHtmlDescription(value.description)"
      class="mt-4 text-gray-600 dark:text-gray-400"
    >
      {{ value.description }}
    </div>

    <!-- HTML 描述 -->
    <div
      v-if="value.description && hasHtmlDescription(value.description)"
      class="mt-4 text-sm text-gray-600 dark:text-gray-400"
      v-html="value.description"
    ></div>

    <!-- 扩展枚举值展示 - 优先显示 -->
    <div v-if="hasExtendedEnum(value)" class="mt-4">
      <div class="mb-2 text-xs font-medium text-gray-600 dark:text-gray-400">
        可用值:
      </div>
      <div class="flex flex-wrap gap-2">
        <div
          v-for="item in getPropertyEnumItems(value)"
          :key="item.value"
          class="bg-primary/5 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs"
        >
          <span class="text-primary font-mono font-semibold">
            {{ item.value }}
          </span>
          <span
            v-if="item.description"
            class="text-gray-600 dark:text-gray-400"
          >
            - {{ item.description }}
          </span>
        </div>
      </div>
    </div>

    <!-- 普通枚举值展示 - 仅当没有扩展枚举时显示 -->
    <div v-else-if="value.enum" class="mt-6 flex items-center">
      <span class="text-xs font-medium text-gray-600 dark:text-gray-400">
        可用值:
      </span>
      <div
        v-for="item in value.enum"
        :key="item"
        class="mr-2 rounded-md bg-gray-100/50 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-white/5 dark:text-gray-200"
      >
        <span class="font-mono">{{ item }}</span>
      </div>
    </div>

    <!-- 子级展开 -->
    <div
      v-if="isExpandable(value) && !foldState[key]"
      class="ml-8 overflow-hidden transition-all duration-200"
    >
      <SchemaView :data="value" />
    </div>
  </div>
</template>
