<script lang="ts" setup>
import type { MenuItemProps, MenuItemRegistered } from '../types';

import { computed, onBeforeUnmount, onMounted, reactive, useSlots } from 'vue';

import { useNamespace } from '@vben-core/composables';
import { VbenTooltip } from '@vben-core/shadcn-ui';

import { Icon as IconifyIcon } from '@iconify/vue';

import { MenuBadge } from '../components';
import { useMenu, useMenuContext, useSubMenuContext } from '../hooks';

interface Props extends MenuItemProps {}

defineOptions({ name: 'MenuItem' });

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
});

const emit = defineEmits<{ click: [MenuItemRegistered] }>();

const slots = useSlots();
const { b, e, is } = useNamespace('menu-item');
const nsMenu = useNamespace('menu');
const rootMenu = useMenuContext();
const subMenu = useSubMenuContext();
const { parentMenu, parentPaths } = useMenu();

const active = computed(() => props.path === rootMenu?.activePath);

/**
 * 判断是否为 Vue 组件
 */
const isIconComponent = computed(() => {
  const { icon } = props;
  if (!icon) return false;
  return typeof icon !== 'string';
});

const iconName = computed(() => {
  return typeof props.icon === 'string' ? props.icon : undefined;
});

const isTopLevelMenuItem = computed(
  () => parentMenu.value?.type.name === 'Menu',
);

const collapseShowTitle = computed(
  () =>
    rootMenu.props?.collapseShowTitle &&
    isTopLevelMenuItem.value &&
    rootMenu.props.collapse,
);

const showTooltip = computed(
  () =>
    rootMenu.props.mode === 'vertical' &&
    isTopLevelMenuItem.value &&
    rootMenu.props?.collapse &&
    slots.title,
);

const item: MenuItemRegistered = reactive({
  active,
  parentPaths: parentPaths.value,
  path: props.path || '',
});

/**
 * 菜单项点击事件
 */
function handleClick() {
  if (props.disabled) {
    return;
  }
  rootMenu?.handleMenuItemClick?.({
    parentPaths: parentPaths.value,
    path: props.path,
  });
  emit('click', item);
}

onMounted(() => {
  subMenu?.addSubMenu?.(item);
  rootMenu?.addMenuItem?.(item);
});

onBeforeUnmount(() => {
  subMenu?.removeSubMenu?.(item);
  rootMenu?.removeMenuItem?.(item);
});
</script>
<template>
  <li
    :class="[
      rootMenu.theme,
      b(),
      is('active', active),
      is('disabled', disabled),
      is('collapse-show-title', collapseShowTitle),
    ]"
    role="menuitem"
    @click.stop="handleClick"
  >
    <VbenTooltip
      v-if="showTooltip"
      :content-class="[rootMenu.theme]"
      side="right"
    >
      <template #trigger>
        <div :class="[nsMenu.be('tooltip', 'trigger')]">
          <!-- Vue 组件图标 -->
          <component
            :is="props.icon"
            v-if="isIconComponent && props.icon"
            :class="nsMenu.e('icon')"
          />
          <!-- 字符串图标 (iconify) -->
          <IconifyIcon
            v-else-if="iconName"
            :icon="iconName"
            :class="nsMenu.e('icon')"
          />
          <slot></slot>
          <span :class="nsMenu.e('name')">
            <slot name="title"></slot>
          </span>
        </div>
      </template>
      <slot name="title"></slot>
    </VbenTooltip>
    <div v-show="!showTooltip" :class="[e('content')]">
      <MenuBadge
        v-if="rootMenu.props.mode !== 'horizontal'"
        class="right-2"
        v-bind="props"
      />
      <!-- Vue 组件图标 -->
      <component
        :is="props.icon"
        v-if="isIconComponent && props.icon"
        :class="nsMenu.e('icon')"
      />
      <!-- 字符串图标 (iconify) -->
      <IconifyIcon
        v-else-if="iconName"
        :icon="iconName"
        :class="nsMenu.e('icon')"
      />
      <slot></slot>
      <slot name="title"></slot>
    </div>
  </li>
</template>
