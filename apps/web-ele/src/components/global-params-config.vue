<script setup lang="ts">
import type { GlobalParamItem } from '#/store';

import { computed, nextTick, ref, watch } from 'vue';

import {
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
  ElTooltip,
} from 'element-plus';
import { storeToRefs } from 'pinia';

import { useDocManageStore } from '#/store';
import { useAggregationStore } from '#/store/aggregation';

defineOptions({ name: 'GlobalParamsConfig' });

const props = defineProps<{
  tableMaxHeight?: number | string;
}>();

const docManageStore = useDocManageStore();
const aggregationStore = useAggregationStore();

const { currentService, isAggregation, services } =
  storeToRefs(aggregationStore);

const activeScope = ref(docManageStore.ALL_SCOPE_KEY);
const configCardRef = ref<unknown>(null);
const queryParams = ref<GlobalParamItem[]>([]);
const headerParams = ref<GlobalParamItem[]>([]);
type GlobalParamField = 'description' | 'name' | 'value';
type GlobalParamKind = 'header' | 'query';
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

const normalizeHeaderName = (name: string) => name.trim().toLowerCase();

const activeQueryParams = computed(() => {
  const map = new Map<string, GlobalParamItem>();
  const allScopeData =
    activeScope.value === docManageStore.ALL_SCOPE_KEY
      ? { queryParams: queryParams.value }
      : docManageStore.getScopeParams(docManageStore.ALL_SCOPE_KEY);
  allScopeData.queryParams.forEach((item) => {
    if (!item.name) return;
    map.set(item.name, item);
  });

  if (activeScope.value === currentServiceScopeKey.value) {
    queryParams.value.forEach((item) => {
      if (!item.name) return;
      map.set(item.name, item);
    });
  } else if (currentService.value?.url) {
    docManageStore
      .getScopeParams(currentServiceScopeKey.value)
      .queryParams.forEach((item) => {
        if (!item.name) return;
        map.set(item.name, item);
      });
  }

  return [...map.values()];
});

const activeHeaderParams = computed(() => {
  const map = new Map<string, GlobalParamItem>();
  const allScopeData =
    activeScope.value === docManageStore.ALL_SCOPE_KEY
      ? { headerParams: headerParams.value }
      : docManageStore.getScopeParams(docManageStore.ALL_SCOPE_KEY);
  allScopeData.headerParams.forEach((item) => {
    if (!item.name) return;
    map.set(normalizeHeaderName(item.name), item);
  });

  if (activeScope.value === currentServiceScopeKey.value) {
    headerParams.value.forEach((item) => {
      if (!item.name) return;
      map.set(normalizeHeaderName(item.name), item);
    });
  } else if (currentService.value?.url) {
    docManageStore
      .getScopeParams(currentServiceScopeKey.value)
      .headerParams.forEach((item) => {
        if (!item.name) return;
        map.set(normalizeHeaderName(item.name), item);
      });
  }

  return [...map.values()];
});

const mergedActiveQueryCount = computed(() => {
  return activeQueryParams.value.filter((item) => item.enabled && item.name)
    .length;
});

const mergedActiveHeaderCount = computed(() => {
  return activeHeaderParams.value.filter((item) => item.enabled && item.name)
    .length;
});

const configDescription =
  '调试请求会自动注入全局参数。若调试页填写了同名参数，调试页参数优先。当前为实时生效，无需手动保存。';

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

/**
 * 用途：获取指定类型参数的草稿行引用。
 * 参数说明：kind 表示参数类型，header 为请求头，query 为查询参数。
 * 返回值说明：返回对应参数类型的草稿行 ref。
 */
function getDraftRef(kind: GlobalParamKind) {
  return kind === 'header' ? headerDraft : queryDraft;
}

/**
 * 用途：获取指定类型参数的正式行列表引用。
 * 参数说明：kind 表示参数类型，header 为请求头，query 为查询参数。
 * 返回值说明：返回对应参数类型的正式行列表 ref。
 */
function getParamListRef(kind: GlobalParamKind) {
  return kind === 'header' ? headerParams : queryParams;
}

/**
 * 用途：判断指定索引是否为当前表格的末尾草稿行。
 * 参数说明：kind 表示参数类型，index 为表格当前行索引。
 * 返回值说明：当前索引等于正式行数量时返回 true。
 */
function isDraftRow(kind: GlobalParamKind, index: number) {
  return index === getParamListRef(kind).value.length;
}

/**
 * 用途：判断草稿行是否已经填写了可提交内容。
 * 参数说明：draft 为当前末尾草稿行数据。
 * 返回值说明：存在参数名或参数值时返回 true。
 */
function hasDraftContent(draft: GlobalParamItem) {
  return Boolean(draft.name?.trim() || `${draft.value ?? ''}`.trim());
}

/**
 * 用途：获取当前组件根 DOM，用于在表格重绘后恢复输入焦点。
 * 参数说明：无参数。
 * 返回值说明：返回 ElCard 根元素，未挂载时返回 null。
 */
function getConfigRootElement() {
  const target = configCardRef.value;
  if (target instanceof HTMLElement) {
    return target;
  }
  return (target as null | { $el?: HTMLElement })?.$el ?? null;
}

/**
 * 用途：将焦点恢复到刚由草稿行提交出来的正式参数行字段。
 * 参数说明：rowId 为正式行唯一标识，field 为需要恢复焦点的字段。
 * 返回值说明：无返回值，仅在 DOM 更新后恢复输入焦点和光标位置。
 */
function focusCommittedParamField(rowId: string, field: GlobalParamField) {
  void nextTick(() => {
    const input = getConfigRootElement()?.querySelector<HTMLInputElement>(
      `[data-global-param-row-id="${rowId}"][data-global-param-field="${field}"] input`,
    );
    if (!input) {
      return;
    }
    input.focus();
    const cursorPosition = input.value.length;
    input.setSelectionRange(cursorPosition, cursorPosition);
  });
}

/**
 * 用途：将指定类型的草稿行提交为正式行，并重置草稿行。
 * 参数说明：kind 表示参数类型，field 为触发提交的字段。
 * 返回值说明：无返回值，会向对应列表追加一行并恢复当前输入焦点。
 */
function commitDraft(kind: GlobalParamKind, field: GlobalParamField) {
  const draftRef = getDraftRef(kind);
  const listRef = getParamListRef(kind);
  const row = { ...draftRef.value };
  listRef.value.push(row);
  draftRef.value = createParamRow();
  focusCommittedParamField(row.id, field);
}

/**
 * 用途：处理草稿行字段输入，首次填写后自动提交成正式行。
 * 参数说明：kind 表示参数类型，field 为正在输入的字段，value 为输入后的字段值。
 * 返回值说明：无返回值，会在草稿行有内容时自动新增下一空行。
 */
function handleDraftInput(
  kind: GlobalParamKind,
  field: GlobalParamField,
  value: string,
) {
  const draftRef = getDraftRef(kind);
  draftRef.value[field] = value;
  if (hasDraftContent(draftRef.value)) {
    commitDraft(kind, field);
  }
}

/**
 * 用途：处理表格字段输入，区分正式行直接更新与草稿行自动提交。
 * 参数说明：kind 表示参数类型，row 为当前行，index 为行索引，field 为字段名，value 为输入值。
 * 返回值说明：无返回值，会更新正式行或提交草稿行。
 */
function handleParamFieldInput(
  kind: GlobalParamKind,
  row: GlobalParamItem,
  index: number,
  field: GlobalParamField,
  value: string,
) {
  const nextValue = kind === 'query' && field === 'name' ? value.trim() : value;
  if (isDraftRow(kind, index)) {
    handleDraftInput(kind, field, nextValue);
    return;
  }
  row[field] = nextValue;
}

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
  <ElCard ref="configCardRef" shadow="never" class="config-card">
    <template #header>
      <div class="flex items-center justify-between">
        <div class="config-card__title">
          <span class="font-medium">全局参数配置</span>
          <ElTooltip :content="configDescription" placement="top">
            <button
              type="button"
              class="config-card__help"
              aria-label="查看全局参数配置说明"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4" />
                <path d="M12 8h.01" />
              </svg>
            </button>
          </ElTooltip>
        </div>
        <ElSpace>
          <ElButton v-if="isAggregation" @click="applyCurrentServiceTemplate">
            切换到当前服务作用域
          </ElButton>
          <span class="config-card__inject-stat">
            <span>生效注入</span>
            <b>Query {{ mergedActiveQueryCount }}</b>
            <b>Header {{ mergedActiveHeaderCount }}</b>
          </span>
          <ElButton @click="resetScope">清空当前作用域</ElButton>
        </ElSpace>
      </div>
    </template>

    <ElForm label-width="110px" label-position="left" class="mb-4 mt-2">
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
        <ElTable
          :data="[...headerParams, headerDraft]"
          :max-height="props.tableMaxHeight"
          border
        >
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
                :model-value="row.name"
                filterable
                allow-create
                default-first-option
                clearable
                :placeholder="
                  $index === headerParams.length
                    ? '添加请求头'
                    : '例如 Authorization'
                "
                :data-global-param-row-id="row.id"
                data-global-param-field="name"
                @update:model-value="
                  (value) =>
                    handleParamFieldInput('header', row, $index, 'name', value)
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
                :model-value="row.value"
                :placeholder="
                  $index === headerParams.length
                    ? '添加 Header 值'
                    : 'Header 值'
                "
                :data-global-param-row-id="row.id"
                data-global-param-field="value"
                @update:model-value="
                  (value) =>
                    handleParamFieldInput('header', row, $index, 'value', value)
                "
              />
            </template>
          </ElTableColumn>
          <ElTableColumn label="说明" min-width="220">
            <template #default="{ row, $index }">
              <ElInput
                :model-value="row.description"
                placeholder="可选说明"
                :data-global-param-row-id="row.id"
                data-global-param-field="description"
                @update:model-value="
                  (value) =>
                    handleParamFieldInput(
                      'header',
                      row,
                      $index,
                      'description',
                      value,
                    )
                "
              />
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
        <ElTable
          :data="[...queryParams, queryDraft]"
          :max-height="props.tableMaxHeight"
          border
        >
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
                :model-value="row.name"
                :placeholder="
                  $index === queryParams.length ? '添加参数名' : '例如 tenantId'
                "
                :data-global-param-row-id="row.id"
                data-global-param-field="name"
                @update:model-value="
                  (value) =>
                    handleParamFieldInput('query', row, $index, 'name', value)
                "
              />
            </template>
          </ElTableColumn>
          <ElTableColumn label="参数值" min-width="200">
            <template #default="{ row, $index }">
              <ElInput
                :model-value="row.value"
                :placeholder="
                  $index === queryParams.length ? '添加参数值' : '参数值'
                "
                :data-global-param-row-id="row.id"
                data-global-param-field="value"
                @update:model-value="
                  (value) =>
                    handleParamFieldInput('query', row, $index, 'value', value)
                "
              />
            </template>
          </ElTableColumn>
          <ElTableColumn label="说明" min-width="220">
            <template #default="{ row, $index }">
              <ElInput
                :model-value="row.description"
                placeholder="可选说明"
                :data-global-param-row-id="row.id"
                data-global-param-field="description"
                @update:model-value="
                  (value) =>
                    handleParamFieldInput(
                      'query',
                      row,
                      $index,
                      'description',
                      value,
                    )
                "
              />
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
</template>

<style scoped>
/* 卡片观感与首页保持一致：更大的圆角、柔和边框与悬浮阴影 */
.config-card {
  --config-radius: calc(var(--radius) * 1.18);

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

.config-card__title {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  font-size: 14px;
  color: var(--el-text-color-primary);
}

.config-card__help {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--radius);
  transition:
    color 0.15s ease,
    background-color 0.15s ease,
    border-color 0.15s ease;
}

.config-card__help:hover {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border-color: color-mix(in srgb, var(--el-color-primary) 30%, transparent);
}

.config-card__help svg {
  width: 14px;
  height: 14px;
}

.config-card__inject-stat {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  padding: 5px 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--radius);
}

.config-card__inject-stat b {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--el-color-primary);
}

:deep(.el-table__row:last-child) {
  background: color-mix(in srgb, var(--el-fill-color-light) 50%, transparent);
}

:deep(.el-table__row:last-child .el-input__inner::placeholder) {
  color: var(--el-text-color-placeholder);
}
</style>
