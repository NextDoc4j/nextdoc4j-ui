<script setup lang="ts">
import type { GlobalParamItem } from '#/store';

import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import { useAccessStore } from '@vben/stores';

import {
  ElAlert,
  ElButton,
  ElCard,
  ElForm,
  ElFormItem,
  ElInput,
  ElMessage,
  ElOption,
  ElSelect,
  ElSpace,
  ElSwitch,
  ElTable,
  ElTableColumn,
  ElTabPane,
  ElTabs,
} from 'element-plus';
import { storeToRefs } from 'pinia';

import { generateAccess } from '#/router/access';
import { accessRoutes } from '#/router/routes';
import { useApiTestCacheStore, useDocManageStore } from '#/store';
import { useAggregationStore } from '#/store/aggregation';

defineOptions({ name: 'DocManageGlobalParams' });

const docManageStore = useDocManageStore();
const apiTestCacheStore = useApiTestCacheStore();
const aggregationStore = useAggregationStore();
const accessStore = useAccessStore();
const router = useRouter();

const { debugCacheEnabled, groupOverviewEnabled } =
  storeToRefs(apiTestCacheStore);
const { currentService, isAggregation, services } =
  storeToRefs(aggregationStore);

const activeScope = ref(docManageStore.ALL_SCOPE_KEY);
const queryParams = ref<GlobalParamItem[]>([]);
const headerParams = ref<GlobalParamItem[]>([]);
const commonHeaderNameOptions = [
  'Accept',
  'Accept-Charset',
  'Accept-Encoding',
  'Accept-Language',
  'Access-Control-Request-Headers',
  'Access-Control-Request-Method',
  'If-Range',
  'If-Unmodified-Since',
  'Keep-Alive',
  'Max-Forwards',
  'Origin',
  'Pragma',
];

const scopeOptions = computed(() => {
  const options = [
    {
      label: '全部文档（全局）',
      value: docManageStore.ALL_SCOPE_KEY,
    },
  ];

  if (isAggregation.value) {
    services.value.forEach((service) => {
      options.push({
        label: `服务：${service.name}`,
        value: docManageStore.toScopeKey(service.url),
      });
    });
  }

  return options;
});

const currentServiceScopeKey = computed(() => {
  return docManageStore.toScopeKey(currentService.value?.url);
});

const mergedActiveQueryCount = computed(() => {
  return docManageStore
    .getMergedQueryParams(currentService.value?.url)
    .filter((item) => item.enabled && item.name).length;
});

const mergedActiveHeaderCount = computed(() => {
  return docManageStore
    .getMergedHeaderParams(currentService.value?.url)
    .filter((item) => item.enabled && item.name).length;
});

const createParamRow = (): GlobalParamItem => ({
  id: Math.random().toString(36).slice(2, 10),
  enabled: true,
  name: '',
  value: '',
  description: '',
});

const loadScope = (scopeKey: string) => {
  const data = docManageStore.getScopeParams(scopeKey);
  queryParams.value = data.queryParams;
  headerParams.value = data.headerParams;
};

watch(
  scopeOptions,
  (options) => {
    if (!options.some((item) => item.value === activeScope.value)) {
      activeScope.value = docManageStore.ALL_SCOPE_KEY;
    }
  },
  { immediate: true },
);

watch(
  activeScope,
  (scopeKey) => {
    loadScope(scopeKey);
  },
  { immediate: true },
);

const persistCurrentScope = () => {
  docManageStore.setScopeParams(activeScope.value, {
    queryParams: queryParams.value,
    headerParams: headerParams.value,
  });
};

watch(
  [queryParams, headerParams],
  () => {
    persistCurrentScope();
  },
  { deep: true },
);

const resetScope = () => {
  queryParams.value = [];
  headerParams.value = [];
};

// 末尾草稿行：替代「添加参数」按钮，用户在末尾空白行任意填写即自动新增正式行。
const queryDraft = ref<GlobalParamItem>(createParamRow());
const headerDraft = ref<GlobalParamItem>(createParamRow());

/** 将草稿行提交为正式行，并重置草稿行以便继续录入 */
function commitDraft(
  draft: GlobalParamItem,
  list: GlobalParamItem[],
): GlobalParamItem {
  if (draft.name?.trim() || `${draft.value ?? ''}`.trim()) {
    list.push({ ...draft });
    return createParamRow();
  }
  return draft;
}

watch(
  queryDraft,
  (draft) => {
    queryDraft.value = commitDraft(draft, queryParams.value);
  },
  { deep: true },
);

watch(
  headerDraft,
  (draft) => {
    headerDraft.value = commitDraft(draft, headerParams.value);
  },
  { deep: true },
);

const removeQueryParam = (id: string) => {
  queryParams.value = queryParams.value.filter((item) => item.id !== id);
};

const removeHeaderParam = (id: string) => {
  headerParams.value = headerParams.value.filter((item) => item.id !== id);
};

const applyCurrentServiceTemplate = () => {
  if (!currentService.value?.url) {
    ElMessage.warning('当前不是聚合模式或未选择服务');
    return;
  }

  activeScope.value = currentServiceScopeKey.value;
};

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

watch(groupOverviewEnabled, async (enabled) => {
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
  await refreshDocumentRoutes(targetPath);
});
</script>

<template>
  <div class="h-full overflow-auto p-5">
    <ElCard shadow="never" class="mb-4">
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

      <ElForm label-width="110px" class="debug-switch-form">
        <ElFormItem label="调试缓存开关" class="debug-switch-form__item">
          <ElSwitch
            v-model="debugCacheEnabled"
            active-text="开启"
            inactive-text="关闭"
            inline-prompt
          />
        </ElFormItem>
        <ElFormItem label="分组概览" class="debug-switch-form__item">
          <ElSwitch
            v-model="groupOverviewEnabled"
            active-text="开启"
            inactive-text="关闭"
            inline-prompt
          />
        </ElFormItem>
      </ElForm>
    </ElCard>

    <ElCard shadow="never">
      <template #header>
        <div class="flex items-center justify-between">
          <span class="font-medium">全局参数配置</span>
          <ElSpace>
            <ElButton v-if="isAggregation" @click="applyCurrentServiceTemplate">
              切换到当前服务作用域
            </ElButton>
            <ElButton @click="resetScope">清空当前作用域</ElButton>
          </ElSpace>
        </div>
      </template>

      <ElAlert class="mb-4" type="info" show-icon :closable="false">
        <template #default>
          调试请求会自动注入全局参数。若调试页填写了同名参数，调试页参数优先。
          当前为实时生效，无需手动保存。 当前有效注入：Query
          {{ mergedActiveQueryCount }} 项，Header
          {{ mergedActiveHeaderCount }} 项。
        </template>
      </ElAlert>

      <ElForm label-width="90px" class="mb-4 mt-2">
        <ElFormItem label="作用域">
          <ElSelect v-model="activeScope" style="width: 360px">
            <ElOption
              v-for="item in scopeOptions"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </ElSelect>
        </ElFormItem>
      </ElForm>

      <ElTabs>
        <ElTabPane label="全局请求头参数">
          <ElTable :data="[...headerParams, headerDraft]" border>
            <ElTableColumn label="启用" width="80" align="center">
              <template #default="{ row, $index }">
                <ElSwitch
                  v-model="row.enabled"
                  :disabled="$index === headerParams.length"
                />
              </template>
            </ElTableColumn>
            <ElTableColumn label="请求头" min-width="180">
              <template #default="{ row, $index }">
                <ElSelect
                  v-model="row.name"
                  filterable
                  allow-create
                  default-first-option
                  clearable
                  :placeholder="
                    $index === headerParams.length
                      ? '添加请求头'
                      : '例如 Authorization'
                  "
                >
                  <ElOption
                    v-for="name in commonHeaderNameOptions"
                    :key="name"
                    :label="name"
                    :value="name"
                  />
                </ElSelect>
              </template>
            </ElTableColumn>
            <ElTableColumn label="值" min-width="260">
              <template #default="{ row, $index }">
                <ElInput
                  v-model="row.value"
                  :placeholder="
                    $index === headerParams.length
                      ? '添加 Header 值'
                      : 'Header 值'
                  "
                />
              </template>
            </ElTableColumn>
            <ElTableColumn label="说明" min-width="220">
              <template #default="{ row }">
                <ElInput v-model="row.description" placeholder="可选说明" />
              </template>
            </ElTableColumn>
            <ElTableColumn label="操作" width="100" fixed="right">
              <template #default="{ row, $index }">
                <ElButton
                  v-if="$index < headerParams.length"
                  text
                  type="danger"
                  @click="removeHeaderParam(row.id)"
                >
                  删除
                </ElButton>
              </template>
            </ElTableColumn>
          </ElTable>
        </ElTabPane>

        <ElTabPane label="全局 Query 参数">
          <ElTable :data="[...queryParams, queryDraft]" border>
            <ElTableColumn label="启用" width="80" align="center">
              <template #default="{ row, $index }">
                <ElSwitch
                  v-model="row.enabled"
                  :disabled="$index === queryParams.length"
                />
              </template>
            </ElTableColumn>
            <ElTableColumn label="参数名" min-width="180">
              <template #default="{ row, $index }">
                <ElInput
                  v-model.trim="row.name"
                  :placeholder="
                    $index === queryParams.length
                      ? '添加参数名'
                      : '例如 tenantId'
                  "
                />
              </template>
            </ElTableColumn>
            <ElTableColumn label="参数值" min-width="200">
              <template #default="{ row, $index }">
                <ElInput
                  v-model="row.value"
                  :placeholder="
                    $index === queryParams.length ? '添加参数值' : '参数值'
                  "
                />
              </template>
            </ElTableColumn>
            <ElTableColumn label="说明" min-width="220">
              <template #default="{ row }">
                <ElInput v-model="row.description" placeholder="可选说明" />
              </template>
            </ElTableColumn>
            <ElTableColumn label="操作" width="100" fixed="right">
              <template #default="{ row, $index }">
                <ElButton
                  v-if="$index < queryParams.length"
                  text
                  type="danger"
                  @click="removeQueryParam(row.id)"
                >
                  删除
                </ElButton>
              </template>
            </ElTableColumn>
          </ElTable>
        </ElTabPane>
      </ElTabs>
    </ElCard>
  </div>
</template>

<style scoped>
/* 调试缓存 / 分组概览 两开关同行各占 1/2，样式沿用 ElFormItem 默认，不引入新样式 */
.debug-switch-form {
  display: flex;
}

.debug-switch-form__item {
  flex: 1;
  margin-bottom: 0;
}

:deep(.el-table__row:last-child) {
  background: color-mix(in srgb, var(--el-fill-color-light) 50%, transparent);
}

:deep(.el-table__row:last-child .el-input__inner::placeholder) {
  color: var(--el-text-color-placeholder);
}
</style>
