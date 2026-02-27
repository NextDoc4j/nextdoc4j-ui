<script lang="ts" setup>
import type { MenuItemProps } from '../types';

import { computed } from 'vue';

import { useNamespace } from '@vben-core/composables';
import { ChevronDown, ChevronRight } from '@vben-core/icons';

import { Icon as IconifyIcon } from '@iconify/vue';

import { useMenuContext } from '../hooks';

interface Props extends MenuItemProps {
  isMenuMore?: boolean;
  isTopLevelMenuSubmenu: boolean;
  level?: number;
}

defineOptions({ name: 'SubMenuContent' });

const props = withDefaults(defineProps<Props>(), {
  isMenuMore: false,
  level: 0,
});

const rootMenu = useMenuContext();
const { b, e, is } = useNamespace('sub-menu-content');
const nsMenu = useNamespace('menu');

const opened = computed(() => {
  return rootMenu?.openedMenus.includes(props.path);
});

const collapse = computed(() => {
  return rootMenu.props.collapse;
});

const isFirstLevel = computed(() => {
  return props.level === 1;
});

const getCollapseShowTitle = computed(() => {
  return (
    rootMenu.props.collapseShowTitle && isFirstLevel.value && collapse.value
  );
});

const mode = computed(() => {
  return rootMenu?.props.mode;
});

const showArrowIcon = computed(() => {
  return mode.value === 'horizontal' || !(isFirstLevel.value && collapse.value);
});

const iconComp = computed(() => {
  return (mode.value === 'horizontal' && !isFirstLevel.value) ||
    (mode.value === 'vertical' && collapse.value)
    ? ChevronRight
    : ChevronDown;
});

const iconArrowStyle = computed(() => {
  return opened.value ? { transform: `rotate(180deg)` } : {};
});

/**
 * 判断是否为 Vue 组件
 */
const isIconComponent = computed(() => {
  const { icon } = props;
  if (!icon) return false;
  return typeof icon !== 'string';
});
</script>
<template>
  <div
    :class="[
      b(),
      is('collapse-show-title', getCollapseShowTitle),
      is('more', isMenuMore),
    ]"
  >
    <slot></slot>

    <!-- Vue 组件图标 -->
    <component
      :is="props.icon"
      v-if="isIconComponent && props.icon && !isMenuMore"
      :class="nsMenu.e('icon')"
    />
    <!-- 字符串图标 (iconify) -->
    <IconifyIcon
      v-else-if="props.icon && !isMenuMore"
      :icon="props.icon"
      :class="nsMenu.e('icon')"
    />
    <div :class="[e('title')]">
      <slot name="title"></slot>
    </div>

    <component
      :is="iconComp"
      v-if="!isMenuMore"
      v-show="showArrowIcon"
      :class="[e('icon-arrow')]"
      :style="iconArrowStyle"
      class="size-4"
    />
  </div>
</template>
