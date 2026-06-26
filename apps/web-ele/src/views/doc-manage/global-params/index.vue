<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue';
import { useRouter } from 'vue-router';

import { useAccessStore } from '@vben/stores';

import {
  ElAlert,
  ElButton,
  ElCard,
  ElForm,
  ElFormItem,
  ElMessage,
  ElSpace,
  ElSwitch,
} from 'element-plus';
import { storeToRefs } from 'pinia';

import GlobalParamsConfig from '#/components/global-params-config.vue';
import { generateAccess } from '#/router/access';
import { accessRoutes } from '#/router/routes';
import { useApiTestCacheStore } from '#/store';

defineOptions({ name: 'DocManageGlobalParams' });

const apiTestCacheStore = useApiTestCacheStore();
const accessStore = useAccessStore();
const router = useRouter();

const { debugCacheEnabled, groupOverviewEnabled } =
  storeToRefs(apiTestCacheStore);

const clearAllDebugRequestCache = () => {
  apiTestCacheStore.clearAllRequestCache();
  ElMessage.success('已清理全部调试缓存');
};

/**
 * 用途：刷新接口文档菜单和动态路由，使分组概览开关切换后立即生效。
 * 参数说明：targetPath 为刷新完成后需要跳转的目标路径，未传入时保持当前路由。
 * 返回值说明：无返回值，刷新失败时仅提示错误并保留当前页面状态。
 */
const refreshDocumentRoutes = async (targetPath?: string) => {
  try {
    const { accessibleMenus, accessibleRoutes } = await generateAccess({
      roles: [],
      router,
      routes: accessRoutes,
    });

    accessStore.setAccessMenus(accessibleMenus);
    accessStore.setAccessRoutes(accessibleRoutes);
    accessStore.setIsAccessChecked(true);

    if (targetPath) {
      await router.replace(targetPath);
    }
  } catch (error) {
    console.error('Failed to refresh document routes:', error);
    ElMessage.error('刷新文档菜单失败');
  }
};

// 开关切换到路由重建之间的延迟：路由重建会同步遍历全部接口生成菜单与搜索索引，
// 与开关切换同帧执行会阻塞主线程导致开关动画卡顿，故延迟到过渡动画(~300ms)结束后再执行。
const ROUTE_REFRESH_DELAY = 320;
let refreshRoutesTimer: null | ReturnType<typeof setTimeout> = null;

watch(groupOverviewEnabled, (enabled) => {
  const routeName = router.currentRoute.value.name;
  const activePath = router.currentRoute.value.meta.activePath as
    | string
    | undefined;
  const targetPath =
    !enabled &&
    typeof routeName === 'string' &&
    routeName.endsWith('__overview__')
      ? activePath
      : undefined;
  if (refreshRoutesTimer) {
    clearTimeout(refreshRoutesTimer);
  }
  refreshRoutesTimer = setTimeout(() => {
    refreshRoutesTimer = null;
    void refreshDocumentRoutes(targetPath);
  }, ROUTE_REFRESH_DELAY);
});

onBeforeUnmount(() => {
  if (refreshRoutesTimer) {
    clearTimeout(refreshRoutesTimer);
    refreshRoutesTimer = null;
  }
});
</script>

<template>
  <div class="h-full overflow-auto p-5">
    <!-- 全局调试缓存 与 分组概览 两张卡片并列，各占一半宽度 -->
    <div class="config-card-row mb-4">
      <ElCard shadow="never" class="config-card">
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-medium">全局调试缓存</span>
            <ElSpace>
              <ElButton text type="danger" @click="clearAllDebugRequestCache">
                清理全部缓存
              </ElButton>
            </ElSpace>
          </div>
        </template>

        <ElAlert class="mb-4" type="info" show-icon :closable="false">
          <template #default>
            开启后会缓存在线调试的请求数据（刷新页面后仍保留）。关闭后回到当前默认行为，不读取也不写入调试缓存。
          </template>
        </ElAlert>

        <ElForm label-width="110px">
          <ElFormItem label="调试缓存开关" class="config-switch-item">
            <ElSwitch
              v-model="debugCacheEnabled"
              active-text="开启"
              inactive-text="关闭"
              inline-prompt
            />
          </ElFormItem>
        </ElForm>
      </ElCard>

      <ElCard shadow="never" class="config-card">
        <template #header>
          <span class="font-medium">分组概览</span>
        </template>

        <ElAlert class="mb-4" type="info" show-icon :closable="false">
          <template #default>
            开启后，点击左侧菜单的接口分组会在右侧展示该分组下全部接口的概览页；关闭后点击分组仅展开或收起子菜单，需点击具体接口才进入对应详情。
          </template>
        </ElAlert>

        <ElForm label-width="110px">
          <ElFormItem label="分组概览" class="config-switch-item">
            <ElSwitch
              v-model="groupOverviewEnabled"
              active-text="开启"
              inactive-text="关闭"
              inline-prompt
            />
          </ElFormItem>
        </ElForm>
      </ElCard>
    </div>

    <GlobalParamsConfig />
  </div>
</template>

<style scoped>
/* 卡片观感与首页保持一致：更大的圆角、柔和边框与悬浮阴影 */
.config-card {
  --config-radius: calc(var(--radius) * 2.25);

  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--config-radius);
  box-shadow:
    0 1px 2px color-mix(in srgb, var(--el-text-color-primary) 6%, transparent),
    0 2px 8px color-mix(in srgb, var(--el-text-color-primary) 5%, transparent);
  transition:
    box-shadow 0.18s ease,
    border-color 0.18s ease;
}

.config-card:hover {
  border-color: color-mix(in srgb, var(--el-color-primary) 25%, transparent);
  box-shadow:
    0 4px 14px color-mix(in srgb, var(--el-text-color-primary) 8%, transparent),
    0 10px 30px color-mix(in srgb, var(--el-text-color-primary) 7%, transparent);
}

/* 全局调试缓存 / 分组概览 两卡片并列，各占一半 */
.config-card-row {
  display: flex;
  gap: 16px;
}

.config-card-row .config-card {
  flex: 1;
  min-width: 0;
}

.config-switch-item {
  margin-bottom: 0;
}
</style>
