<script setup lang="ts">
import type { GlobalParamItem } from '#/store';

import { computed, ref, watch } from 'vue';

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

import { useDocManageStore } from '#/store';
import { useAggregationStore } from '#/store/aggregation';

defineOptions({ name: 'DocManageGlobalParams' });

const docManageStore = useDocManageStore();
const aggregationStore = useAggregationStore();

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

const addQueryParam = () => {
  queryParams.value.push(createParamRow());
};

const addHeaderParam = () => {
  headerParams.value.push(createParamRow());
};

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
</script>

<template>
  <div class="h-full overflow-auto p-5">
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

      <ElForm label-width="90px" class="mb-4">
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
        <ElTabPane label="全局 Query 参数">
          <ElButton class="mb-3" @click="addQueryParam">
            新增 Query 参数
          </ElButton>
          <ElTable :data="queryParams" border>
            <ElTableColumn label="启用" width="80" align="center">
              <template #default="{ row }">
                <ElSwitch v-model="row.enabled" />
              </template>
            </ElTableColumn>
            <ElTableColumn label="参数名" min-width="180">
              <template #default="{ row }">
                <ElInput v-model.trim="row.name" placeholder="例如 tenantId" />
              </template>
            </ElTableColumn>
            <ElTableColumn label="参数值" min-width="200">
              <template #default="{ row }">
                <ElInput v-model="row.value" placeholder="参数值" />
              </template>
            </ElTableColumn>
            <ElTableColumn label="说明" min-width="220">
              <template #default="{ row }">
                <ElInput v-model="row.description" placeholder="可选说明" />
              </template>
            </ElTableColumn>
            <ElTableColumn label="操作" width="100" fixed="right">
              <template #default="{ row }">
                <ElButton text type="danger" @click="removeQueryParam(row.id)">
                  删除
                </ElButton>
              </template>
            </ElTableColumn>
          </ElTable>
        </ElTabPane>

        <ElTabPane label="全局请求头参数">
          <ElButton class="mb-3" @click="addHeaderParam">
            新增 Header 参数
          </ElButton>
          <ElTable :data="headerParams" border>
            <ElTableColumn label="启用" width="80" align="center">
              <template #default="{ row }">
                <ElSwitch v-model="row.enabled" />
              </template>
            </ElTableColumn>
            <ElTableColumn label="请求头" min-width="180">
              <template #default="{ row }">
                <ElSelect
                  v-model="row.name"
                  filterable
                  allow-create
                  default-first-option
                  clearable
                  placeholder="例如 Authorization"
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
              <template #default="{ row }">
                <ElInput v-model="row.value" placeholder="Header 值" />
              </template>
            </ElTableColumn>
            <ElTableColumn label="说明" min-width="220">
              <template #default="{ row }">
                <ElInput v-model="row.description" placeholder="可选说明" />
              </template>
            </ElTableColumn>
            <ElTableColumn label="操作" width="100" fixed="right">
              <template #default="{ row }">
                <ElButton text type="danger" @click="removeHeaderParam(row.id)">
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
