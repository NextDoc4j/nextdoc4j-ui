<script setup lang="ts">
import type { MenuRecordRaw } from '@vben-core/typings';

import type { MenuProps } from './types';

import { computed } from 'vue';

import { useForwardProps } from '@vben-core/composables';

import { Menu } from './components';
import SubMenu from './sub-menu.vue';

interface Props extends MenuProps {
  menus: MenuRecordRaw[];
}

defineOptions({
  name: 'MenuView',
});

const props = withDefaults(defineProps<Props>(), {
  collapse: false,
});

const forward = useForwardProps(props);

const activeOpeneds = computed(() => {
  const activePath = props.defaultActive;
  if (!activePath) {
    return props.defaultOpeneds;
  }

  const menus = [...props.menus];
  while (menus.length > 0) {
    const menu = menus.pop();
    if (!menu) {
      continue;
    }
    if (menu.path === activePath) {
      return [
        ...(menu.parents ?? []),
        ...(menu.children?.length ? [menu.path] : []),
      ];
    }
    menus.push(...(menu.children ?? []));
  }

  return props.defaultOpeneds;
});
</script>

<template>
  <Menu v-bind="forward" :default-openeds="activeOpeneds">
    <template v-for="menu in menus" :key="menu.path">
      <SubMenu :menu="menu" />
    </template>
  </Menu>
</template>
