<script setup lang="ts">
import type { SecuritySchemeObject } from '#/typings/openApi';

import { computed, onMounted, ref } from 'vue';

import { useRefresh } from '@vben/hooks';
import { MdiLock, MdiMinus, MdiPlus } from '@vben/icons';

import { ElButton, ElInput } from 'element-plus';

import { useApiStore, useTokenStore } from '#/store';

defineOptions({ name: 'Authorize' });

const apiStore = useApiStore();
const tokenStore = useTokenStore();
const { refresh } = useRefresh();

const securitySchemes = computed(() => {
  const authType = apiStore.openApi?.components?.securitySchemes ?? {};
  return Object.fromEntries(
    Object.entries(authType).map(([key, value]) => [
      key,
      {
        ...value,
        fold: (value as SecuritySchemeObject & { fold?: boolean }).fold ?? true,
      },
    ]),
  );
});
const value = ref(tokenStore.token);

const resolveIn = (item: SecuritySchemeObject & { fold?: boolean }) => {
  if (item.in) {
    return item.in;
  }
  if (item.type === 'http') {
    return 'header';
  }
  return 'header';
};

const tokenKey = (
  name: number | string,
  item: SecuritySchemeObject & { fold?: boolean },
) => `${name}_${resolveIn(item)}`;

const handleToken = (value: null | string, key: string) => {
  tokenStore.setToken(value, key);
  refresh();
};

const handleFold = (data: SecuritySchemeObject & { fold?: boolean }) => {
  data.fold = !data.fold;
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
  <div
    class="h-full overflow-y-auto px-4 py-8 sm:px-6 lg:px-8"
    style="
      color: var(--el-text-color-primary);
      background-color: var(--el-bg-color);
    "
  >
    <div class="mx-auto max-w-6xl">
      <!-- 页面标题区域 -->
      <div class="mb-8">
        <h1 class="mb-2 text-2xl font-bold text-[var(--el-text-color-primary)]">
          全局认证配置
        </h1>
        <p class="text-[var(--el-text-color-secondary)]">
          当前认证方式由 SpringDoc 配置自动生成。
          启用全局认证后，请求将自动携带对应的认证信息，可按需配置不同类型的认证。
        </p>
      </div>

      <!-- 状态和操作区 -->
      <div
        class="mb-6 flex items-center justify-between rounded-lg p-4 shadow-sm"
        style="
          background-color: var(--el-bg-color-overlay);
          border: 1px solid var(--el-border-color);
        "
      >
        <div
          class="flex items-center text-sm text-[var(--el-text-color-regular)]"
        >
          <span
            class="mr-2 h-2 w-2 rounded-full bg-[var(--el-color-success)]"
          ></span>
          已选择 {{ tokenNumber }} 个认证方式
        </div>
        <ElButton
          class="text-sm transition-colors"
          plain
          type="danger"
          @click="clearAllToken"
        >
          清除全部认证
        </ElButton>
      </div>

      <!-- 认证方式卡片网格 -->
      <div class="grid grid-cols-1 gap-4">
        <div
          class="relative cursor-pointer overflow-hidden rounded-lg border-2 p-4 shadow-sm transition-all hover:shadow-md"
          :class="[
            value[tokenKey(index, item)]
              ? 'border-[var(--el-color-primary-light-5)]'
              : 'border-[var(--el-border-color)]',
          ]"
          style="
            color: var(--el-text-color-primary);
            background-color: var(--el-bg-color-overlay);
          "
          v-for="(item, index) in securitySchemes"
          :key="index"
          @click="handleFold(item)"
        >
          <div class="flex h-full w-full items-start">
            <div
              class="mr-4 flex h-10 w-10 items-center justify-center rounded-lg"
              style="background-color: var(--el-color-primary-light-9)"
            >
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
              <div class="mt-4 w-[55%] space-y-2" v-if="item.fold">
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
                  v-model.trim="value[tokenKey(index, item)]"
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
            <ElButton circle>
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
/* 可以添加额外的样式 */
</style>
