<script lang="ts" setup>
import type { Component } from 'vue';

import type { MenuRecordRaw } from '@vben/types';

import type { ServiceItem } from '#/store/aggregation';

import { computed } from 'vue';
import { useRouter } from 'vue-router';

import {
  SvgDocExportOpenapiIcon,
  SvgMenuApiIcon,
  SvgMenuDocumentIcon,
  SvgMenuDocumentManageIcon,
  SvgMenuEntityIcon,
  SvgMenuSafetyIcon,
} from '@vben/icons';
import { preferences } from '@vben/preferences';
import { useAccessStore } from '@vben/stores';

import { storeToRefs } from 'pinia';

import { methodType } from '#/constants/methods';
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

// HTTP 方法分布配色，复用接口详情的方法主题色
const METHOD_ORDER = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const;

// 统计所有接口按 HTTP 方法的数量分布，用于首页方法分布条
const methodDistribution = computed(() => {
  const counter: Record<string, number> = {};
  const collect = (servicePaths: Record<string, any>) => {
    Object.values(servicePaths).forEach((methods) => {
      Object.keys(methods || {}).forEach((method) => {
        const key = method.toUpperCase();
        counter[key] = (counter[key] ?? 0) + 1;
      });
    });
  };

  if (isAggregation.value) {
    services.value.forEach((service) => {
      collect(serviceCache.value.get(service.url)?.openApi?.paths || {});
    });
  } else {
    collect(paths.value);
  }

  const total = Object.values(counter).reduce((sum, count) => sum + count, 0);
  return METHOD_ORDER.filter((method) => counter[method]).map((method) => ({
    method,
    count: counter[method] ?? 0,
    percent: total > 0 ? ((counter[method] ?? 0) / total) * 100 : 0,
    color: methodType[method]?.color ?? 'var(--el-color-primary)',
  }));
});

const router = useRouter();
const accessStore = useAccessStore();

interface ModuleEntry {
  description: string;
  icon: Component;
  path: string;
  title: string;
}

// 固定功能模块入口配置，title 用于匹配实际已注册的菜单，未注册的模块会被自动过滤
const MODULE_ENTRY_CONFIGS: Array<{
  description: string;
  icon: Component;
  matchPaths: string[];
  title: string;
}> = [
  {
    title: '接口文档',
    description: '浏览全部 API 接口',
    icon: SvgMenuApiIcon,
    matchPaths: ['/document'],
  },
  {
    title: '实体模型',
    description: '查看数据结构定义',
    icon: SvgMenuEntityIcon,
    matchPaths: ['/entity'],
  },
  {
    title: '全局认证',
    description: '配置接口鉴权方式',
    icon: SvgMenuSafetyIcon,
    matchPaths: ['/authorize'],
  },
  {
    title: '全局配置',
    description: '管理文档全局参数',
    icon: SvgMenuDocumentManageIcon,
    matchPaths: ['/doc-manage/global-params', '/doc-manage'],
  },
  {
    title: '文档下载',
    description: '导出 OpenAPI 规范',
    icon: SvgDocExportOpenapiIcon,
    matchPaths: ['/doc-manage/export'],
  },
  {
    title: '其它文档',
    description: '查阅补充说明文档',
    icon: SvgMenuDocumentIcon,
    matchPaths: ['/markdown'],
  },
];

// 收集所有已注册菜单的路径，用于判断模块入口是否可用
const registeredPaths = computed(() => {
  const paths = new Set<string>();
  const traverse = (menus: MenuRecordRaw[]) => {
    menus.forEach((menu) => {
      if (menu.path) {
        paths.add(menu.path);
      }
      if (menu.children?.length) {
        traverse(menu.children);
      }
    });
  };
  traverse(accessStore.accessMenus as MenuRecordRaw[]);
  return paths;
});

// 根据已注册菜单过滤并生成固定功能模块入口
const moduleEntries = computed<ModuleEntry[]>(() => {
  return MODULE_ENTRY_CONFIGS.map((config) => {
    const matched = config.matchPaths.find((path) =>
      [...registeredPaths.value].some((registered) =>
        registered.startsWith(path),
      ),
    );
    if (!matched) {
      return null;
    }
    return {
      title: config.title,
      description: config.description,
      icon: config.icon,
      path: matched,
    };
  }).filter(Boolean) as ModuleEntry[];
});

const serviceNavList = computed(() => {
  return isAggregation.value ? services.value : [];
});

const handleModuleClick = (entry: ModuleEntry) => {
  // 接口文档入口：进入所有接口概览页
  if (entry.path === '/document') {
    router.push('/document/all');
    return;
  }
  router.push(entry.path);
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
  <div class="home-page h-full w-full overflow-y-auto overflow-x-hidden p-5">
    <header
      class="header-wrapper relative overflow-hidden bg-gradient-to-r from-[var(--el-color-primary)] to-[var(--el-color-primary-light-5)]"
    >
      <!-- 左侧项目信息：占 2/3 宽度 -->
      <div
        class="flex flex-1 flex-col gap-4 text-sm"
        style="flex: 0 0 66.66%; max-width: 66.66%"
      >
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
      <!-- 右侧 Logo 区域：占 1/3 宽度 -->
      <div
        v-if="brand?.logo || preferences.logo.source"
        class="flex items-center justify-center"
        style="flex: 0 0 33.33%; max-width: 33.33%"
      >
        <img
          :src="brand?.logo ?? preferences.logo.source"
          alt="Logo"
          class="w-24"
        />
      </div>
    </header>
    <!-- 统计卡片：API 方法分布 + 模型与分组 -->
    <section class="stat-row">
      <div class="stat-card block">
        <div class="block-head">
          <div class="sc-head-left">
            <span class="sc-ico">
              <SvgMenuApiIcon />
            </span>
            <div>
              <h2 class="block-title">API 接口</h2>
            </div>
          </div>
          <div class="sc-total">
            <span class="sc-num">{{ apiCount }}</span>
            <span class="sc-unit">个</span>
          </div>
        </div>

        <div v-if="methodDistribution.length > 0" class="method-bar">
          <span
            v-for="item in methodDistribution"
            :key="item.method"
            class="seg"
            :style="{ width: `${item.percent}%`, background: item.color }"
          ></span>
        </div>
        <div v-if="methodDistribution.length > 0" class="method-legend">
          <span
            v-for="item in methodDistribution"
            :key="item.method"
            class="ml"
          >
            <i class="mc" :style="{ background: item.color }"></i>
            {{ item.method }}<b>{{ item.count }}</b>
          </span>
        </div>
        <div v-else class="stat-empty">暂无接口数据</div>
      </div>

      <div class="stat-card block">
        <div class="block-head">
          <div class="sc-head-left">
            <span class="sc-ico">
              <SvgMenuEntityIcon />
            </span>
            <div>
              <h2 class="block-title">模型与分组</h2>
            </div>
          </div>
        </div>
        <div class="duo">
          <div class="duo-item">
            <span class="duo-num">{{ entityCount }}</span>
            <span class="duo-label">
              <i class="duo-dot dot-entity"></i>实体模型
            </span>
          </div>
          <div class="duo-divider"></div>
          <div class="duo-item">
            <span class="duo-num">{{ groupCount }}</span>
            <span class="duo-label">
              <i class="duo-dot dot-group"></i>业务分组
            </span>
          </div>
        </div>
      </div>
    </section>

    <!-- 聚合模式：服务快速切换 -->
    <section
      v-if="isAggregation && serviceNavList.length > 0"
      class="service-block block"
    >
      <div class="block-head">
        <div>
          <h2 class="block-title">服务列表</h2>
          <p class="block-sub">切换不同的微服务文档</p>
        </div>
      </div>
      <div class="service-grid">
        <button
          v-for="service in serviceNavList"
          :key="service.url"
          type="button"
          class="service-chip"
          :class="{
            'service-chip--active': service.url === currentService?.url,
          }"
          @click="handleServiceClick(service)"
        >
          <span class="service-chip__name">{{ service.name }}</span>
          <span class="service-chip__badge">{{
            getServiceBadge(service)
          }}</span>
        </button>
      </div>
    </section>

    <!-- 功能入口 -->
    <section v-if="moduleEntries.length > 0" class="block">
      <div class="block-head">
        <div>
          <h2 class="block-title">功能入口</h2>
        </div>
      </div>
      <div class="entries">
        <button
          v-for="entry in moduleEntries"
          :key="entry.path"
          type="button"
          class="entry"
          @click="handleModuleClick(entry)"
        >
          <span class="entry-ico">
            <component :is="entry.icon" />
          </span>
          <span class="entry-text">
            <b>{{ entry.title }}</b>
            <small>{{ entry.description }}</small>
          </span>
          <span class="entry-arrow">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </span>
        </button>
      </div>
    </section>
  </div>
</template>
<style lang="scss" scoped>
@media (max-width: 900px) {
  .stat-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .entries {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 600px) {
  .entries {
    grid-template-columns: minmax(0, 1fr);
  }
}

.home-page {
  --home-radius: calc(var(--radius) * 1.18);
  --home-radius-sm: calc(var(--radius) * 0.94);
  --home-radius-chip: var(--radius);
  --home-line: var(--el-border-color-lighter);
  --home-panel: var(--el-bg-color);

  /* 卡片悬浮观感：页面底色用更柔和的填充色，卡片保持纯净背景色拉开层次 */
  --home-shadow-sm:
    0 1px 2px color-mix(in srgb, var(--el-text-color-primary) 6%, transparent),
    0 2px 8px color-mix(in srgb, var(--el-text-color-primary) 5%, transparent);
  --home-shadow-md:
    0 4px 14px color-mix(in srgb, var(--el-text-color-primary) 8%, transparent),
    0 10px 30px color-mix(in srgb, var(--el-text-color-primary) 7%, transparent);

  display: flex;
  flex-direction: column;
  gap: 22px;
  background: var(--el-fill-color-light);
}

.header-wrapper {
  @apply flex justify-between px-6 py-10 text-white;

  flex-shrink: 0;
  border-radius: var(--home-radius);
}

/* 统计卡片行 */
.stat-row {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 18px;
}

.block {
  padding: 22px 24px;
  background: var(--home-panel);
  border: 1px solid var(--home-line);
  border-radius: var(--home-radius);
  box-shadow: var(--home-shadow-sm);
}

.block-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 18px;
}

.block-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.block-sub {
  margin-top: 4px;
  font-size: 12.5px;
  color: var(--el-text-color-secondary);
}

.stat-card {
  display: flex;
  flex-direction: column;
  transition:
    box-shadow 0.18s ease,
    border-color 0.18s ease;
}

.stat-card:hover {
  border-color: color-mix(in srgb, var(--el-color-primary) 25%, transparent);
  box-shadow: var(--home-shadow-md);
}

.sc-head-left {
  display: flex;
  gap: 12px;
  align-items: center;
}

.sc-ico {
  display: grid;
  flex: none;
  place-items: center;
  width: 40px;
  height: 40px;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border-radius: var(--home-radius-sm);
}

.sc-ico :deep(svg) {
  width: 20px;
  height: 20px;
}

.sc-total {
  display: flex;
  gap: 4px;
  align-items: baseline;
}

.sc-num {
  font-size: 30px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  color: var(--el-text-color-primary);
}

.sc-unit {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

.method-bar {
  display: flex;
  gap: 2px;
  height: 14px;
  margin-top: auto;
  margin-bottom: 16px;
  overflow: hidden;
  background: var(--el-fill-color-light);
  border-radius: var(--home-radius-chip);
}

.seg {
  height: 100%;
}

.method-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.ml {
  display: inline-flex;
  gap: 7px;
  align-items: center;
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-secondary);
}

.ml b {
  font-variant-numeric: tabular-nums;
  color: var(--el-text-color-primary);
}

.mc {
  width: 9px;
  height: 9px;
  border-radius: calc(var(--radius) * 0.5);
}

.stat-empty {
  display: flex;
  flex: 1;
  align-items: center;
  font-size: 13px;
  color: var(--el-text-color-placeholder);
}

/* 模型与分组 */
.duo {
  display: flex;
  gap: 8px;
  align-items: center;
  padding-top: 6px;
  margin-top: auto;
}

.duo-item {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 9px;
  align-items: flex-start;
}

.duo-num {
  font-size: 34px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.duo-label {
  display: inline-flex;
  gap: 7px;
  align-items: center;
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-secondary);
}

.duo-dot {
  width: 9px;
  height: 9px;
  border-radius: calc(var(--radius) * 0.5);
}

.dot-entity {
  background: var(--el-color-primary);
}

.dot-group {
  background: color-mix(in srgb, var(--el-color-primary) 50%, transparent);
}

.duo-divider {
  align-self: stretch;
  width: 1px;
  margin: 2px 8px;
  background: var(--home-line);
}

/* 服务列表 */
.service-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}

.service-chip {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  cursor: pointer;
  background: var(--home-panel);
  border: 1px solid var(--home-line);
  border-radius: var(--home-radius-sm);
  transition: all 0.18s ease;
}

.service-chip:hover {
  border-color: color-mix(in srgb, var(--el-color-primary) 35%, transparent);
  transform: translateY(-2px);
}

.service-chip--active {
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary);
}

.service-chip__name {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  white-space: nowrap;
}

.service-chip__badge {
  flex: none;
  padding: 1px 8px;
  font-size: 11px;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border: 1px solid color-mix(in srgb, var(--el-color-primary) 30%, transparent);
  border-radius: var(--home-radius-chip);
}

/* 功能入口卡片 */
.entries {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
}

.entry {
  position: relative;
  display: flex;
  gap: 13px;
  align-items: center;
  padding: 16px;
  overflow: hidden;
  text-align: left;
  cursor: pointer;
  background: var(--home-panel);
  border: 1px solid var(--home-line);
  border-radius: var(--home-radius-sm);
  transition: all 0.18s ease;
}

.entry:hover {
  border-color: color-mix(in srgb, var(--el-color-primary) 35%, transparent);
  box-shadow: var(--home-shadow-md);
  transform: translateY(-3px);
}

.entry-ico {
  display: grid;
  flex: none;
  place-items: center;
  width: 42px;
  height: 42px;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border-radius: var(--home-radius-sm);
  transition: all 0.18s ease;
}

.entry-ico :deep(svg) {
  width: 20px;
  height: 20px;
}

.entry:hover .entry-ico {
  color: #fff;
  background: var(--el-color-primary);
}

.entry-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.entry-text b {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.entry-text small {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.entry-arrow {
  flex: none;
  color: var(--el-text-color-placeholder);
  opacity: 0;
  transform: translateX(-3px);
  transition: all 0.18s ease;
}

.entry-arrow svg {
  width: 16px;
  height: 16px;
}

.entry:hover .entry-arrow {
  color: var(--el-color-primary);
  opacity: 1;
  transform: translateX(0);
}
</style>
