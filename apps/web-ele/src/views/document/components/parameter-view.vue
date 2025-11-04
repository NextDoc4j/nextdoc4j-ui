<script setup lang="ts">
import type { Parameter } from '#/typings/openApi';

import { computed } from 'vue';

import { resolveSchema } from '#/utils/schema';

defineOptions({
  name: 'ParameterView',
});

const props = defineProps<{
  parameter: Parameter;
}>();

const schema = computed(() => {
  const s = props.parameter.schema
    ? resolveSchema(props.parameter.schema)
    : null;
  return s;
});

const isPathParam = computed(() => props.parameter.in === 'path');

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
</script>

<template>
  <div
    class="border-b border-gray-100 py-6 last:border-b-0 last:pb-0 dark:border-gray-800"
  >
    <!-- Path 参数样式 -->
    <template v-if="isPathParam">
      <div class="mb-2 flex items-center gap-2">
        <span class="text-primary font-mono text-base font-bold">
          {{ parameter.name }}
        </span>
        <div
          v-if="schema"
          class="flex rounded-md bg-gray-100/50 px-1.5 font-mono text-xs font-bold text-gray-600 dark:bg-white/5 dark:text-gray-200"
        >
          <span>{{ schema.type }}</span>
          <span v-if="schema.format">{{ `<${schema.format}>` }}</span>
        </div>

        <div
          v-if="parameter.example"
          class="flex items-center rounded-md bg-gray-100/50 px-1.5 text-xs text-gray-600 dark:bg-white/5 dark:text-gray-200"
        >
          <span class="mr-0.5 text-gray-400 dark:text-gray-500">示例值：</span>
          <span class="font-mono">{{ parameter.example }}</span>
        </div>

        <div
          v-if="parameter.default"
          class="flex items-center rounded-md bg-gray-100/50 px-1.5 text-xs text-gray-600 dark:bg-white/5 dark:text-gray-200"
        >
          <span class="mr-0.5 text-gray-400 dark:text-gray-500">默认值：</span>
          <span class="font-mono">{{ parameter.default }}</span>
        </div>

        <div
          v-if="constraints"
          class="flex items-center rounded-md bg-gray-100/50 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-white/5 dark:text-gray-200"
        >
          <span class="mr-0.5 text-gray-400 dark:text-gray-500">
            取值范围：
          </span>
          <span class="font-mono">
            {{ constraints }}
          </span>
        </div>

        <div
          class="rounded-md bg-red-100/50 px-1.5 text-xs font-bold text-red-600 dark:bg-red-400/10 dark:text-red-300"
        >
          必须
        </div>
      </div>

      <div v-if="plainDescription" class="text-gray-600 dark:text-gray-400">
        {{ plainDescription }}
      </div>

      <div
        v-if="htmlDescription"
        class="mt-2 text-gray-600 dark:text-gray-400"
        v-html="htmlDescription"
      ></div>
    </template>

    <!-- Query 参数样式 -->
    <template v-else>
      <div class="mb-2 flex items-center gap-2">
        <div class="flex items-center gap-2">
          <span class="font-mono text-base font-bold text-red-600">
            {{ parameter.name }}
          </span>
          <div
            v-if="schema"
            class="flex rounded-md bg-gray-100/50 px-1.5 py-0.5 font-mono text-xs font-bold text-gray-600 dark:bg-white/5 dark:text-gray-200"
          >
            <span>{{ schema.type }}</span>
            <span v-if="schema.format">{{ `<${schema.format}>` }}</span>
          </div>

          <div
            v-if="parameter.example"
            class="flex items-center rounded-md bg-gray-100/50 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-white/5 dark:text-gray-200"
          >
            <span class="mr-0.5 text-gray-400 dark:text-gray-500">
              示例值：
            </span>
            <span class="font-mono">{{ parameter.example }}</span>
          </div>

          <div
            v-if="parameter.default"
            class="flex items-center rounded-md bg-gray-100/50 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-white/5 dark:text-gray-200"
          >
            <span class="mr-0.5 text-gray-400 dark:text-gray-500">
              默认值：
            </span>
            <span class="font-mono">{{ parameter.default }}</span>
          </div>

          <div
            v-if="constraints"
            class="flex items-center rounded-md bg-gray-100/50 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-white/5 dark:text-gray-200"
          >
            <span class="mr-0.5 text-gray-400 dark:text-gray-500">
              取值范围：
            </span>
            <span class="font-mono">
              {{ constraints }}
            </span>
          </div>

          <div
            v-if="parameter.required"
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
        <div
          v-if="htmlDescription"
          class="mt-2 text-sm text-gray-600 dark:text-gray-400"
          v-html="htmlDescription"
        ></div>
      </div>
      <div class="mt-4 text-gray-600 dark:text-gray-400">
        {{ plainDescription }}
      </div>
      <div
        v-if="schema?.enum || schema?.items?.enum"
        class="mt-6 flex items-center"
      >
        <span class="text-xs font-medium text-gray-600 dark:text-gray-400">
          可用值：
        </span>
        <div
          v-for="value in (schema?.enum || schema?.items?.enum).filter(Boolean)"
          :key="value"
          class="mr-2 rounded-md bg-gray-100/50 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-white/5 dark:text-gray-200"
        >
          <span class="font-mono">{{ value }}</span>
        </div>
      </div>
    </template>
  </div>
</template>
