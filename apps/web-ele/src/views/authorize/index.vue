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
  Object.entries(authType).map(([key]) => {
    return {
      ...authType[key],
      fold: true,
    };
  });
  return authType;
});
const value = ref(tokenStore.token);

const handleToken = (value: null | string, key: string) => {
  tokenStore.setToken(value, key);
  refresh();
};

const handleFold = (data: SecuritySchemeObject & { fold: boolean }) => {
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
  <div class="h-full overflow-y-auto bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
    <div class="mx-auto max-w-6xl">
      <!-- 页面标题区域 -->
      <div class="mb-8">
        <h1 class="mb-2 text-2xl font-bold text-gray-900">全局认证配置</h1>
        <p class="text-gray-500">
          配置全局认证后，所有 API
          请求将自动携带对应的认证信息，支持同时配置多种认证方式，适用于不同的接口场景。
        </p>
      </div>

      <!-- 状态和操作区 -->
      <div
        class="mb-6 flex items-center justify-between rounded-lg bg-white p-4 shadow-sm"
      >
        <div class="flex items-center text-sm text-gray-500">
          <span class="mr-2 h-2 w-2 rounded-full bg-green-500"></span>
          已选择 {{ tokenNumber }} 个认证方式
        </div>
        <ElButton
          class="text-sm text-gray-500 transition-colors hover:text-red-500"
          @click="clearAllToken"
        >
          清除全部认证
        </ElButton>
      </div>

      <!-- 认证方式卡片网格 -->
      <div class="grid grid-cols-1 gap-4">
        <div
          class="relative cursor-pointer overflow-hidden rounded-lg border-2 bg-white p-4 shadow-sm transition-all hover:shadow-md"
          :class="[
            value[`${index}_${item.in}`]
              ? 'border-[--el-color-primary-light-5]'
              : '',
          ]"
          v-for="(item, index) in securitySchemes"
          :key="index"
          @click="handleFold(item)"
        >
          <div class="flex h-full w-full items-start">
            <div
              class="mr-4 flex h-10 w-10 items-center justify-center rounded-lg bg-[--el-color-primary-light-9]"
            >
              <i class="text-[--el-color-primary]">
                <MdiLock />
              </i>
            </div>
            <div class="flex-1">
              <div class="flex h-10 flex-col justify-between">
                <h3 class="font-medium text-gray-900">
                  {{ index }}（{{ item.type }}
                  {{ item.scheme ? `, ${item.scheme}` : item.scheme }}）
                </h3>
                <p class="text-sm text-gray-500">{{ item.description }}</p>
              </div>
              <div class="mt-2 w-[50%]" v-if="item.fold">
                <ElInput
                  placeholder="请输入"
                  v-model.trim="value[`${index}_${item.in}`]"
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
                        value[`${index}_${item.in}`] ?? null,
                        `${index}_${item.in}`,
                      )
                    "
                  >
                    确定
                  </ElButton>
                  <ElButton
                    type="primary"
                    plain
                    @click.stop="handleToken(null, `${index}_${item.in}`)"
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
