<script setup lang="ts">
import type { MenuRecordRaw } from '@vben-core/typings';

import { computed } from 'vue';

import { MenuBadge, MenuItem, SubMenu as SubMenuComp } from './components';
// eslint-disable-next-line import/no-self-import
import SubMenu from './sub-menu.vue';

interface Props {
  /**
   * 菜单项
   */
  menu: MenuRecordRaw;
}

defineOptions({
  name: 'SubMenuUi',
});

const props = withDefaults(defineProps<Props>(), {});

const methodType: Record<string, any> = {
  GET: {
    backgroundColor: '#e3f6ed',
    color: '#17b26a',
  },
  PUT: {
    backgroundColor: '#2e90fa',
    color: '#fff',
  },
  POST: {
    backgroundColor: '#fdede4',
    color: '#ef6820',
  },
  DELETE: {
    backgroundColor: '#fde9e7',
    color: '#f04438',
  },
  PATCH: {
    backgroundColor: '#fde9f7',
    color: '#ee46bc',
  },
};
/**
 * 判断是否有子节点，动态渲染 menu-item/sub-menu-item
 */
const hasChildren = computed(() => {
  const { menu } = props;
  return (
    Reflect.has(menu, 'children') && !!menu.children && menu.children.length > 0
  );
});

const countLeaves = (treeData: MenuRecordRaw) => {
  let count = 0;

  function traverse(node: MenuRecordRaw) {
    // 如果没有子节点或子节点数组为空，则是叶子节点
    if (!node.children || node.children.length === 0) {
      count++;
      return;
    }
    // 递归遍历子节点
    node.children.forEach((child) => traverse(child));
  }
  // 处理可能是数组形式的树结构
  if (Array.isArray(treeData)) {
    treeData.forEach((root) => traverse(root));
  } else {
    traverse(treeData);
  }

  return count;
};
</script>

<template>
  <MenuItem
    v-if="!hasChildren"
    :key="menu.path"
    :badge="menu.badge"
    :badge-type="menu.badgeType"
    :badge-variants="menu.badgeVariants"
    :path="menu.path"
  >
    <template #title>
      <span class="flex-1">{{ menu.name }}</span>
      <span
        class="bg-blue-6 inline-flex max-w-[70px] items-center rounded-lg px-1.5 py-0.5 text-xs font-bold text-white"
        :style="{ ...methodType[menu?.method?.toUpperCase()] }"
        v-if="menu.method"
      >
        {{ menu?.method?.toUpperCase() ?? '' }}
      </span>
    </template>
  </MenuItem>
  <SubMenuComp v-else :key="`${menu.path}_sub`" :path="menu.path">
    <template #content>
      <MenuBadge
        :badge="menu.badge"
        :badge-type="menu.badgeType"
        :badge-variants="menu.badgeVariants"
        class="right-6"
      />
    </template>
    <template #title>
      <span>{{ menu.name }}</span>
      <span
        class="bg-primary/10 text-primary border-primary/30 ml-6 inline-block rounded-xl border px-2 text-xs"
        v-if="menu.parents?.includes('/document')"
      >
        {{ menu.children ? countLeaves(menu) : '' }}
      </span>
    </template>
    <template v-for="childItem in menu.children || []" :key="childItem.path">
      <SubMenu :menu="childItem" />
    </template>
  </SubMenuComp>
</template>
