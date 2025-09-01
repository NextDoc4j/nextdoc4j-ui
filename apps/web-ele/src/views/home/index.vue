<script lang="ts" setup>
import type { RouteRecordRaw } from '@vben/types';

import { computed } from 'vue';
import { useRouter } from 'vue-router';

import { useApiStore } from '#/store';

defineOptions({ name: 'Home' });

const apiStore = useApiStore();
const { info, openapi, paths, components } = apiStore.openApi!;
const brand = apiStore.openApi?.['x-nextdoc4j'].brand;
const apiCount = computed(() => {
  let count = 0;
  Object.entries(paths).forEach(([, value]) => {
    count += Object.keys(value).length;
  });
  return count;
});
const entityCount = computed(() => {
  return Object.keys(components.schemas).length;
});
const groupCount = Object.keys(apiStore.swaggerConfig?.urls ?? {}).length;
const router = useRouter();
const navList = computed(() => {
  const rootChildren =
    router.options.routes.find((i) => i.path === '/')?.children ?? [];
  const documentChildren =
    rootChildren.find((i) => i.path === '/document')?.children ?? [];
  return documentChildren.filter((i) => i.name !== 'all');
});
const countLeaves = (treeData: RouteRecordRaw) => {
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
const handleClick = (item: RouteRecordRaw) => {
  router.push(item.path);
};
</script>

<template>
  <div class="h-full w-full overflow-y-auto p-5">
    <header class="header-wrapper">
      <!-- 左侧项目信息 -->
      <div class="flex flex-col gap-4 text-sm">
        <h1 class="text-3xl font-bold">{{ info?.title ?? 'Nextdoc4j' }}</h1>
        <p>
          {{ info?.description }}
        </p>
        <div class="mt-2 flex gap-2">
          <span>联系人：{{ info?.contact?.name }}</span>
          <a :href="info?.contact?.url" target="_blank" class="underline">
            网址：
            <span class="text-blue-400">{{ info?.contact?.url }}</span>
          </a>
          <span>
            邮箱：
            {{ info?.contact?.email }}
          </span>
        </div>
        <div class="flex gap-2 text-xs">
          <span class="rounded-2xl bg-green-400 px-2 py-1 text-white">
            {{ info?.license?.name }}
          </span>
          <span class="rounded-2xl bg-blue-400 px-2 py-1 text-white">
            {{ info?.version }}
          </span>
          <span class="rounded-2xl bg-purple-400 px-2 py-1 text-white">
            OpenAPI {{ openapi ?? '' }}
          </span>
        </div>
      </div>
      <!-- 右侧 Logo 区域 -->
      <div v-if="brand?.logo" class="flex items-center">
        <img :src="brand?.logo" alt="Logo" class="w-24" />
      </div>
    </header>
    <section class="mt-8">
      <h2 class="mb-4 text-lg font-bold">API 统计概览</h2>
      <div class="flex gap-4">
        <!-- 卡片 1：API 接口 -->
        <div
          v-if="apiCount > 0"
          class="group flex flex-1 items-center rounded-xl border-s-4 border-s-[var(--el-color-primary)] bg-white p-4 shadow hover:shadow-xl"
        >
          <span class="mr-4 text-2xl">🚀</span>
          <div>
            <h3
              class="mb-1 text-2xl font-bold transition duration-100 group-hover:scale-110"
            >
              {{ apiCount }}
            </h3>
            <p class="text-sm">API 接口</p>
          </div>
        </div>

        <!-- 卡片 2：实体模型 -->
        <div
          v-if="entityCount"
          class="group flex flex-1 items-center rounded-xl border-s-4 border-[var(--el-color-warning)] bg-white p-4 shadow hover:shadow-xl"
        >
          <span class="mr-4 text-2xl">🏗️</span>
          <div>
            <h3
              class="mb-1 text-2xl font-bold transition duration-100 group-hover:scale-110"
            >
              {{ entityCount }}
            </h3>
            <p class="text-sm">实体模型</p>
          </div>
        </div>

        <!-- 卡片 3：业务分组 -->
        <div
          v-if="groupCount"
          class="group flex flex-1 items-center rounded-xl border-s-4 border-purple-800 bg-white p-4 shadow hover:shadow-xl"
        >
          <span class="mr-4 text-2xl">📂</span>
          <div>
            <h3
              class="mb-1 text-2xl font-bold transition duration-100 group-hover:scale-110"
            >
              {{ groupCount }}
            </h3>
            <p class="text-sm">业务分组</p>
          </div>
        </div>

        <!-- 卡片 4：文档覆盖率 -->
        <div
          class="group flex flex-1 items-center rounded-xl border-s-4 border-orange-400 bg-white p-4 shadow hover:shadow-xl"
        >
          <span class="mr-4 text-2xl">✅</span>
          <div>
            <h3
              class="mb-1 text-2xl font-bold transition duration-100 group-hover:scale-110"
            >
              100%
            </h3>
            <p class="text-sm">文档覆盖率</p>
          </div>
        </div>
      </div>
    </section>
    <section class="mt-8" v-if="navList.length > 0">
      <h2 class="mb-4 text-lg font-bold">快速导航</h2>
      <div class="flex gap-4">
        <div
          class="flex flex-1 cursor-pointer items-center justify-between rounded-xl bg-white p-4 shadow hover:shadow-xl"
          v-for="item in navList"
          :key="item.path"
          @click="handleClick(item)"
        >
          <h3 class="text-sm">
            {{ item.meta?.title }}
          </h3>
          <span
            class="bg-primary/10 text-primary border-primary/30 inline-block rounded-xl border px-2 text-xs"
          >
            {{ countLeaves(item) }}
          </span>
        </div>
      </div>
    </section>
  </div>
</template>
<style lang="scss" scoped>
.header-wrapper {
  @apply flex justify-between rounded-xl px-6 py-10 text-white;

  background-image: linear-gradient(to right, #8d82e4, #8b5cf6);
}
</style>
