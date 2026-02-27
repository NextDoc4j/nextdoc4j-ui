<script setup lang="ts">
import type { ApiInfo, Schema } from '#/typings/openApi';

import { computed, onBeforeMount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import { ApiLinkPrefix, ApiTestRun, ApiTestRunning } from '@vben/icons';

import { useClipboard } from '@vueuse/core';
import {
  ElButton,
  ElCard,
  ElCollapse,
  ElCollapseItem,
  ElDescriptions,
  ElDescriptionsItem,
  ElMessage,
  ElRadioButton,
  ElRadioGroup,
  ElTooltip,
} from 'element-plus';

import JsonViewer from '#/components/json-viewer/index.vue';
import SchemaView from '#/components/schema-view.vue';
import { methodType } from '#/constants/methods';
import { useApiStore } from '#/store';
import { generateExample, resolveSchema } from '#/utils/schema';

import ParameterView from './parameter-view.vue';
import PathSegment from './path-segment.vue';
import SecurityView from './security-view.vue';

// 权限工具函数
interface SecurityMetadata {
  permissions?: Array<{
    mode: string;
    orType?: string;
    orValues?: string[];
    type?: string;
    values: string[];
  }>;
  roles?: Array<{
    mode: string;
    type?: string;
    values: string[];
  }>;
  ignore?: boolean;
}

defineOptions({
  name: 'DocumentView',
});

const props = defineProps<{
  showTest: boolean;
}>();

const emits = defineEmits<{
  test: [data: ApiInfo];
}>();

const parseSecurityMetadata = (apiInfo: any): null | SecurityMetadata => {
  if (!apiInfo) return null;
  return (
    (apiInfo['x-nextdoc4j-security'] as SecurityMetadata | undefined) || null
  );
};

const hasSecurityRequirement = (apiInfo: any): boolean | undefined => {
  const metadata = parseSecurityMetadata(apiInfo);
  if (!metadata || metadata.ignore) return false;
  const hasPermissions =
    metadata.permissions && metadata.permissions.length > 0;
  const hasRoles = metadata.roles && metadata.roles.length > 0;
  return hasPermissions || hasRoles;
};

const route = useRoute();
const apiStore = useApiStore();

const baseUrl = ref('');
const apiInfo = ref({} as ApiInfo);
const activeNames = ref<string>('200');
const requestBodyType = ref('');
const defaultExpanded = ref(true);
const jsonViewer = ref<InstanceType<typeof JsonViewer> | null>(null);

// 权限信息
const securityMetadata = computed(() => parseSecurityMetadata(apiInfo.value));
const hasSecurityReq = computed(() => hasSecurityRequirement(apiInfo.value));

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

const selectedStatusCode = ref('200');

const currentResponse = computed(() => {
  return apiInfo.value?.responses?.[selectedStatusCode.value] || null;
});

const responseData = computed(() => {
  if (!currentResponse.value) return null;

  const content = currentResponse.value.content || {};
  const schema =
    content['application/json']?.schema ||
    content['*/*']?.schema ||
    currentResponse.value.schema;

  return schema ? resolveSchema(schema) : null;
});

const responseExample = computed(() => {
  return responseData.value ? generateExample(responseData.value) : null;
});

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

const processSchema = (schema: Schema) => {
  if (!schema) return {};

  if (schema.properties) return schema.properties;

  const processProperties = (props: any, parentRequired: string[] = []) => {
    const result: Record<string, any> = {};
    if (!props) return result;

    Object.entries(props).forEach(([key, value]: [string, any]) => {
      result[key] = {
        ...value,
        required: parentRequired.includes(key),
      };

      if (value.type === 'object' && value.properties) {
        result[key].properties = processProperties(
          value.properties,
          value.required || [],
        );
      }

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

  const resolvedSchema = resolveSchema(schema);
  return {
    type: 'object',
    properties: processSchema(resolvedSchema),
  };
});

// 复制功能
const { copy: copyToClipboard } = useClipboard();

// 复制 baseUrl
async function handleCopyBaseUrl() {
  await copyToClipboard(baseUrl.value);
  ElMessage.success('Base URL 已复制');
}

// 复制 path
async function handleCopyPath() {
  await copyToClipboard(apiInfo.value.path);
  ElMessage.success('Path 已复制');
}

const handleTest = () => {
  if (props.showTest) {
    return;
  }
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
          <div v-html="apiInfo.description || '暂无描述'"></div>
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
                <ElButton
                  size="small"
                  class="ml-2 !px-1"
                  @click="handleCopyBaseUrl"
                >
                  <ApiLinkPrefix class="size-4" />
                </ElButton>
              </ElTooltip>
              <span @click="handleCopyPath" class="ml-2 cursor-pointer">
                <PathSegment
                  :path="apiInfo.path"
                  :param-style="{
                    ...methodType[apiInfo.method.toUpperCase()],
                    borderColor: methodType[apiInfo.method.toUpperCase()].color,
                  }"
                />
              </span>
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

      <!-- 权限要求 -->
      <div v-if="hasSecurityReq && securityMetadata" class="p-5">
        <ElCard shadow="never" header="访问权限">
          <SecurityView :metadata="securityMetadata" />
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

    <div
      class="sticky top-0 max-h-[calc(100vh-40px)] flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden"
      v-if="!showTest"
    >
      <div class="p-5">
        <ElCard shadow="never">
          <template #header>
            <div class="font-bold">示例</div>
          </template>

          <div v-if="requestBody" class="mb-6">
            <div class="mb-3 text-sm text-gray-700 dark:text-gray-300">
              请求示例
            </div>
            <JsonViewer
              ref="jsonViewer"
              :schema="currentRequestBody"
              :default-expanded="defaultExpanded"
            />
          </div>

          <div v-if="responseExample">
            <div class="mb-3 text-sm text-gray-700 dark:text-gray-300">
              响应示例
            </div>
            <JsonViewer
              ref="jsonViewer"
              :schema="responseData"
              :default-expanded="defaultExpanded"
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
