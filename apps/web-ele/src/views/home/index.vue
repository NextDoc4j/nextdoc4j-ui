<script lang="ts" setup>
import type { MenuRecordRaw } from '@vben/types';

import type { ServiceItem } from '#/store/aggregation';

import { computed } from 'vue';
import { useRouter } from 'vue-router';

import { preferences } from '@vben/preferences';
import { useAccessStore } from '@vben/stores';

import { storeToRefs } from 'pinia';

import { useApiStore } from '#/store';
import { useAggregationStore } from '#/store/aggregation';

defineOptions({ name: 'Home' });

const apiStore = useApiStore();
const aggregationStore = useAggregationStore();
const { currentService, isAggregation, serviceCache, services } =
  storeToRefs(aggregationStore);

const gatewayOpenApi = computed(() => aggregationStore.mainConfigCache.openApi);
const gatewaySwaggerConfig = computed(
  () => aggregationStore.mainConfigCache.config,
);

// 使用 computed 让数据响应式更新，当 apiStore 变化时自动更新
const openApi = computed(
  () =>
    (isAggregation.value ? gatewayOpenApi.value : undefined) ??
    apiStore.openApi,
);
const info = computed(() => openApi.value?.info);
const openapi = computed(() => openApi.value?.openapi);
const paths = computed(() => openApi.value?.paths || {});
const swaggerConfig = computed(
  () =>
    (isAggregation.value ? gatewaySwaggerConfig.value : undefined) ??
    apiStore.swaggerConfig,
);
const schemas = computed(() => openApi.value?.components?.schemas ?? {});
const brand = computed(() => openApi.value?.['x-nextdoc4j']?.brand);

// 获取应用版本 - 从后端 x-nextdoc4j.version 读取，默认版本兜底
const appVersion = computed(
  () => openApi.value?.['x-nextdoc4j']?.version || '1.0.0',
);

const apiCount = computed(() => {
  if (isAggregation.value) {
    let count = 0;
    services.value.forEach((service) => {
      const servicePaths =
        serviceCache.value.get(service.url)?.openApi?.paths || {};
      Object.entries(servicePaths).forEach(([, value]) => {
        count += Object.keys(value).length;
      });
    });
    return count;
  }

  let count = 0;
  Object.entries(paths.value).forEach(([, value]) => {
    count += Object.keys(value).length;
  });
  return count;
});

const entityCount = computed(() => {
  if (isAggregation.value) {
    let count = 0;
    services.value.forEach((service) => {
      const serviceSchemas =
        serviceCache.value.get(service.url)?.openApi?.components?.schemas ?? {};
      count += Object.keys(serviceSchemas).length;
    });
    return count;
  }

  return Object.keys(schemas.value).length;
});

const groupCount = computed(() => {
  const urls = swaggerConfig.value?.urls;
  return Array.isArray(urls) ? urls.length : 0;
});

const router = useRouter();
const accessStore = useAccessStore();

const navList = computed(() => {
  const documentMenu = accessStore.accessMenus.find(
    (menu) => menu.path === '/document',
  );
  return (documentMenu?.children ?? []).filter(
    (menu) => menu.path !== '/document/all' && menu.name !== 'all',
  );
});

const serviceNavList = computed(() => {
  return isAggregation.value ? services.value : [];
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

const handleClick = (item: MenuRecordRaw) => {
  router.push(item.path);
};

const handleServiceClick = (service: ServiceItem) => {
  if (service.disabled || service.url === currentService.value?.url) {
    return;
  }
  aggregationStore.switchService(service);
};

const getServiceBadge = (service: ServiceItem) => {
  return service.status || (service.disabled ? 'DOWN' : 'UP');
};
</script>

<template>
  <div class="h-full w-full overflow-y-auto overflow-x-hidden p-5">
    <header
      class="header-wrapper relative overflow-hidden bg-gradient-to-r from-[var(--el-color-primary)] to-[var(--el-color-primary-light-5)]"
    >
      <!-- 左侧项目信息 -->
      <div class="flex flex-1 flex-col gap-4 text-sm">
        <h1 class="text-3xl font-bold">
          {{ info?.title ?? 'Nextdoc4j' }}
        </h1>
        <p>
          {{ info?.description }}
        </p>
        <div class="mt-2 flex flex-wrap gap-2">
          <span v-if="info?.contact?.name">
            联系人：{{ info?.contact?.name }}
          </span>
          <a
            v-if="info?.contact?.url"
            :href="info?.contact?.url"
            target="_blank"
          >
            网址：
            <span
              class="underline-offset-1 hover:underline hover:decoration-dashed"
            >
              {{ info?.contact?.url }}
            </span>
          </a>
          <span v-if="info?.contact?.email">
            邮箱：
            {{ info?.contact?.email }}
          </span>
        </div>
        <div class="flex cursor-pointer gap-2 text-xs text-white">
          <span
            class="transform rounded-2xl border border-[var(--el-color-success-light-3)] px-2 py-1 text-[var(--el-color-success-light-3)] hover:-translate-y-1"
            v-if="info?.license?.name"
          >
            {{ info?.license?.name }}
          </span>
          <span
            v-if="info?.version"
            class="transform rounded-2xl border border-white px-2 py-1 text-white hover:-translate-y-1"
          >
            V {{ info?.version }}
          </span>
          <span
            v-if="openapi"
            class="transform rounded-2xl border border-[var(--el-color-warning-light-3)] px-2 py-1 text-[var(--el-color-warning-light-3)] hover:-translate-y-1"
          >
            OpenAPI {{ openapi ?? '' }}
          </span>
          <span
            class="transform rounded-2xl border border-[var(--el-color-success-light-3)] px-2 py-1 text-[var(--el-color-success-light-3)] hover:-translate-y-1"
          >
            Nextdoc4j v{{ appVersion }}
          </span>
        </div>
      </div>
      <!-- 右侧 Logo 区域 -->
      <div
        v-if="brand?.logo || preferences.logo.source"
        class="flex flex-shrink-0 flex-grow-0 items-center"
      >
        <img
          :src="brand?.logo ?? preferences.logo.source"
          alt="Logo"
          class="w-24"
        />
      </div>
    </header>
    <section class="mt-8">
      <h2 class="mb-4 text-lg font-bold">API 统计概览</h2>
      <div class="flex flex-wrap gap-4">
        <!-- 卡片 1：API 接口 -->
        <div
          v-if="apiCount > 0"
          class="group flex min-w-[220px] flex-1 items-center rounded-xl border-s-4 border-s-[var(--el-color-primary)] bg-[var(--el-bg-color)] p-4 shadow hover:shadow-xl"
        >
          <span class="mr-4 text-2xl">🚀</span>
          <div>
            <h3
              class="mb-1 text-2xl font-bold text-[var(--el-text-color-primary)] transition duration-100 group-hover:scale-110"
            >
              {{ apiCount }}
            </h3>
            <p class="truncate text-sm text-[var(--el-text-color-regular)]">
              API 接口
            </p>
          </div>
        </div>

        <!-- 卡片 2：实体模型 -->
        <div
          v-if="entityCount"
          class="group flex min-w-[220px] flex-1 items-center rounded-xl border-s-4 border-[var(--el-color-warning)] bg-[var(--el-bg-color)] p-4 shadow hover:shadow-xl"
        >
          <span class="mr-4 text-2xl">🏗️</span>
          <div>
            <h3
              class="mb-1 text-2xl font-bold text-[var(--el-text-color-primary)] transition duration-100 group-hover:scale-110"
            >
              {{ entityCount }}
            </h3>
            <p class="truncate text-sm text-[var(--el-text-color-regular)]">
              实体模型
            </p>
          </div>
        </div>

        <!-- 卡片 3：业务分组 -->
        <div
          v-if="groupCount"
          class="group flex min-w-[220px] flex-1 items-center rounded-xl border-s-4 border-[var(--el-color-info)] bg-[var(--el-bg-color)] p-4 shadow hover:shadow-xl"
        >
          <span class="mr-4 text-2xl">📂</span>
          <div>
            <h3
              class="mb-1 text-2xl font-bold text-[var(--el-text-color-primary)] transition duration-100 group-hover:scale-110"
            >
              {{ groupCount }}
            </h3>
            <p class="truncate text-sm text-[var(--el-text-color-regular)]">
              业务分组
            </p>
          </div>
        </div>

        <!-- 卡片 4：文档覆盖率 -->
        <div
          class="group flex min-w-[220px] flex-1 items-center rounded-xl border-s-4 border-[var(--el-color-success)] bg-[var(--el-bg-color)] p-4 shadow hover:shadow-xl"
        >
          <span class="mr-4 text-2xl">✅</span>
          <div>
            <h3
              class="mb-1 text-2xl font-bold text-[var(--el-text-color-primary)] transition duration-100 group-hover:scale-110"
            >
              100%
            </h3>
            <p class="truncate text-sm text-[var(--el-text-color-regular)]">
              文档覆盖率
            </p>
          </div>
        </div>
      </div>
    </section>
    <section
      class="mt-8"
      v-if="isAggregation ? serviceNavList.length > 0 : navList.length > 0"
    >
      <h2 class="mb-4 text-lg font-bold">快速导航</h2>
      <div
        class="grid grid-cols-4 gap-4 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8"
      >
        <template v-if="isAggregation">
          <div
            class="flex flex-1 cursor-pointer items-center justify-between rounded-xl bg-[var(--el-bg-color)] p-4 shadow hover:shadow-xl"
            v-for="service in serviceNavList"
            :key="service.url"
            @click="handleServiceClick(service)"
          >
            <h3 class="truncate text-sm text-[var(--el-text-color-primary)]">
              {{ service.name }}
            </h3>
            <span
              class="bg-[var(--el-color-primary)]/10 border-[var(--el-color-primary)]/30 inline-block rounded-xl border px-2 text-xs text-[var(--el-color-primary)]"
            >
              {{ getServiceBadge(service) }}
            </span>
          </div>
        </template>
        <template v-else>
          <div
            class="flex flex-1 cursor-pointer items-center justify-between rounded-xl bg-[var(--el-bg-color)] p-4 shadow hover:shadow-xl"
            v-for="item in navList"
            :key="item.path"
            @click="handleClick(item)"
          >
            <h3 class="truncate text-sm text-[var(--el-text-color-primary)]">
              {{ item.name }}
            </h3>
            <span
              class="bg-[var(--el-color-primary)]/10 border-[var(--el-color-primary)]/30 inline-block rounded-xl border px-2 text-xs text-[var(--el-color-primary)]"
            >
              {{ countLeaves(item) }}
            </span>
          </div>
        </template>
      </div>
    </section>
  </div>
</template>
<style lang="scss" scoped>
.header-wrapper {
  @apply flex justify-between rounded-xl px-6 py-10 text-white;
}
</style>
