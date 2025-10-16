<script setup lang="ts">
import type { ParameterObject, Schema } from '#/typings/openApi';

import { computed, onBeforeMount, ref } from 'vue';
import { useRoute } from 'vue-router';

import {
  ElButton,
  ElCard,
  ElCol,
  ElCollapse,
  ElCollapseItem,
  ElDescriptions,
  ElDescriptionsItem,
  ElRadioButton,
  ElRadioGroup,
  ElRow,
  ElTag,
  ElTooltip,
} from 'element-plus';

import JsonView from '#/components/json-view.vue';
import SchemaView from '#/components/schema-view.vue';
import { methodType } from '#/constants/methods';
import { useApiStore } from '#/store';
import { generateExample, resolveSchema } from '#/utils/schema';

const props = defineProps<{
  showTest: boolean;
}>();

const emits = defineEmits<{
  test: [data: any];
}>();

const apiStore = useApiStore();
const route = useRoute();
const apiInfo = ref<any>(null);
const activeNames = ref<string | undefined>(undefined);
const requestBodyType = ref();
const parametersInPath = computed(() => {
  if (!apiInfo.value) return null;
  if (!apiInfo.value.parameters) return null;
  const data = apiInfo.value.parameters.filter(
    (item: ParameterObject) => item.in === 'path',
  );
  return data.length > 0 ? data : null;
});
const parametersInQuery = computed(() => {
  if (!apiInfo.value) return null;
  if (!apiInfo.value.parameters) return null;
  const data = apiInfo.value.parameters.filter(
    (item: ParameterObject) => item.in === 'query',
  );

  return data.length > 0 ? data : null;
});
// 状态码选择
const selectedStatusCode = ref('200');
// 获取响应数据
const responseData = computed(() => {
  const responses = apiInfo.value?.responses;
  if (!responses?.[selectedStatusCode.value]) {
    return null;
  }

  const response = responses[selectedStatusCode.value];

  // 处理不同的响应内容类型
  const content = response.content || {};
  const schema =
    content['application/json']?.schema ||
    content['*/*']?.schema ||
    response.schema; // 某些旧版本的 swagger 可能直接在 response 下定义 schema

  if (!schema) {
    return null;
  }

  return resolveSchema(schema);
});
// 响应示例数据
const responseExample = computed(() => {
  if (!responseData.value) return null;
  return generateExample(responseData.value);
});
// 递归获取所有字段的描述
const getAllFieldDescriptions = (
  schema: any,
  prefix = '',
): Record<string, string> => {
  let descriptions: Record<string, string> = {};

  if (!schema) return descriptions;

  // 处理当前层级的描述
  if (schema.description) {
    descriptions[prefix] = schema.description;
  }

  // 处理对象类型的属性
  if (schema.type === 'object' && schema.properties) {
    Object.entries(schema.properties).forEach(([key, prop]: [string, any]) => {
      const nestedPath = prefix ? `${prefix}.${key}` : key;
      const nestedDescriptions = getAllFieldDescriptions(prop, nestedPath);
      descriptions = { ...descriptions, ...nestedDescriptions };
    });
  }

  // 处理数组类型
  if (schema.type === 'array' && schema.items) {
    if (schema.items.type === 'object') {
      const arrayDescriptions = getAllFieldDescriptions(
        schema.items,
        `${prefix}[]`,
      );
      descriptions = { ...descriptions, ...arrayDescriptions };
    } else if (schema.items.description) {
      descriptions[`${prefix}[]`] = schema.items.description;
    }
  }

  return descriptions;
};
// 修改响应体描述获取
const responseDescriptions = computed(() => {
  if (!responseData.value) return {};
  return getAllFieldDescriptions(responseData.value);
});

// 获取请求体数据
const requestBody = computed(() => {
  if (!apiInfo.value?.requestBody?.content?.['application/json']?.schema) {
    return null;
  }
  const schema = apiInfo.value.requestBody.content['application/json'].schema;

  if (schema.oneOf) {
    const arr = schema.oneOf.map((item: Schema) => {
      const resolved = resolveSchema(item);
      if (resolved.allOf) {
        const allProperties: any = {};
        resolved.allOf.forEach((one: Schema) => {
          if (one.$ref) {
            const resolved = resolveSchema(one);
            Object.assign(allProperties, resolved.properties);
          }
          Object.assign(allProperties, one.properties);
        });
        return {
          ...resolved,
          title: resolved.title || resolved.$ref?.split('/').pop() || '请求体',
          type: resolved.type || 'object',
          description: resolved.description || '',
          properties: allProperties,
        };
      }
      return {
        ...resolved,
        title: resolved.title || resolved.$ref?.split('/').pop() || '请求体',
        type: resolved.type || 'object',
        description: resolved.description || '',
      };
    });
    // eslint-disable-next-line vue/no-side-effects-in-computed-properties
    requestBodyType.value = arr[1].title;
    return arr;
  }
  const resolved = resolveSchema(schema);
  // 添加实体信息
  return {
    ...resolved,
    title: resolved.title || schema.$ref?.split('/').pop() || '请求体',
    type: resolved.type || 'object',
    description: resolved.description || '',
  };
});

// 修改请求体描述获取
const requestBodyDescriptions = computed(() => {
  if (!requestBody.value) return {};
  return getAllFieldDescriptions(requestBody.value);
});

// 请求体示例
const requestBodyExample = computed(() => {
  if (!requestBody.value) return null;
  if (Array.isArray(requestBody.value)) {
    const data = requestBody.value.find(
      (item) => item.title === requestBodyType.value,
    );
    return generateExample(data);
  } else {
    return generateExample(requestBody.value);
  }
});

// 处理请求和响应的 schema
const processSchema = (schema: any) => {
  if (!schema) return {};

  // 如果传入的是已经处理过的 schema，直接返回
  if (schema.properties) {
    return schema.properties;
  }

  // 处理原始 schema
  const processProperties = (props: any, parentRequired: string[] = []) => {
    const result: Record<string, any> = {};
    if (!props) return result;

    Object.entries(props).forEach(([key, value]: [string, any]) => {
      result[key] = {
        ...value,
        required: parentRequired.includes(key),
      };

      // 处理对象类型的属性
      if (value.type === 'object' && value.properties) {
        result[key].properties = processProperties(
          value.properties,
          value.required || [],
        );
      }

      // 处理数组类型的属性
      if (value.type === 'array' && value.items) {
        result[key].items =
          value.items.type === 'object' && value.items.properties
            ? {
                ...value.items,
                properties: processProperties(
                  value.items.properties,
                  value.items.required || [],
                ),
              }
            : value.items;
      }
    });

    return result;
  };

  return processProperties(schema.properties || {}, schema.required || []);
};

const responseSchema = computed(() => {
  if (!apiInfo.value?.responses?.[selectedStatusCode.value]?.content) return {};

  const content = apiInfo.value.responses[selectedStatusCode.value].content;
  const schema =
    content['application/json']?.schema ||
    content['*/*']?.schema ||
    apiInfo.value.responses[selectedStatusCode.value].schema;

  if (!schema) return {};

  // 如果是引用类型，需要解析引用
  const resolvedSchema = resolveSchema(schema);
  return {
    type: 'object',
    properties: processSchema(resolvedSchema),
  };
});
const handleTest = () => {
  emits('test', apiInfo.value);
};

onBeforeMount(() => {
  const routeName = route.name;
  if (!routeName || typeof routeName !== 'string') {
    console.warn('Route name is not available');
    return;
  }

  const [group, tag, operationId] = routeName.split('*') ?? [];
  // 确保所有参数都是字符串类型
  const safeGroup = group || '';
  const safeTag = tag || '';
  const safeOperationId = operationId || '';

  apiInfo.value = apiStore.searchPathData(safeGroup, safeTag, safeOperationId);

  if (apiInfo.value?.responses) {
    activeNames.value = Object.keys(apiInfo.value.responses)[0];
  }
});
defineExpose({
  requestBodyType,
});
</script>

<template>
  <div class="relative box-border h-full w-full overflow-y-auto p-5">
    <ElCard :body-style="{ padding: '10px' }" class="sticky top-0 z-10">
      <span
        class="round font-600 inline-flex h-[24px] max-h-[90px] items-center !rounded px-1.5 py-[2px] text-sm"
        :style="{ ...methodType[apiInfo?.method?.toUpperCase()] }"
      >
        {{ apiInfo?.method?.toUpperCase() }}
      </span>
      <ElTooltip content="点击复制" placement="top">
        <span class="pl-4 hover:underline hover:decoration-dashed" v-copy>
          {{ apiInfo?.path }}
        </span>
      </ElTooltip>
      <ElButton
        type="primary"
        size="small"
        class="float-right ml-4"
        @click="handleTest"
        v-if="!props.showTest"
      >
        调试
      </ElButton>
    </ElCard>
    <div class="w-full pt-5">
      <ElDescriptions :column="2" bordered title="接口描述">
        <ElDescriptionsItem>
          <span v-html="apiInfo?.description ?? '暂无描述'"></span>
        </ElDescriptionsItem>
      </ElDescriptions>
      <ElDescriptions
        :column="1"
        bordered
        title="请求参数"
        class="mt-4"
        v-if="parametersInPath || parametersInQuery || requestBody"
      >
        <ElDescriptionsItem v-if="parametersInPath">
          <ElCard bordered header="Path 参数">
            <div class="app-json-schema-viewer pl-2">
              <div
                v-for="item in parametersInPath"
                :key="item.name"
                class="index-node pb-6 last:pb-0"
              >
                <div class="flex items-center justify-items-start">
                  <span class="property-name">
                    <span
                      class="truncate hover:underline hover:decoration-dashed"
                      v-copy
                    >
                      {{ item.name }}
                    </span>
                  </span>
                  &nbsp;
                  <span v-if="item?.schema" class="text-muted-big">
                    {{ item?.schema?.type }} &nbsp;
                    {{
                      item?.schema?.format ? `<${item?.schema?.format}>` : ''
                    }}
                    &nbsp;
                  </span>
                  &nbsp;
                  <div
                    class="index_additionalInformation flex flex-1 items-center truncate"
                  >
                    <div
                      v-if="item.description && !item.description.includes('<')"
                      class="index-additionalInformation__title"
                    >
                      {{ item.description }}
                    </div>
                    <div class="index-divider"></div>
                  </div>
                  <span class="index-required">必需</span>
                </div>
                <div class="flex flex-nowrap items-center">
                  <span v-if="item?.schema?.minLength" class="index-value">
                    {{
                      `>=${item.schema.minLength} ${item.schema.type === 'string' ? '字符' : ''}`
                    }}
                  </span>
                  <span v-if="item?.schema?.maxLength" class="index-value">
                    {{
                      `<= ${item.schema.maxLength} ${item.schema.type === 'string' ? '字符' : ''}`
                    }}
                  </span>
                  <span v-if="item?.schema?.minimum" class="index-value">
                    {{ `>= ${item.schema.minimum}` }}
                  </span>
                  <span v-if="item?.schema?.maximum" class="index-value">
                    {{ `<= ${item.schema.maximum}` }}
                  </span>
                  <span v-if="item?.minLength" class="index-value">
                    {{
                      `>=${item.minLength} ${item.type === 'string' ? '字符' : ''}`
                    }}
                  </span>
                  <span v-if="item?.maxLength" class="index-value">
                    {{
                      `<= ${item.maxLength} ${item.type === 'string' ? '字符' : ''}`
                    }}
                  </span>
                  <span v-if="item?.minimum" class="index-value">
                    {{ `>= ${item.minimum}` }}
                  </span>
                  <span v-if="item?.maximum" class="index-value">
                    {{ `<= ${item.maximum}` }}
                  </span>
                </div>
                <div
                  v-if="item.description && item.description.includes('<')"
                  class="color-[#667085] font-400 mt-2"
                  v-html="item.description"
                ></div>
                <div
                  class="mt-1 flex flex-nowrap items-center"
                  v-if="item.default"
                >
                  <span class="index-key">默认值:</span>
                  <span class="index-value">{{ item.default }}</span>
                </div>
                <div class="mt-1 flex flex-nowrap items-center">
                  <span class="index-key">示例值:</span>
                  <span class="index-value">{{ item.example }}</span>
                </div>
              </div>
            </div>
          </ElCard>
        </ElDescriptionsItem>
        <ElDescriptionsItem v-if="parametersInQuery">
          <ElCard bordered header="Query 参数">
            <div class="app-json-schema-viewer pl-2">
              <SchemaView v-if="parametersInQuery" :data="parametersInQuery" />
              <div
                v-for="item in parametersInQuery"
                :key="item.name"
                class="index-node pb-6"
              >
                <div class="flex items-center justify-items-start">
                  <span v-if="item.name" class="property-name">
                    <span
                      class="truncate hover:underline hover:decoration-dashed"
                      v-copy
                    >
                      {{ item.name }}
                    </span>
                  </span>
                  <span v-if="item.schema" class="text-muted-big">
                    <SchemaView :data="resolveSchema(item.schema)" />
                  </span>

                  <div
                    class="index_additionalInformation flex flex-1 items-center truncate"
                  >
                    <div
                      v-if="item.description && !item.description.includes('<')"
                      class="index-additionalInformation__title"
                    >
                      {{ item.description }}
                    </div>
                    <div
                      v-if="
                        !item.description &&
                        item?.schema?.items?.description &&
                        !item?.schema?.items?.description.includes('<')
                      "
                      class="index-additionalInformation__title"
                    >
                      {{ item.schema.items.description }}
                    </div>
                    <div class="index-divider"></div>
                  </div>
                  <span v-if="item.required" class="index-required">必需</span>
                  <span v-else class="index-optional">可选</span>
                </div>
                <div class="flex flex-nowrap items-center">
                  <span v-if="item?.schema?.minLength" class="index-value">
                    {{
                      `>=${item.schema.minLength} ${item.schema.type === 'string' ? '字符' : ''}`
                    }}
                  </span>
                  <span v-if="item?.schema?.maxLength" class="index-value">
                    {{
                      `<= ${item.schema.maxLength} ${item.schema.type === 'string' ? '字符' : ''}`
                    }}
                  </span>
                  <span v-if="item?.schema?.minimum" class="index-value">
                    {{ `>= ${item.schema.minimum}` }}
                  </span>
                  <span v-if="item?.schema?.maximum" class="index-value">
                    {{ `<= ${item.schema.maximum}` }}
                  </span>
                  <span v-if="item?.minLength" class="index-value">
                    {{
                      `>=${item.minLength} ${item.type === 'string' ? '字符' : ''}`
                    }}
                  </span>
                  <span v-if="item?.maxLength" class="index-value">
                    {{
                      `<= ${item.maxLength} ${item.type === 'string' ? '字符' : ''}`
                    }}
                  </span>
                  <span v-if="item?.minimum" class="index-value">
                    {{ `>= ${item.minimum}` }}
                  </span>
                  <span v-if="item?.maximum" class="index-value">
                    {{ `<= ${item.maximum}` }}
                  </span>
                </div>
                <div
                  v-if="item.description && item.description.includes('<')"
                  class="color-[#667085] font-400 mt-2"
                  v-html="item.description"
                ></div>
                <div
                  v-if="
                    !item.description &&
                    item?.schema?.items?.description &&
                    item?.schema?.items?.description.includes('<')
                  "
                  class="color-[#667085] font-400 mt-2"
                  v-html="item?.schema?.items.description"
                ></div>
                <template v-if="item?.schema?.enum">
                  <div class="mt-1 flex flex-nowrap items-start">
                    <span class="index-key">枚举值:</span>
                    <span
                      v-for="value in item.schema.enum"
                      :key="value"
                      class="index-value mr-2"
                    >
                      {{ value }}
                    </span>
                  </div>
                </template>
                <template v-if="item?.schema?.items?.enum">
                  <div class="mt-1 flex flex-nowrap items-center">
                    <span class="index-key">枚举值:</span>
                    <span
                      v-for="value in item.schema.items.enum"
                      :key="value"
                      class="index-value mr-2"
                    >
                      {{ value }}
                    </span>
                  </div>
                </template>
                <div class="mt-1 flex flex-nowrap items-center">
                  <span v-if="item?.minimum" class="index-value mr-2">
                    {{ `>= ${item.minimum}` }}
                  </span>
                  <span v-if="item?.maximum" class="index-value mr-2">
                    {{ `<= ${item.maximum}` }}
                  </span>
                </div>
                <div
                  class="mt-1 flex flex-nowrap items-center"
                  v-if="item.default"
                >
                  <span class="index-key">默认值:</span>
                  <span class="index-value">{{ item.default }}</span>
                </div>
                <div
                  class="mt-1 flex flex-nowrap items-center"
                  v-if="item.example"
                >
                  <span class="index-key">示例值:</span>
                  <span class="index-value">{{ item.example }}</span>
                </div>
              </div>
            </div>
          </ElCard>
        </ElDescriptionsItem>
        <ElDescriptionsItem v-if="requestBody">
          <ElCard bordered header="Body 参数">
            <template #header>
              <span>Body 参数</span>
              <ElTag class="mx-6">application/json</ElTag>
            </template>
            <ElRow :gutter="16">
              <ElCol :span="props.showTest ? 24 : 14">
                <div
                  class="app-json-schema-viewer pl-2"
                  v-if="Array.isArray(requestBody)"
                >
                  <ElRadioGroup v-model="requestBodyType" size="small">
                    <ElRadioButton
                      v-for="value in requestBody"
                      :key="value.title"
                      border
                      :value="value.title"
                      :label="value.title"
                    >
                      {{ value.title }}
                    </ElRadioButton>
                  </ElRadioGroup>
                  <template v-for="(value, index) in requestBody" :key="index">
                    <SchemaView
                      v-if="value.title === requestBodyType"
                      :data="value"
                    />
                  </template>
                </div>
                <div v-else class="app-json-schema-viewer pl-2">
                  <SchemaView :data="requestBody" />
                </div>
              </ElCol>
              <ElCol :span="10" class="border-s-1" v-if="!props.showTest">
                <h5 class="mb-4">示例</h5>
                <JsonView
                  :data="requestBodyExample"
                  :descriptions="requestBodyDescriptions"
                  :image-render="false"
                />
              </ElCol>
            </ElRow>
          </ElCard>
        </ElDescriptionsItem>
      </ElDescriptions>
      <ElDescriptions :column="1" bordered title="响应结果" class="mt-4">
        <ElDescriptionsItem>
          <ElCard :body-style="{ padding: '0 20px' }">
            <ElCollapse
              v-if="apiInfo"
              v-model="activeNames"
              accordion
              style="border: none"
            >
              <ElCollapseItem
                v-for="(item, code) in apiInfo.responses"
                :key="code"
                :name="code"
              >
                <template #title="{ isActive }">
                  <div
                    class="title-wrapper"
                    :class="[{ 'is-active': isActive }]"
                  >
                    {{ code }}
                    {{ code === 200 ? '成功' : '' }}
                  </div>
                </template>

                <ElRow :gutter="16">
                  <ElCol :span="props.showTest ? 24 : 14" class="mt-6">
                    <ElTag type="info" class="index-value rounded-sm px-2 py-1">
                      {{ Object.keys(item.content || {}).join(' ') }}
                    </ElTag>
                    <div class="my-2">{{ item.description }}</div>
                    <h5 class="text-5 font-500">Body</h5>
                    <div class="app-json-schema-viewer pt-6">
                      <SchemaView :data="responseSchema" />
                    </div>
                  </ElCol>
                  <ElCol :span="10" class="border-s-1" v-if="!props.showTest">
                    <h5 class="mb-4 mt-6">示例</h5>
                    <JsonView
                      :data="responseExample"
                      :descriptions="responseDescriptions"
                      :image-render="false"
                    />
                  </ElCol>
                </ElRow>
              </ElCollapseItem>
            </ElCollapse>
          </ElCard>
        </ElDescriptionsItem>
      </ElDescriptions>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.full-space {
  > :deep(.el-space__item) {
    width: 100%;
  }
}

.app-json-schema-viewer {
  width: 100%;
  max-width: 800px;
  overflow-x: hidden;

  .index-node {
    @apply relative max-w-full;
  }

  .index-child-stack {
    @apply my-0 ms-5;

    .index-node-wrap {
      @apply border-l last:border-0;

      &:last-child {
        .index-sub-border {
          margin-left: 0;
          border-left: 1px solid var(--el-border-color);
        }
      }
    }

    .index-node {
      @apply ps-5;
    }

    .index-sub-border {
      position: absolute;
      top: -1.65rem;
      left: -1.25rem;
      width: 1.25rem;
      height: 2.5rem;
      margin-left: -12px;
      border-bottom: 1px solid var(--el-border-color);
      border-radius: 0;
    }
  }

  .index-key {
    flex-grow: 0;
    flex-shrink: 0;
    margin-right: 4px;
    font-weight: 400;
    color: #667085;
  }

  .index-value {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 6px;
    font-size: 12px;
    font-weight: 400;
    line-height: 20px;
    color: #667085;
    word-break: break-all;
    background: rgb(16 24 40 / 4%);
    border-radius: 6px;
  }

  .text-muted-big {
    font-size: 14px;
    font-weight: 500;
    color: #667085;
  }

  .index-additionalInformation__title {
    margin: 0 8px;
    color: #667085;
  }

  .property-name {
    padding: 0 8px;
    margin-right: 8px;
    font-size: 12px;
    font-weight: 600;
    line-height: 22px;
    color: #1890ff;
    background-color: rgb(24 144 255 / 4%);
    border-radius: 6px;
  }

  .el-radio-button {
    padding: 0 6px 6px;

    .el-radio-button__inner {
      border: 1px solid var(--el-border-color);
      border-radius: var(--el-border-radius-base);
    }
  }
}

.index-required {
  height: 22px;
  padding: 0 12px;
  font-size: 12px;
  line-height: 22px;
  color: #f79009;
  white-space: nowrap;
}

.index-optional {
  height: 22px;
  padding: 0 12px;
  font-size: 12px;
  line-height: 22px;
  color: #667085;
  white-space: nowrap;
}

.index-divider {
  flex: 1;
  height: 0;
  margin: 0 6px;
  border: 1px dashed transparent !important;
}

.index-node:hover {
  .index-divider {
    border: 1px dashed var(--el-border-color) !important;
  }
}

.el-card {
  border-radius: 12px;
}

.el-collapse {
  .el-collapse-item__header {
    padding: 0 20px;
    border-bottom: 1px solid var(--el-border-color) !important;
  }

  .el-collapse-item__wrap {
    padding: 0 20px 20px;
  }
}
</style>
