<script setup lang="ts">
import type { Component } from 'vue';

import { computed, isRef } from 'vue';

import { IconDefault, IconifyIcon } from '@vben-core/icons';
import {
  isFunction,
  isHttpUrl,
  isObject,
  isString,
} from '@vben-core/shared/utils';

const props = defineProps<{
  // 没有是否显示默认图标
  fallback?: boolean;
  icon?: Component | Function | string;
}>();

// 尝试解包响应式对象，获取原始值
const getRawIcon = () => {
  let icon = props.icon;
  // 处理 ref
  if (isRef(icon)) {
    icon = (icon as any).value;
  }
  // 如果是对象且有 name 属性（Iconify 图标组件）
  if (isObject(icon) && (icon as any).name) {
    // 提取 Iconify 图标名称（如 "Icon-svg:menu-safety" -> "svg:menu-safety"）
    const name = (icon as any).name;
    if (name.startsWith('Icon-')) {
      return name.slice(5); // 去掉 "Icon-" 前缀
    }
  }
  return icon;
};

// 使用 getter 避免 computed 重复创建响应式依赖
const rawIcon = computed(() => getRawIcon());

const isRemoteIcon = computed(() => {
  const icon = rawIcon.value;
  return isString(icon) && isHttpUrl(icon);
});

const isComponent = computed(() => {
  const icon = rawIcon.value;
  // 如果是字符串（Iconify 图标名称），则不是组件
  if (isString(icon)) return false;
  return isObject(icon) || isFunction(icon);
});
</script>

<template>
  <component :is="rawIcon as Component" v-if="isComponent" v-bind="$attrs" />
  <img v-else-if="isRemoteIcon" :src="rawIcon as string" v-bind="$attrs" />
  <IconifyIcon v-else-if="rawIcon" v-bind="$attrs" :icon="rawIcon as string" />
  <IconDefault v-else-if="fallback" v-bind="$attrs" />
</template>
