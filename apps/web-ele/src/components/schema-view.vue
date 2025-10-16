<script setup lang="ts">
import { ref } from 'vue';

import { SvgCaretRightIcon } from '@vben/icons';

defineOptions({
  name: 'SchemaView', // 给组件命名
});
defineProps<{
  data: any;
}>();
const fold = ref<{ [propName: string]: boolean }>({});
const isExpandable = (item: any) => {
  return (
    (item.type === 'object' && Object.keys(item.properties).length > 0) ||
    (item.type === 'array' && item.items?.type === 'object')
  );
};

const getChildSchema = (item: any) => {
  if (item.type === 'object') {
    const obj = item.properties || {};
    for (const key in obj) {
      obj[key].fold = false;
    }
    return obj;
  } else if (item.type === 'array') {
    return item.items?.type === 'object'
      ? item.items.properties || {}
      : item.items;
  }
  return {};
};

const childSchemaLength = (item: any) => {
  if (item.type === 'object') {
    return Object.keys(item.properties || {}).length;
  } else if (item.type === 'array' && item.items?.type === 'object') {
    return Object.keys(item.items.properties || {}).length;
  }
  return 0;
};

const handleNode = (value, key) => {
  if (value.type === 'object' || value?.items?.type === 'object') {
    fold.value[key] = !fold.value?.[key];
  }
};
</script>

<template>
  <div v-if="data?.type === 'array' && data?.items?.type !== 'object'">
    <span class="property-name">
      {{ data.type }}
      <span class="truncate">
        {{ `[${data.items.type}]` }}
        <span v-if="data?.items?.format">
          {{ `<${data.items.format}>` }}
        </span>
      </span>
    </span>
  </div>
  <div
    v-else
    v-for="(value, key) in getChildSchema(data)"
    :key="key"
    class="index-node-wrap"
  >
    <div
      class="index-node pt-6"
      :class="{
        'cursor-pointer':
          value.type === 'object' || value?.items?.type === 'object',
      }"
      @click="handleNode(value, key)"
    >
      <div class="relative flex items-center justify-items-start">
        <div class="flex flex-1 flex-col items-stretch gap-1">
          <div class="flex items-center">
            <SvgCaretRightIcon
              :style="{
                transform: fold?.[key] ? 'rotate(0deg)' : 'rotate(90deg)',
              }"
              v-if="isExpandable(value)"
              class="ml-[-12px] size-3"
            />
            <span class="property-name">
              <span
                class="truncate hover:underline hover:decoration-dashed"
                v-copy
              >
                {{ key }}
              </span>
            </span>
            &nbsp;
            <div class="text-muted-big">
              <template v-if="value.enum">enum&lt;</template>
              <span class="text-muted-big">{{ value.type }}</span>
              <template v-if="value.enum">></template>
            </div>
            <span
              v-if="value.format"
              class="color-[#667085] font-400 text-[12px]"
            >
              {{ `<${value.format}>` }}
            </span>
            <div
              v-if="value.type === 'array'"
              class="color-[#667085] font-400 text-[12px]"
            >
              <span>[</span>

              <span>{{ value.items.type }}</span>
              <span
                v-if="value.items.type === 'object'"
                class="color-[#667085] font-400 text-[12px]"
              >
                {{ ` (${value.items.title}) ${childSchemaLength(value)} ` }}
              </span>
              <span v-if="value.items.format">
                {{ `<${value.items.format}>` }}
              </span>
              <span>]</span>
            </div>
            &nbsp;
            <div
              v-if="value.type === 'object'"
              class="color-[#667085] font-400 text-[12px]"
            >
              <span v-if="value.title">{{ ` (${value.title}) ` }}</span>
            </div>
            &nbsp;
            <div
              class="index_additionalInformation flex flex-1 items-center truncate"
            >
              <div v-if="value.description && !value.description.includes('<')">
                <span class="index-additionalInformation__title">
                  {{ value.description }}
                </span>
              </div>
              <div class="index-divider"></div>
            </div>
            <span v-if="data?.required?.includes(key)" class="index-required">
              必需
            </span>
            <span v-else class="index-optional">可选</span>
          </div>
          <div class="flex flex-nowrap items-center">
            <span v-if="value?.schema?.minLength" class="index-value">
              {{
                `>=${value.schema.minLength} ${value.schema.type === 'string' ? '字符' : ''}`
              }}
            </span>
            <span v-if="value?.schema?.maxLength" class="index-value">
              {{
                `<= ${value.schema.maxLength} ${value.schema.type === 'string' ? '字符' : ''}`
              }}
            </span>
            <span v-if="value?.schema?.minimum" class="index-value">
              {{ `>= ${value.schema.minimum}` }}
            </span>
            <span v-if="value?.schema?.maximum" class="index-value">
              {{ `<= ${value.schema.maximum}` }}
            </span>
            <span v-if="value?.minLength" class="index-value">
              {{
                `>=${value.minLength} ${value.type === 'string' ? '字符' : ''}`
              }}
            </span>
            <span v-if="value?.maxLength" class="index-value">
              {{
                `<= ${value.maxLength} ${value.type === 'string' ? '字符' : ''}`
              }}
            </span>
            <span v-if="value?.minimum" class="index-value">
              {{ `>= ${value.minimum}` }}
            </span>
            <span v-if="value?.maximum" class="index-value">
              {{ `<= ${value.maximum}` }}
            </span>
          </div>
          <div
            v-if="value.description && value.description.includes('<')"
            class="color-[#667085] font-400 mt-2"
            v-html="value.description"
          ></div>
          <template v-if="value.enum">
            <div class="flex-items-start mt-2 flex flex-nowrap">
              <span class="index-key">枚举值:</span>
              <span
                v-for="item in value.enum"
                :key="item"
                class="index-value mr-2"
              >
                {{ item }}
              </span>
            </div>
          </template>

          <div
            v-if="!isExpandable(value) && value.example"
            class="flex-items-start flex flex-nowrap"
          >
            <span class="index-key">示例值:</span>
            <span class="index-value">{{ value.example }}</span>
          </div>
          <template v-if="value.pattern">
            <div class="flex-items-start mt-2 flex flex-nowrap">
              <span class="index-key">正则匹配:</span>
              <span class="index-value">{{ value.pattern }}</span>
            </div>
          </template>
        </div>
        <div class="index-sub-border"></div>
      </div>
    </div>

    <div
      v-if="isExpandable(value) && !fold[key]"
      class="index-child-stack overflow-hidden transition-all duration-300 ease-in"
    >
      <SchemaView :data="value" />
    </div>
  </div>
</template>

<style lang="scss" scoped></style>
