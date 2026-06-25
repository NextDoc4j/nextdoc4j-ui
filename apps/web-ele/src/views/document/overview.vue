<script setup lang="ts">
import type { ApiInfo } from '#/typings/openApi';

import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { ElEmpty, ElInput } from 'element-plus';

import { getMethodStyle } from '#/constants/methods';
import { useApiStore } from '#/store';

defineOptions({ name: 'GroupOverview' });

interface OverviewGroupSection {
  apis: ApiInfo[];
  key: string;
  title: string;
}

const route = useRoute();
const router = useRouter();
const apiStore = useApiStore();

/** 从路由名中解析分组信息：如 "all*用户管理*__overview__" -> ["all", "用户管理"]，一级概览 group 为空 */
const groupInfo = computed(() => {
  const name = route.name as string;
  if (!name) return { tag: '', group: '' };

  const parts = name.split('*');
  if (parts.length < 2) return { tag: '', group: '' };

  if (parts[1] === '__overview__') {
    return {
      tag: parts[0] ?? '',
      group: '',
    };
  }

  return {
    tag: parts[0] ?? '',
    group: parts[1] ?? '',
  };
});

/** 当前概览页标题，二级分组显示分组名，一级分组显示父级菜单标题 */
const overviewTitle = computed(() => {
  const { tag, group } = groupInfo.value;
  if (group) return group;

  const activePath = route.meta.activePath as string | undefined;
  const matchedRoute = route.matched.find((item) => item.path === activePath);
  return `${matchedRoute?.meta?.title ?? (tag === 'all' ? '所有接口' : tag)}`;
});

/** 当前点击分组对应的完整概览分组数据。一级分组聚合全部二级子分组，二级分组只展示自身。 */
const groupSections = computed<OverviewGroupSection[]>(() => {
  const { tag, group } = groupInfo.value;
  if (!tag) return [];

  const tagData = apiStore.apiData?.[tag];
  if (!tagData) return [];

  if (!group) {
    return Object.entries(tagData)
      .filter(([, value]) => Array.isArray(value) && value.length > 0)
      .map(([key, value]) => ({
        key,
        title: key,
        apis: value as ApiInfo[],
      }));
  }

  const directApis = tagData[group];
  if (Array.isArray(directApis)) {
    return [
      {
        key: group,
        title: group,
        apis: directApis,
      },
    ];
  }

  const prefix = `${group}/`;
  return Object.entries(tagData)
    .filter(([key]) => key === group || key.startsWith(prefix))
    .filter(([, value]) => Array.isArray(value) && value.length > 0)
    .map(([key, value]) => ({
      key,
      title: key === group ? group : key.slice(prefix.length),
      apis: value as ApiInfo[],
    }));
});

/** 当前分组下的所有接口 */
const apis = computed<ApiInfo[]>(() => {
  return groupSections.value.flatMap((section) => section.apis);
});

/**
 * 用途：去除描述中的 HTML 标签并压缩空白，生成用于搜索匹配的纯文本。
 * 参数说明：html 为接口描述 HTML 字符串，可为空。
 * 返回值说明：返回清理后的纯文本内容。
 */
const plainText = (html?: string) => {
  if (!html) return '';
  return html
    .replaceAll(/<[^>]*>/gu, ' ')
    .replaceAll('&nbsp;', ' ')
    .replaceAll(/\s+/gu, ' ')
    .trim();
};

// ===== 方法数量统计：用于顶部概览展示 =====
const METHOD_ORDER = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const;

const methodStats = computed(() => {
  const counter: Record<string, number> = {};
  apis.value.forEach((api) => {
    const method = api.method?.toUpperCase() || 'GET';
    counter[method] = (counter[method] ?? 0) + 1;
  });
  return METHOD_ORDER.filter((method) => counter[method]).map((method) => ({
    method,
    count: counter[method] ?? 0,
    color: getMethodStyle(method).color,
  }));
});

// ===== 搜索 + 方法筛选 =====
const keyword = ref('');
const activeMethod = ref<string>('');

/** 方法筛选选项：全部 + 当前分组实际出现的方法 */
const methodFilters = computed(() => {
  return [
    { label: '全部', value: '' },
    ...methodStats.value.map((item) => ({
      label: item.method,
      value: item.method,
    })),
  ];
});

const filteredApis = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  return apis.value.filter((api) => {
    // 方法筛选
    if (
      activeMethod.value &&
      (api.method?.toUpperCase() || 'GET') !== activeMethod.value
    ) {
      return false;
    }
    // 关键词：匹配名称 / 路径 / 描述 / 标签
    if (kw) {
      const haystack = [
        api.summary,
        api.path,
        plainText(api.description),
        ...(api.tags ?? []),
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(kw)) {
        return false;
      }
    }
    return true;
  });
});

/** 当前筛选条件下按分组保留接口列表，避免模板中重复过滤 */
const filteredGroupSections = computed<OverviewGroupSection[]>(() => {
  const apiSet = new Set(filteredApis.value);
  return groupSections.value
    .map((section) => ({
      ...section,
      apis: section.apis.filter((api) => apiSet.has(api)),
    }))
    .filter((section) => section.apis.length > 0);
});

/** 是否处于筛选状态（用于区分「无结果」与「空分组」两种空态） */
const isFiltering = computed(
  () => Boolean(keyword.value.trim()) || Boolean(activeMethod.value),
);

/**
 * 用途：清空当前概览页的关键词和请求方法筛选条件。
 * 参数说明：无参数。
 * 返回值说明：无返回值，仅重置筛选状态。
 */
const clearFilters = () => {
  keyword.value = '';
  activeMethod.value = '';
};

/**
 * 用途：从概览列表跳转到指定接口详情页。
 * 参数说明：groupKey 为接口所属分组键，api 为需要打开的接口信息。
 * 返回值说明：无返回值，通过路由跳转更新页面。
 */
const goToApi = (groupKey: string, api: ApiInfo) => {
  const { tag } = groupInfo.value;
  router.push({
    name: `${tag}*${groupKey}*${api.operationId}`,
  });
};
</script>

<template>
  <div class="group-overview">
    <!-- 顶部：分组信息 + 方法数量统计 -->
    <header class="overview-header">
      <div class="overview-header__info">
        <div class="overview-header__title-line">
          <h2 class="overview-title">{{ overviewTitle }}</h2>
          <span class="overview-count">{{ apis.length }} 个接口</span>
        </div>
        <p class="overview-subtitle">点击任意接口查看详情</p>
      </div>

      <div v-if="methodStats.length > 0" class="overview-stats">
        <span
          v-for="item in methodStats"
          :key="item.method"
          class="overview-stat"
        >
          <i class="overview-stat__dot" :style="{ background: item.color }"></i>
          <span class="overview-stat__method">{{ item.method }}</span>
          <span class="overview-stat__count">{{ item.count }}</span>
        </span>
      </div>
    </header>

    <!-- 工具栏：搜索 + 方法筛选 -->
    <div v-if="apis.length > 0" class="overview-toolbar">
      <ElInput
        v-model="keyword"
        class="overview-search"
        placeholder="搜索接口名称、路径、描述或标签"
        clearable
      >
        <template #prefix>
          <svg
            class="overview-search__icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </template>
      </ElInput>

      <div class="overview-filters">
        <button
          v-for="filter in methodFilters"
          :key="filter.value"
          type="button"
          class="overview-filter"
          :class="{ 'overview-filter--active': activeMethod === filter.value }"
          @click="activeMethod = filter.value"
        >
          {{ filter.label }}
        </button>
      </div>
    </div>

    <!-- 接口列表 -->
    <div v-if="filteredApis.length > 0" class="overview-sections">
      <section
        v-for="section in filteredGroupSections"
        :key="section.key"
        class="overview-section"
      >
        <header
          v-if="groupSections.length > 1"
          class="overview-section__header"
        >
          <h3 class="overview-section__title">{{ section.title }}</h3>
          <span class="overview-section__count">
            {{ section.apis.length }} 个接口
          </span>
        </header>

        <ul class="api-list">
          <li
            v-for="api in section.apis"
            :key="api.operationId"
            class="api-row"
            @click="goToApi(section.key, api)"
          >
            <span
              class="api-method"
              :style="{
                backgroundColor: getMethodStyle(api.method).backgroundColor,
                color: getMethodStyle(api.method).color,
              }"
            >
              {{ api.method?.toUpperCase() }}
            </span>

            <div class="api-main">
              <div class="api-main__top">
                <span class="api-summary">{{
                  api.summary || '未命名接口'
                }}</span>
                <span v-for="tag in api.tags ?? []" :key="tag" class="api-tag">
                  {{ tag }}
                </span>
              </div>
              <div class="api-main__bottom">
                <code class="api-path">{{ api.path }}</code>
                <span v-if="plainText(api.description)" class="api-desc">
                  {{ plainText(api.description) }}
                </span>
              </div>
            </div>

            <svg
              class="api-arrow"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </li>
        </ul>
      </section>
    </div>

    <!-- 空态：搜索无结果 -->
    <ElEmpty
      v-else-if="isFiltering"
      class="overview-empty"
      description="没有找到匹配的接口"
    >
      <button type="button" class="overview-empty__btn" @click="clearFilters">
        清空筛选
      </button>
    </ElEmpty>

    <!-- 空态：分组下无接口 -->
    <ElEmpty v-else class="overview-empty" description="该分组下暂无接口" />
  </div>
</template>

<style scoped lang="scss">
@media (max-width: 900px) {
  .overview-header {
    flex-direction: column;
  }

  .overview-stats {
    justify-content: flex-start;
  }

  .api-desc {
    display: none;
  }

  .api-path {
    max-width: 60%;
  }
}

@media (max-width: 640px) {
  .group-overview {
    padding: 16px;
  }

  .overview-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .overview-search {
    max-width: none;
  }

  .api-path {
    max-width: 100%;
  }
}

.group-overview {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 20px 24px;
  overflow-y: auto;
  background: var(--el-bg-color);
}

.overview-sections {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.overview-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.overview-section__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.overview-section__title {
  font-size: 15px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.overview-section__count {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

/* ===== 头部：分组名 + 方法统计 ===== */
.overview-header {
  display: flex;
  flex: none;
  gap: 16px;
  align-items: flex-start;
  justify-content: space-between;
  padding-bottom: 16px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.overview-header__info {
  min-width: 0;
}

.overview-header__title-line {
  display: flex;
  gap: 10px;
  align-items: baseline;
}

.overview-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.overview-count {
  flex: none;
  padding: 1px 9px;
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  border-radius: 999px;
}

.overview-subtitle {
  margin: 6px 0 0;
  font-size: 12.5px;
  color: var(--el-text-color-secondary);
}

/* 方法数量统计 */
.overview-stats {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}

.overview-stat {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  padding: 3px 10px;
  font-size: 12px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
}

.overview-stat__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.overview-stat__method {
  font-family: 'JetBrains Mono', 'Fira Code', SFMono-Regular, monospace;
  font-weight: 600;
  color: var(--el-text-color-regular);
}

.overview-stat__count {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--el-text-color-primary);
}

/* ===== 工具栏：搜索 + 方法筛选 ===== */
.overview-toolbar {
  display: flex;
  flex: none;
  gap: 12px;
  align-items: center;
  margin-bottom: 14px;
}

.overview-search {
  max-width: 360px;
}

.overview-search__icon {
  width: 15px;
  height: 15px;
}

.overview-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.overview-filter {
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-regular);
  cursor: pointer;
  background: var(--el-fill-color-light);
  border: 1px solid transparent;
  border-radius: 6px;
  transition:
    color 0.15s ease,
    background-color 0.15s ease,
    border-color 0.15s ease;
}

.overview-filter:hover {
  color: var(--el-text-color-primary);
  background: var(--el-fill-color);
}

.overview-filter--active {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border-color: color-mix(in srgb, var(--el-color-primary) 30%, transparent);
}

/* ===== 接口列表：行式索引，扫描效率优先 ===== */
.api-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.api-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 10px 12px;
  cursor: pointer;
  border: 1px solid transparent;
  border-radius: 8px;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease;
}

.api-row:hover {
  background: var(--el-fill-color-light);
  border-color: var(--el-border-color-lighter);
}

/* 方法 badge：固定宽度，避免不同方法导致列表横向跳动 */
.api-method {
  box-sizing: border-box;
  flex: none;
  width: 62px;
  padding: 3px 0;
  margin-top: 1px;
  font-family: 'JetBrains Mono', 'Fira Code', SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 700;
  text-align: center;
  letter-spacing: 0.4px;
  border-radius: 6px;
}

.api-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.api-main__top {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  min-width: 0;
}

/* 接口名称：主要可读信息 */
.api-summary {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  white-space: nowrap;
}

/* 标签：小尺寸 chip */
.api-tag {
  flex: none;
  padding: 0 7px;
  font-size: 11px;
  font-weight: 500;
  line-height: 18px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color);
  border-radius: 4px;
}

.api-main__bottom {
  display: flex;
  gap: 10px;
  align-items: baseline;
  min-width: 0;
}

/* 路径：等宽字体，便于识别层级与参数段 */
.api-path {
  flex: none;
  max-width: 46%;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: 'JetBrains Mono', 'Fira Code', SFMono-Regular, monospace;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--el-text-color-regular);
  white-space: nowrap;
}

/* 描述：次级灰字 */
.api-desc {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}

.api-arrow {
  flex: none;
  width: 16px;
  height: 16px;
  margin-top: 3px;
  color: var(--el-text-color-placeholder);
  opacity: 0;
  transform: translateX(-4px);
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}

.api-row:hover .api-arrow {
  color: var(--el-color-primary);
  opacity: 1;
  transform: translateX(0);
}

/* 空态 */
.overview-empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.overview-empty__btn {
  padding: 6px 16px;
  font-size: 13px;
  font-weight: 600;
  color: var(--el-color-primary);
  cursor: pointer;
  background: var(--el-color-primary-light-9);
  border: 1px solid color-mix(in srgb, var(--el-color-primary) 30%, transparent);
  border-radius: 6px;
  transition: background-color 0.15s ease;
}

.overview-empty__btn:hover {
  background: color-mix(
    in srgb,
    var(--el-color-primary-light-9) 70%,
    var(--el-color-primary-light-7)
  );
}
</style>
