<script lang="ts" setup>
import type { MenuRecordRaw, ThemeModeType } from '@vben/types';

import { computed } from 'vue';

import { LayoutMenu as Menu } from '@vben/layouts';

import { storeToRefs } from 'pinia';

import ServiceSelector from '#/components/service-selector.vue';
import { useAggregationStore } from '#/store/aggregation';

// 不继承 MenuProps，直接定义所需的属性
interface Props {
  accordion?: boolean;
  collapse?: boolean;
  collapseShowTitle?: boolean;
  defaultActive?: string;
  menus?: MenuRecordRaw[];
  mode?: 'horizontal' | 'vertical';
  rounded?: boolean;
  theme?: ThemeModeType;
}

const props = withDefaults(defineProps<Props>(), {
  accordion: true,
  collapse: false,
  collapseShowTitle: false,
  defaultActive: '',
  menus: () => [],
  mode: 'vertical',
  rounded: false,
  theme: undefined,
});

const emit = defineEmits<{
  open: [string, string[]];
  select: [string, string?];
}>();

const aggregationStore = useAggregationStore();
const { isAggregation } = storeToRefs(aggregationStore);

const showServiceSelector = computed(() => isAggregation.value);

function handleMenuSelect(key: string) {
  emit('select', key, props.mode);
}

function handleMenuOpen(key: string, path: string[]) {
  emit('open', key, path);
}
</script>

<template>
  <div class="service-menu-wrapper">
    <!-- 服务选择器 -->
    <ServiceSelector v-if="showServiceSelector" />

    <!-- 菜单 -->
    <Menu
      :accordion="accordion"
      :collapse="collapse"
      :collapse-show-title="collapseShowTitle"
      :default-active="defaultActive"
      :menus="menus"
      :mode="mode"
      :rounded="rounded"
      scroll-to-active
      :theme="theme"
      @open="handleMenuOpen"
      @select="handleMenuSelect"
    />
  </div>
</template>

<style scoped>
.service-menu-wrapper {
  display: flex;
  flex-direction: column;
  height: 100%;
}
</style>
