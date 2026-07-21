<script setup lang="ts">
import type { SecuritySchemeObject } from '#/typings/openApi';

import { computed, onMounted, ref, watch } from 'vue';

import { useRefresh } from '@vben/hooks';
import { MdiLock, MdiMinus, MdiPlus } from '@vben/icons';

import { ElButton, ElInput } from 'element-plus';
import { storeToRefs } from 'pinia';

import { useApiStore, useTokenStore } from '#/store';
import { useAggregationStore } from '#/store/aggregation';

defineOptions({ name: 'Authorize' });

const apiStore = useApiStore();
const tokenStore = useTokenStore();
const aggregationStore = useAggregationStore();
const { isAggregation } = storeToRefs(aggregationStore);
const { refresh } = useRefresh();

// 使用 ref 而不是 computed，以便可以修改 fold 状态
const securitySchemes = ref<
  Record<string, SecuritySchemeObject & { fold?: boolean }>
>({});

const securitySchemeEntries = computed(() =>
  Object.entries(securitySchemes.value),
);

const allFolded = computed(() => {
  const entries = securitySchemeEntries.value;
  return entries.length > 0 && entries.every(([, item]) => item.fold);
});

// 监听 apiStore.openApi 变化，更新 securitySchemes
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
      Object.entries(authType).map(([key, value], index) => {
        const scheme = value as SecuritySchemeObject & { fold?: boolean };
        return [
          key,
          {
            ...value,
            fold: scheme.fold ?? index === 0,
          },
        ];
      }),
    );
  },
  { immediate: true, deep: true },
);

const value = ref(tokenStore.token);

const resolveIn = (item: SecuritySchemeObject & { fold?: boolean }) => {
  const normalized = (item.in || '').toLowerCase();
  if (
    normalized === 'cookie' ||
    normalized === 'header' ||
    normalized === 'query'
  ) {
    return normalized;
  }
  if ((item.type || '').toLowerCase() === 'http') {
    return 'header';
  }
  return 'header';
};

const tokenKey = (
  name: number | string,
  item: SecuritySchemeObject & { fold?: boolean },
) => `${name}_${resolveIn(item)}`;

const handleToken = (value: null | string, key: string) => {
  // 仅裁剪首尾空格，保留中间空格（如 "Bearer {token}" 需要的分隔空格）
  const normalized = typeof value === 'string' ? value.trim() : value;
  tokenStore.setToken(normalized, key);
  refresh();
};

const handleFold = (data: SecuritySchemeObject & { fold?: boolean }) => {
  data.fold = !data.fold;
};

const toggleAllFold = () => {
  const nextFold = !allFolded.value;
  securitySchemeEntries.value.forEach(([, item]) => {
    item.fold = nextFold;
  });
};

const tokenNumber = computed(() => {
  let num = 0;
  Object.keys(value.value).forEach((key) => {
    if (value.value[key]) num++;
  });
  return num;
});

const clearAllToken = () => {
  Object.keys(value.value).forEach((key) => {
    handleToken(null, key);
  });
};

onMounted(() => {});
</script>

<template>
  <div class="auth-page h-full overflow-y-auto px-4 py-8 sm:px-6 lg:px-8">
    <div class="auth-shell mx-auto max-w-6xl">
      <!-- 页面标题区域 -->
      <div class="auth-page__header mb-6">
        <h1 class="auth-page__title">全局认证配置</h1>
        <p class="auth-page__subtitle">
          当前认证方式由 SpringDoc 配置自动生成。
          启用全局认证后，请求将自动携带对应的认证信息，可按需配置不同类型的认证。
        </p>
      </div>

      <!-- 状态和操作区 -->
      <div
        class="auth-toolbar auth-card mb-6 flex items-center justify-between p-4"
      >
        <div class="auth-status">
          <span class="auth-status__dot"></span>
          已选择 {{ tokenNumber }} 个认证方式
        </div>
        <div class="auth-actions flex items-center gap-2">
          <ElButton
            class="text-sm transition-colors"
            plain
            type="danger"
            @click="clearAllToken"
          >
            清除全部认证
          </ElButton>
          <ElButton
            class="text-sm transition-colors"
            plain
            @click="toggleAllFold"
          >
            {{ allFolded ? '全部折叠' : '全部展开' }}
          </ElButton>
        </div>
      </div>

      <!-- 认证方式卡片网格 -->
      <div class="grid grid-cols-1 gap-4">
        <div
          class="auth-scheme-card auth-card relative cursor-pointer overflow-hidden p-4 transition-all"
          :class="{
            'auth-scheme-card--active': value[tokenKey(index, item)],
          }"
          v-for="(item, index) in securitySchemes"
          :key="index"
          @click="handleFold(item)"
        >
          <div class="flex h-full w-full items-start">
            <div class="auth-scheme-card__icon mr-4">
              <i class="text-[var(--el-color-primary)]">
                <MdiLock />
              </i>
            </div>
            <div class="flex-1">
              <div class="flex h-10 flex-col justify-between">
                <h3 class="font-medium text-[var(--el-text-color-primary)]">
                  {{ index }}（{{ item.type }}
                  {{ item.scheme ? `, ${item.scheme}` : item.scheme }}）
                </h3>
                <p class="text-sm text-[var(--el-text-color-secondary)]">
                  {{ item.description }}
                </p>
              </div>
              <div
                class="auth-scheme-card__form mt-4 space-y-2"
                v-if="item.fold"
              >
                <p
                  class="text-sm leading-relaxed text-[var(--el-text-color-regular)]"
                >
                  <span class="font-medium">{{ item.name }}</span>
                  <span class="text-[var(--el-text-color-secondary)]">
                    （字段：{{ resolveIn(item) }}）
                  </span>
                </p>
                <ElInput
                  placeholder="请输入"
                  v-model="value[tokenKey(index, item)]"
                  @click.stop=""
                  @keydown.stop=""
                  @keyup.stop=""
                />
                <div class="mt-2">
                  <ElButton
                    type="primary"
                    plain
                    @click.stop="
                      handleToken(
                        value[tokenKey(index, item)] ?? null,
                        tokenKey(index, item),
                      )
                    "
                  >
                    确定
                  </ElButton>
                  <ElButton
                    type="primary"
                    plain
                    @click.stop="handleToken(null, tokenKey(index, item))"
                  >
                    清除
                  </ElButton>
                </div>
              </div>
            </div>
            <ElButton class="auth-scheme-card__fold" circle>
              <MdiMinus v-if="item.fold" />
              <MdiPlus v-else />
            </ElButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@media (max-width: 768px) {
  .auth-page.auth-page {
    padding: 16px;
  }

  .auth-page .auth-page__header {
    padding: 20px;
  }

  .auth-page .auth-page__title {
    font-size: 24px;
  }

  .auth-page .auth-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .auth-page .auth-actions {
    justify-content: flex-start;
  }

  .auth-page .auth-scheme-card__form {
    width: 100%;
    min-width: 0;
  }
}

.auth-page {
  --auth-radius: calc(var(--radius) * 1.18);
  --auth-radius-sm: calc(var(--radius) * 0.94);
  --auth-line: var(--el-border-color-lighter);
  --auth-panel: var(--el-bg-color);
  --auth-shadow-sm:
    0 1px 2px color-mix(in srgb, var(--el-text-color-primary) 6%, transparent),
    0 2px 8px color-mix(in srgb, var(--el-text-color-primary) 5%, transparent);
  --auth-shadow-md:
    0 4px 14px color-mix(in srgb, var(--el-text-color-primary) 8%, transparent),
    0 10px 30px color-mix(in srgb, var(--el-text-color-primary) 7%, transparent);

  color: var(--el-text-color-primary);
  background: var(--el-fill-color-light);
}

.auth-shell {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.auth-page__header {
  padding: 24px 28px;
  background: linear-gradient(
    135deg,
    var(--auth-panel) 0%,
    color-mix(in srgb, var(--el-color-primary-light-9) 58%, var(--auth-panel))
      100%
  );
  border: 1px solid var(--auth-line);
  border-radius: var(--auth-radius);
  box-shadow: var(--auth-shadow-sm);
}

.auth-page__title {
  margin: 0;
  font-size: 28px;
  font-weight: 800;
  line-height: 1.25;
  color: var(--el-text-color-primary);
}

.auth-page__subtitle {
  max-width: 820px;
  margin: 10px 0 0;
  font-size: 13px;
  line-height: 1.8;
  color: var(--el-text-color-secondary);
}

.auth-toolbar {
  gap: 12px;
  background: var(--auth-panel);
  border: 1px solid var(--auth-line);
}

.auth-status {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-regular);
}

.auth-status__dot {
  width: 8px;
  height: 8px;
  background: var(--el-color-success);
  border-radius: 50%;
  box-shadow: 0 0 0 4px
    color-mix(in srgb, var(--el-color-success) 12%, transparent);
}

.auth-actions {
  flex-wrap: wrap;
  justify-content: flex-end;
}

/* 卡片观感与首页保持一致：更大的圆角、柔和边框与悬浮阴影 */
.auth-card {
  border-radius: var(--auth-radius);
  box-shadow: var(--auth-shadow-sm);
  transition:
    box-shadow 0.18s ease,
    border-color 0.18s ease;
}

.auth-card:hover {
  border-color: color-mix(in srgb, var(--el-color-primary) 25%, transparent);
  box-shadow: var(--auth-shadow-md);
}

.auth-scheme-card {
  color: var(--el-text-color-primary);
  background: var(--auth-panel);
  border: 1px solid var(--auth-line);
}

.auth-scheme-card--active {
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--el-color-primary-light-9) 72%, var(--auth-panel))
      0%,
    var(--auth-panel) 100%
  );
  border-color: color-mix(in srgb, var(--el-color-primary) 38%, transparent);
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--el-color-primary) 12%, transparent),
    var(--auth-shadow-sm);
}

.auth-scheme-card__icon {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  background: var(--el-color-primary-light-9);
  border: 1px solid color-mix(in srgb, var(--el-color-primary) 12%, transparent);
  border-radius: var(--auth-radius-sm);
}

.auth-scheme-card__icon :deep(svg) {
  width: 20px;
  height: 20px;
}

.auth-scheme-card__form {
  width: min(560px, 55%);
  min-width: 320px;
}

.auth-scheme-card__fold {
  flex: none;
  color: var(--el-text-color-secondary);
  border-color: var(--auth-line);
}

.auth-scheme-card:hover .auth-scheme-card__fold {
  color: var(--el-color-primary);
  border-color: color-mix(in srgb, var(--el-color-primary) 30%, transparent);
}
</style>
