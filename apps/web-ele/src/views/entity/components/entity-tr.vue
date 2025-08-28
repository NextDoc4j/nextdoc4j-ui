<script lang="ts" setup>
import type { Schema } from '#/typings/openApi';

import { SvgCaretRightIcon } from '@vben/icons';

import { ElTag } from 'element-plus';

import { DataType } from '#/constants/data-types';

defineOptions({
  name: 'EntityTr',
});
defineProps<{
  className?: object;
  treeData: any;
}>();
const isExpandable = (item: Schema) => {
  if (item.type === 'object' && Object.keys(item.properties ?? {}).length > 0) {
    return true;
  }
  return false;
};
const isArray = (item: Schema) => {
  if (item.type === 'array' && item?.items?.type === 'object') {
    return true;
  }
  return false;
};
</script>
<template>
  <template v-for="(item, index) in treeData" :key="index">
    <tr
      :class="{
        ...className,
        'cursor-pointer': isExpandable(item) || isArray(item),
      }"
      @click="item.fold = !item.fold"
    >
      <td>
        <span class="entity-name">
          <span class="absolute ml-[-18px] cursor-pointer">
            <SvgCaretRightIcon
              :style="{
                transform: !item.fold ? 'rotate(90deg)' : 'rotate(0deg)',
              }"
              v-if="isExpandable(item) || isArray(item)"
            />
          </span>
          <span>{{ index }}</span>
        </span>
      </td>
      <td>
        <span
          class="entity-type"
          :style="{ color: DataType[item.type ?? 'default']?.color }"
        >
          {{ `${item.type}${item.format ? `<${item.format}>` : ''}` }}
        </span>
      </td>
      <td>
        <span>{{ item.example }}</span>
      </td>
      <td>
        <span class="entity-description" v-html="item.description"></span>
      </td>
    </tr>
    <entity-tr
      :class-name="{
        'indent-row': isExpandable(item),
      }"
      v-if="!item.fold && isExpandable(item)"
      :tree-data="item.properties"
    />
    <tr
      v-if="!item.fold && isArray(item)"
      class="cursor-pointer"
      :class="className"
      @click="item.arrayFold = !item.arrayFold"
    >
      <td>
        <span class="entity-name pl-6">
          <span class="absolute ml-[-18px] cursor-pointer">
            <SvgCaretRightIcon
              :style="{
                transform: !item.arrayFold ? 'rotate(90deg)' : 'rotate(0deg)',
              }"
            />
          </span>
          <ElTag>ITEMS</ElTag>
        </span>
      </td>
      <td>
        <span
          class="entity-type"
          :style="{ color: DataType[item.type ?? 'default']?.color }"
        >
          {{ `${item.type}${item.format ? `<${item.format}>` : ''}` }}
        </span>
      </td>
      <td>
        <span>{{ item.example }}</span>
      </td>
      <td></td>
    </tr>
    <entity-tr
      :class-name="{
        'indent-row': isExpandable(item),
        'index-row-array': isArray(item),
      }"
      v-if="!item.fold && !item.arrayFold && isArray(item)"
      :tree-data="item.items.properties"
    />
  </template>
</template>
<style lang="scss">
.entity-name {
  @apply flex w-full items-center;
}

.entity-type {
  @apply text-sm;
}

.entity-description {
  @apply block text-sm;
}

.entity-table {
  @apply mt-6 w-full border;

  table-layout: fixed;

  tr {
    @apply border-t;

    &:first-child {
      @apply border-none;
    }
  }

  td {
    @apply px-6 py-2 text-start leading-snug;

    span {
      @apply whitespace-normal text-start text-sm leading-snug;

      word-wrap: break-word;
      white-space: normal;
    }
  }
}

.indent-row td:first-child {
  @apply pl-12;
}

.index-row-array td:first-child {
  @apply pl-24;
}
</style>
