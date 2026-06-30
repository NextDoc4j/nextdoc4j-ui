<script setup lang="ts">
import type { SecuritySchemeObject } from '#/typings/openApi';

import { computed, ref, watch } from 'vue';

import { useRefresh } from '@vben/hooks';
import { MdiLock } from '@vben/icons';

import { ElAlert, ElButton, ElEmpty, ElInput } from 'element-plus';
import { storeToRefs } from 'pinia';

import { useApiStore, useTokenStore } from '#/store';
import { useAggregationStore } from '#/store/aggregation';

import GlobalParamsConfig from './global-params-config.vue';

defineOptions({ name: 'GlobalConfigPanel' });

const props = defineProps<{
  paramsTableMaxHeight?: number | string;
}>();

const apiStore = useApiStore();
const tokenStore = useTokenStore();
const aggregationStore = useAggregationStore();

const { isAggregation } = storeToRefs(aggregationStore);
const { refresh } = useRefresh();

// 左侧菜单激活项：'params' 或 'auth'
const activeMenu = ref<'auth' | 'params'>('params');

// ===== 右侧：全局认证（与全局认证页共用 tokenStore 数据） =====
const securitySchemes = ref<
  Record<string, SecuritySchemeObject & { fold?: boolean }>
>({});

watch(
  () => [
    apiStore.openApi,
    aggregationStore.mainConfigCache.openApi,
    isAggregation.value,
  ],
  () => {
    const gatewaySchemes =
      aggregationStore.mainConfigCache.openApi?.components?.securitySchemes ??
      {};
    const serviceSchemes = apiStore.openApi?.components?.securitySchemes ?? {};
    const authType = isAggregation.value ? gatewaySchemes : serviceSchemes;
    securitySchemes.value = Object.fromEntries(
      Object.entries(authType).map(([key, value]) => [
        key,
        {
          ...value,
          fold:
            (value as SecuritySchemeObject & { fold?: boolean }).fold ?? false,
        },
      ]),
    );
  },
  { immediate: true, deep: true },
);

const tokenValue = ref(tokenStore.token);

const resolveIn = (item: SecuritySchemeObject) => {
  const normalized = (item.in || '').toLowerCase();
  if (
    normalized === 'cookie' ||
    normalized === 'header' ||
    normalized === 'query'
  ) {
    return normalized;
  }
  return 'header';
};

const tokenKey = (name: number | string, item: SecuritySchemeObject) =>
  `${name}_${resolveIn(item)}`;

const handleToken = (value: null | string, key: string) => {
  tokenStore.setToken(value, key);
  refresh();
};

const hasSecurity = computed(
  () => Object.keys(securitySchemes.value).length > 0,
);
</script>

<template>
  <div class="global-config-panel">
    <!-- 左侧菜单 -->
    <aside class="gcp-aside">
      <button
        type="button"
        class="gcp-menu-item"
        :class="{ 'gcp-menu-item--active': activeMenu === 'params' }"
        @click="activeMenu = 'params'"
      >
        全局参数
      </button>
      <button
        type="button"
        class="gcp-menu-item"
        :class="{ 'gcp-menu-item--active': activeMenu === 'auth' }"
        @click="activeMenu = 'auth'"
      >
        全局认证
      </button>
    </aside>

    <!-- 右侧内容区 -->
    <section class="gcp-content">
      <!-- 全局参数配置：复用文档管理-全局配置的「全局参数」组件 -->
      <div
        v-show="activeMenu === 'params'"
        class="gcp-section gcp-section--params"
      >
        <GlobalParamsConfig :table-max-height="props.paramsTableMaxHeight" />
      </div>

      <!-- 全局认证配置 -->
      <div v-show="activeMenu === 'auth'" class="gcp-section">
        <header class="gcp-section__head">
          <h3 class="gcp-section__title">全局认证</h3>
        </header>

        <ElAlert type="info" :closable="false" class="gcp-tip">
          认证方式由 SpringDoc 自动生成，填写后请求将自动携带对应认证信息。
        </ElAlert>

        <div v-if="hasSecurity" class="gcp-auth-list">
          <div
            v-for="(item, index) in securitySchemes"
            :key="index"
            class="gcp-auth-card"
          >
            <div class="gcp-auth-card__head">
              <span class="gcp-auth-card__icon"><MdiLock /></span>
              <div class="gcp-auth-card__meta">
                <span class="gcp-auth-card__name">{{ index }}</span>
                <span class="gcp-auth-card__type">
                  {{ item.type }}{{ item.scheme ? ` · ${item.scheme}` : '' }} ·
                  {{ resolveIn(item) }}
                </span>
              </div>
            </div>
            <div class="gcp-auth-card__body">
              <ElInput
                v-model.trim="tokenValue[tokenKey(index, item)]"
                placeholder="请输入认证信息"
              />
              <div class="gcp-auth-card__actions">
                <ElButton
                  type="primary"
                  plain
                  size="small"
                  @click="
                    handleToken(
                      tokenValue[tokenKey(index, item)] ?? null,
                      tokenKey(index, item),
                    )
                  "
                >
                  确定
                </ElButton>
                <ElButton
                  plain
                  size="small"
                  @click="handleToken(null, tokenKey(index, item))"
                >
                  清除
                </ElButton>
              </div>
            </div>
          </div>
        </div>
        <ElEmpty v-else description="当前文档无认证配置" :image-size="80" />
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
@media (max-width: 768px) {
  .global-config-panel {
    grid-template-rows: auto minmax(0, 1fr);
    grid-template-columns: minmax(0, 1fr);
  }

  .gcp-aside {
    flex-direction: row;
    overflow-x: auto;
  }
}

.global-config-panel {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  gap: 16px;
  height: 100%;
  min-height: 0;
}

/* 左侧菜单 */
.gcp-aside {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: calc(var(--radius) * 1.18);
}

.gcp-menu-item {
  display: flex;
  align-items: center;
  height: 40px;
  padding: 0 14px;
  font-size: 14px;
  font-weight: 500;
  color: var(--el-text-color-regular);
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: calc(var(--radius) * 0.82);
  transition: all 0.2s ease;
}

.gcp-menu-item:hover {
  color: var(--el-text-color-primary);
  background: var(--el-fill-color-light);
}

.gcp-menu-item--active {
  font-weight: 600;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

/* 右侧内容区 */
.gcp-content {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.gcp-section {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  min-height: 0;
  padding: 14px;

  /* section 撑满固定高度（flex:1）：头部/作用域/提示固定，滚动交给内部列表区 */
  overflow: hidden;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: calc(var(--radius) * 1.18);
}

.gcp-section__head {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
}

.gcp-section__title {
  font-size: 14px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

/* 全局参数区：去除 section 内边距/边框，由复用卡片自带样式承载，超出时整体滚动 */
.gcp-section--params {
  gap: 0;
  padding: 0;
  overflow-y: auto;
  background: transparent;
  border: none;
}

.gcp-tip {
  --el-alert-padding: 8px 10px;

  font-size: 12px;
  border-radius: calc(var(--radius) * 0.72);
}

.gcp-tip :deep(.el-alert__description) {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}

.gcp-auth-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow-y: auto;
}

.gcp-auth-card {
  padding: 12px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: calc(var(--radius) * 0.94);
}

.gcp-auth-card__head {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 10px;
}

.gcp-auth-card__icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 30px;
  height: 30px;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border-radius: calc(var(--radius) * 0.72);
}

.gcp-auth-card__meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.gcp-auth-card__name {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.gcp-auth-card__type {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.gcp-auth-card__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 认证输入框占满卡片宽度，与全局参数区输入宽度保持一致 */
.gcp-auth-card__body :deep(.el-input) {
  width: 100%;
}

.gcp-auth-card__actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>
