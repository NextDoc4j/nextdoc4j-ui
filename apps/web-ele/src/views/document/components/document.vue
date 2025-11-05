<script setup lang="ts">
import type { ApiInfo, Schema } from '#/typings/openApi';

import { computed, onBeforeMount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import { ApiLinkPrefix, ApiTestRun, ApiTestRunning } from '@vben/icons';

import {
  ElButton,
  ElCard,
  ElCollapse,
  ElCollapseItem,
  ElDescriptions,
  ElDescriptionsItem,
  ElRadioButton,
  ElRadioGroup,
  ElTooltip,
} from 'element-plus';

import JsonView from '#/components/json-view.vue';
import SchemaView from '#/components/schema-view.vue';
import { methodType } from '#/constants/methods';
import { useApiStore } from '#/store';
import { generateExample, resolveSchema } from '#/utils/schema';

import ParameterView from './parameter-view.vue';
import PathSegment from './path-segment.vue';

defineOptions({
  name: 'DocumentView',
});

defineProps<{
  showTest: boolean;
}>();

const emits = defineEmits<{
  test: [data: ApiInfo];
}>();

const route = useRoute();
const apiStore = useApiStore();

const baseUrl = ref('');
const apiInfo = ref({} as ApiInfo);
const activeNames = ref<string>('200');
const requestBodyType = ref('');

const parametersInPath = computed(() => {
  const data = apiInfo.value?.parameters?.filter((item) => item.in === 'path');
  if (data && data.length > 0) {
    return data;
  }
  return null;
});

const parametersInQuery = computed(() => {
  const data = apiInfo.value?.parameters?.filter((item) => item.in === 'query');
  if (data && data.length > 0) {
    return data;
  }
  return null;
});

// 状态码选择
const selectedStatusCode = ref('200');

const currentResponse = computed(() => {
  return apiInfo.value?.responses?.[selectedStatusCode.value] || null;
});

// 获取响应数据
const responseData = computed(() => {
  if (!currentResponse.value) return null;

  const content = currentResponse.value.content || {};
  const schema =
    content['application/json']?.schema ||
    content['*/*']?.schema ||
    currentResponse.value.schema;

  return schema ? resolveSchema(schema) : null;
});

// 响应示例数据
const responseExample = computed(() => {
  return responseData.value ? generateExample(responseData.value) : null;
});

// 递归获取所有字段的描述
const getAllFieldDescriptions = (
  schema: any,
  prefix = '',
): Record<string, string> => {
  const descriptions: Record<string, string> = {};

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
      Object.assign(descriptions, nestedDescriptions);
    });
  }

  // 处理数组类型
  if (schema.type === 'array' && schema.items) {
    if (schema.items.type === 'object') {
      const arrayDescriptions = getAllFieldDescriptions(
        schema.items,
        `${prefix}[]`,
      );
      Object.assign(descriptions, arrayDescriptions);
    } else if (schema.items.description) {
      descriptions[`${prefix}[]`] = schema.items.description;
    }
  }
  return descriptions;
};

// 修改响应体描述获取
const responseDescriptions = computed(() => {
  return responseData.value ? getAllFieldDescriptions(responseData.value) : {};
});

// 获取请求体数据
const requestBody = computed(() => {
  const content = apiInfo.value.requestBody?.content;
  if (!content) return null;

  const type = Object.keys(content)[0];
  const schema = content[type as string]?.schema;
  if (!schema) return null;

  if (schema.oneOf) {
    const arr = schema.oneOf.map((item: Schema) => {
      const resolved = resolveSchema(item);

      if (resolved.allOf) {
        const allProperties: any = {};
        resolved.allOf.forEach((one: Schema) => {
          const resolvedOne = one.$ref ? resolveSchema(one) : one;
          Object.assign(allProperties, resolvedOne.properties);
        });
        return {
          ...resolved,
          title: resolved.title || resolved.$ref?.split('/').pop() || '请求体',
          properties: allProperties,
        };
      }

      return {
        ...resolved,
        title: resolved.title || resolved.$ref?.split('/').pop() || '请求体',
      };
    });

    return arr;
  }
  const resolved = resolveSchema(schema);

  // 添加实体信息
  return {
    ...resolved,
    title: resolved.title || schema.$ref?.split('/').pop() || '请求体',
  };
});

watch(
  requestBody,
  (newVal) => {
    if (Array.isArray(newVal) && newVal.length > 0 && !requestBodyType.value) {
      requestBodyType.value = newVal[0].title;
    }
  },
  { immediate: true },
);

const currentRequestBody = computed(() => {
  if (!requestBody.value) return null;

  if (Array.isArray(requestBody.value)) {
    return (
      requestBody.value.find((item) => item.title === requestBodyType.value) ||
      requestBody.value[0] ||
      null
    );
  }

  return requestBody.value;
});

// 修改请求体描述获取
const requestBodyDescriptions = computed(() => {
  if (!currentRequestBody.value) return {};
  return getAllFieldDescriptions(currentRequestBody.value);
});

// 请求体示例
const requestBodyExample = computed(() => {
  if (!currentRequestBody.value) return null;
  return generateExample(currentRequestBody.value);
});

// 处理请求和响应的 schema
const processSchema = (schema: Schema) => {
  if (!schema) return {};

  // 如果传入的是已经处理过的 schema，直接返回
  if (schema.properties) return schema.properties;

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
      if (
        value.type === 'array' &&
        value.items?.type === 'object' &&
        value.items.properties
      ) {
        result[key].items = {
          ...value.items,
          properties: processProperties(
            value.items.properties,
            value.items.required || [],
          ),
        };
      }
    });

    return result;
  };

  return processProperties(schema.properties || {}, schema.required || []);
};

const responseSchema = computed(() => {
  if (!currentResponse.value?.content) return {};

  const content = currentResponse.value.content;
  const schema =
    content['application/json']?.schema ||
    content['*/*']?.schema ||
    currentResponse.value.schema;

  if (!schema) return {};

  // 如果是引用类型，需要解析引用
  const resolvedSchema = resolveSchema(schema);
  return {
    type: 'object',
    properties: processSchema(resolvedSchema),
  };
});

const handleTest = () => {
  if (apiInfo.value) {
    emits('test', apiInfo.value);
  }
};

const tagName = computed(() => {
  const routeName = route.name as string;
  return routeName?.split('*')[1] || '';
});

onBeforeMount(() => {
  const routeName = route.name;
  if (!routeName || typeof routeName !== 'string') {
    console.warn('Route name is not available');
    return;
  }

  const [group = '', tag = '', operationId = ''] = routeName.split('*') ?? [];

  const data = apiStore.searchPathData(group, tag, operationId);
  if (data) {
    apiInfo.value = data;

    if (data.responses) {
      const codes = Object.keys(data.responses);
      activeNames.value = codes[0] || '200';
      selectedStatusCode.value = codes[0] || '200';
    }
  }
  baseUrl.value = apiStore.openApi?.servers?.[0]?.url || '';
});

defineExpose({
  requestBodyType,
});
</script>

<template>
  <div class="relative flex h-full w-full gap-4 overflow-y-auto">
    <div class="flex flex-1 flex-col">
      <div class="flex flex-col p-5 pb-0">
        <div class="text-primary text-sm font-semibold">
          {{ tagName }}
        </div>
        <h1 class="mt-3 text-3xl font-bold">
          {{ apiInfo.summary ?? '暂无描述' }}
        </h1>
        <div class="prose prose-gray dark:prose-invert mt-2 text-lg">
          <p>{{ apiInfo.description ?? '暂无描述' }}。</p>
        </div>
      </div>

      <div class="px-5">
        <ElCard shadow="never" :body-style="{ padding: '10px' }" class="mt-6">
          <div class="flex items-center justify-between">
            <div class="font-mono">
              <span
                class="inline-flex items-center rounded-md px-1.5 py-1 font-bold"
                :style="methodType[apiInfo.method.toUpperCase()]"
              >
                {{ apiInfo.method.toUpperCase() }}
              </span>
              <ElTooltip placement="top" :content="baseUrl" v-if="baseUrl">
                <ElButton size="small" class="ml-2 !px-1">
                  <ApiLinkPrefix class="size-4" />
                </ElButton>
              </ElTooltip>
              <PathSegment
                :path="apiInfo.path"
                :param-style="{
                  ...methodType[apiInfo.method.toUpperCase()],
                  borderColor: methodType[apiInfo.method.toUpperCase()].color,
                }"
                class="ml-2"
              />
            </div>
            <ElButton
              text
              size="large"
              :style="methodType[apiInfo.method.toUpperCase()]"
              @click="handleTest"
              :class="
                showTest
                  ? `${methodType[apiInfo.method.toUpperCase()].backgroundColor} !cursor-not-allowed opacity-50`
                  : ''
              "
            >
              {{ showTest ? '' : '调试' }}
              <ApiTestRunning
                class="ml-0.5 size-4 animate-spin"
                v-if="showTest"
              />
              <ApiTestRun class="ml-0.5 size-4" v-else />
            </ElButton>
          </div>
        </ElCard>
      </div>

      <ElDescriptions
        :column="1"
        title="请求参数"
        class="mt-4 p-5"
        v-if="parametersInPath || parametersInQuery || requestBody"
      >
        <ElDescriptionsItem v-if="parametersInPath">
          <ElCard bordered shadow="never" header="Path 参数">
            <ParameterView
              v-for="item in parametersInPath"
              :key="item.name"
              :parameter="item"
            />
          </ElCard>
        </ElDescriptionsItem>
        <ElDescriptionsItem v-if="parametersInQuery">
          <ElCard bordered shadow="never" header="Query 参数">
            <ParameterView
              v-for="item in parametersInQuery"
              :key="item.name"
              :parameter="item"
            />
          </ElCard>
        </ElDescriptionsItem>
        <ElDescriptionsItem v-if="requestBody">
          <ElCard bordered shadow="never" header="Body 参数">
            <template #header>
              <div class="flex justify-between">
                <div class="flex items-center gap-2">
                  <span>Body 参数</span>
                  <div
                    v-if="requestBodyType"
                    class="rounded-md bg-red-100/50 px-1.5 py-0.5 font-mono text-xs font-bold text-red-600 dark:bg-red-400/10 dark:text-red-300"
                  >
                    {{ requestBodyType }}
                  </div>
                </div>
                <div
                  class="px-2 py-0.5 font-mono text-xs text-gray-600 dark:text-gray-300"
                >
                  {{
                    Object.keys(apiInfo.requestBody.content)[0] ??
                    'application/json'
                  }}
                </div>
              </div>
            </template>
            <div v-if="Array.isArray(requestBody)">
              <ElRadioGroup v-model="requestBodyType" size="small">
                <ElRadioButton
                  v-for="value in requestBody"
                  :key="value.title"
                  :value="value.title"
                  :label="value.title"
                >
                  {{ value.title }}
                </ElRadioButton>
              </ElRadioGroup>
              <SchemaView
                v-if="currentRequestBody"
                :key="requestBodyType"
                :data="currentRequestBody"
              />
            </div>
            <div v-else>
              <SchemaView :data="requestBody" />
            </div>
          </ElCard>
        </ElDescriptionsItem>
      </ElDescriptions>

      <ElDescriptions :column="1" title="响应结果" class="p-5">
        <ElDescriptionsItem>
          <ElCard shadow="never">
            <ElCollapse
              v-if="apiInfo"
              v-model="activeNames"
              accordion
              style="border: none"
            >
              <ElCollapseItem
                v-for="(_, code) in apiInfo.responses"
                :key="code"
                :name="code"
              >
                <template #title>
                  {{ code }}
                </template>
                <SchemaView :data="responseSchema" />
              </ElCollapseItem>
            </ElCollapse>
          </ElCard>
        </ElDescriptionsItem>
      </ElDescriptions>
    </div>

    <div class="sticky top-0 flex-1" v-if="!showTest">
      <div class="p-5">
        <ElCard
          shadow="never"
          class="overflow-y: auto max-h-[calc(100vh-40px)]"
        >
          <template #header>
            <div class="font-bold">示例</div>
          </template>

          <!-- 请求体示例 -->
          <div v-if="requestBody" class="mb-6">
            <div class="mb-3 text-sm text-gray-700 dark:text-gray-300">
              请求示例
            </div>
            <JsonView
              :key="`request-${apiInfo.path}`"
              :data="requestBodyExample"
              :descriptions="requestBodyDescriptions"
              :image-render="false"
            />
          </div>

          <!-- 响应示例 -->
          <div v-if="responseExample">
            <div class="mb-3 text-sm text-gray-700 dark:text-gray-300">
              响应示例
            </div>
            <JsonView
              :key="`response-${apiInfo.path}`"
              :data="responseExample"
              :descriptions="responseDescriptions"
              :image-render="false"
            />
          </div>

          <div
            v-if="!requestBody && !responseExample"
            class="py-8 text-center text-gray-400"
          >
            暂无示例数据
          </div>
        </ElCard>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.full-space {
  > :deep(.el-space__item) {
    width: 100%;
  }
}

:deep(.el-collapse-item) {
  .el-collapse-item__header,
  .el-collapse-item__wrap {
    border: none;
  }
}
</style>
