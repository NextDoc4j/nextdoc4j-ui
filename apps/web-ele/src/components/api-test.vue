<script lang="ts" setup>
import type { ParameterObject } from '#/typings/openApi';

import { ref, watch } from 'vue';

import { SvgCloseIcon } from '@vben/icons';

import {
  ElButton,
  ElEmpty,
  ElIcon,
  ElInput,
  ElMessage,
  ElSpace,
  ElTable,
  ElTableColumn,
  ElTabPane,
  ElTabs,
  ElTooltip,
} from 'element-plus';
import { Pane, Splitpanes } from 'splitpanes';

import JsonView from '#/components/json-view.vue';
import { methodType } from '#/constants/methods';
import { useTokenStore } from '#/store';

import bodyParams from './body-params.vue';
import paramsTable from './params-table.vue';

const props = defineProps<{
  method: string;
  parameters: ParameterObject[];
  path: string;
  requestBody: any;
  requestBodyType: string;
  security: any;
}>();

// 添加 emit 定义
const emit = defineEmits(['cancel']);

const config = import.meta.env.VITE_GLOB_API_URL;

const activeTab = ref(props.requestBody ? 'Body' : 'Params');
const bodyTabRef = ref();
const responseTab = ref('Body');

// 组件状态
const loading = ref(false);
const requestUrl = ref('');

const queryParams = ref<
  Array<{ enabled: boolean; name: string; value: string }>
>([]);
const pathParams = ref<Array<{ name: string; value: string }>>([]);
const headers = ref<Array<{ enabled: boolean; name: string; value: string }>>(
  [],
);
const cookies = ref<Array<{ enabled: boolean; name: string; value: string }>>(
  [],
);

// 监听 props 变化，同步接口信息
watch(
  () => props.path,
  (newPath) => {
    if (newPath) {
      requestUrl.value = newPath;
    }
  },
  { immediate: true },
);

// 监听 parameters 变化，同步参数信息
watch(
  () => props.parameters,
  (newParams) => {
    if (!newParams) return;

    // 清空现有参数
    queryParams.value = [];
    pathParams.value = [];
    headers.value = [];
    cookies.value = [];

    // 定义类型映射
    const paramMap = {
      cookie: cookies.value,
      header: headers.value,
      path: pathParams.value,
      query: queryParams.value,
    };

    newParams.forEach((param) => {
      const { schema = {} } = param;
      const { type, format, enum: enumValues, items } = schema;

      let value = param.example?.toString() || '';
      if (!value && enumValues?.length) {
        value = enumValues[0];
      }

      const paramItem = {
        name: param.name,
        value,
        enabled: param.required ?? true,
        description: param.description || '',
        type: type || 'string',
        format: format || items?.format,
        required: param.required || false,
        enum: enumValues,
        schema: schema
          ? {
              type,
              format,
              enum: enumValues,
              items: items
                ? {
                    enum: items.enum,
                    format: items.format,
                  }
                : undefined,
            }
          : undefined,
      };

      const targetArray = paramMap[param.in];
      if (targetArray) {
        targetArray.push(paramItem);
      }
    });
  },
  { immediate: true },
);

// 响应状态
const responseStatus = ref({ code: 0, text: '-', type: 'default' });
const responseTime = ref(0);
const responseSize = ref('0 B');
const responseData = ref<any>(null);
const responseHeaders = ref<
  Array<{ enabled: boolean; name: string; value: string }>
>([]);
const responseDescriptions = ref({});

// 添加关闭处理函数
const handleClose = (e: any) => {
  e.stopPropagation();
  emit('cancel');
};

async function sendRequest() {
  loading.value = true;
  const startTime = performance.now(); // 记录开始时间;

  try {
    // 构建请求URL，处理路径参数
    let url = requestUrl.value;
    pathParams.value.forEach((param) => {
      if (param.name && param.value) {
        url = url.replace(`{${param.name}}`, encodeURIComponent(param.value));
      }
    });

    const finalUrl = new URL(config + url, window.origin);

    // 添加查询参数
    queryParams.value
      .filter((p) => p.enabled && p.name)
      .forEach((p) => finalUrl.searchParams.append(p.name, p.value));

    // 构建请求头
    const requestHeaders = new Headers();
    headers.value
      .filter((h) => h.enabled && h.name)
      .forEach((h) => requestHeaders.append(h.name, h.value));

    if (props.security && useTokenStore().token) {
      const security: string[] = Object.keys(props.security[0]);
      requestHeaders.append(security[0] ?? '', useTokenStore().token ?? '');
    }

    // 添加form-data 添加默认的 Content-Type
    const formData = new FormData();
    let bodyData = '';
    switch (bodyTabRef.value.bodyType) {
      case 'binary': {
        const binaryData = bodyTabRef.value.fileList[0];
        formData.append('file', binaryData);
        requestHeaders.append('Content-Type', 'multipart/form-data');
        break;
      }
      case 'form-data': {
        if (formDataParams.value.some((h) => h.enabled && h.name)) {
          formDataParams.value
            .filter((h) => h.enabled && h.name)
            .forEach((h) => {
              if (Array.isArray(h.value) && h.value.length > 0) {
                formData.append(h.name, ...h.value);
              } else {
                formData.append(h.name, h.value);
              }
            });
          requestHeaders.append('Content-Type', 'multipart/form-data');
        }
        break;
      }
      case 'json': {
        if (props.requestBody) {
          const example = bodyTabRef.value.getExample() ?? '';
          bodyData = example;
        }
        requestHeaders.append('Content-Type', 'application/json');
        break;
      }
      case 'raw': {
        if (props.requestBody) {
          const example = bodyTabRef.value.getExample() ?? '';
          bodyData = example;
        }
        requestHeaders.append('Content-Type', 'text/plain');
        break;
      }
      case 'x-www-form-urlencoded': {
        if (urlEncodedParams.value.some((h) => h.enabled && h.name)) {
          urlEncodedParams.value
            .filter((h) => h.enabled && h.name)
            .forEach((h) => formData.append(h.name, h.value));
        }
        requestHeaders.append('Content-Type', 'x-www-form-urlencoded');
        break;
      }
      case 'xml': {
        if (props.requestBody) {
          const example = bodyTabRef.value.getExample() ?? '';
          bodyData = example;
        }
        requestHeaders.append('Content-Type', 'text/xml');
        break;
      }
      default: {
        requestHeaders.append('Content-Type', 'application/json');
      }
    }
    // 发送请求
    const response = await fetch(finalUrl, {
      method: props.method.toUpperCase(),
      headers: requestHeaders,
      body:
        props.method.toLowerCase() !== 'get' &&
        ['binary', 'form-data', 'x-www-form-urlencoded'].includes(
          bodyTabRef.value.bodyType,
        )
          ? formData
          : bodyData || undefined,
    });
    // 处理响应
    // 根据Content-Type自动选择解析方式
    const contentType = response.headers.get('content-type');
    let responseBody;
    if (contentType && contentType.includes('application/json')) {
      responseBody = await response.json();
    } else if (contentType && contentType.includes('text/plain')) {
      responseBody = await response.text();
    } else {
      responseBody = await response.blob();
      downloadBlob(
        responseBody,
        getDownloadFilename(response, requestUrl.value),
      );
    }

    responseTime.value = Number((performance.now() - startTime).toFixed(2));
    responseStatus.value = {
      code: response.status,
      text: `${response.status} ${response.statusText}`,
      type: response.ok ? 'success' : 'error',
    };
    responseData.value = responseBody;

    const header = Object.fromEntries(response.headers.entries());
    responseHeaders.value = [];
    for (const key in header) {
      responseHeaders.value.push({
        name: key,
        value: header[key] ?? '',
        enabled: true,
      });
    }
    // 计算响应大小
    let size;
    if (typeof responseBody === 'string') {
      size = responseBody.length * 2; // 字符串按UTF-16计算
    } else if (responseBody instanceof Blob) {
      size = responseBody.size;
    } else {
      size = JSON.stringify(responseBody).length * 2;
    }
    responseSize.value = formatSize(size);
  } catch (error: any) {
    ElMessage.error(error?.ElMessage || '请求失败');
    responseStatus.value = {
      code: 0,
      text: error?.ElMessage || '请求失败',
      type: 'error',
    };
  } finally {
    loading.value = false;
  }
}

function downloadBlob(blob: Blob, filename: string = 'download') {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  link.style.display = 'none';

  document.body.append(link);
  link.click();

  // 清理
  setTimeout(() => {
    window.URL.revokeObjectURL(url);
    link.remove();
  }, 100);
}

/**
 * 从HTTP响应获取下载文件名
 * @param response - fetch响应对象
 * @param url - 请求URL
 * @returns 提取到的文件名
 */
function getDownloadFilename(response: Response, url: string): string {
  // 优先从Content-Disposition头获取
  const contentDisposition = response.headers.get('Content-Disposition');
  if (contentDisposition) {
    const filenameMatch = contentDisposition.match(
      /filename[^;=\n]*((['"]).*?\2|[^;\n]*)/,
    );
    if (filenameMatch?.[1]) {
      return filenameMatch[1].replaceAll(/['"]/g, '');
    }
  }

  // 从URL路径中提取备用方案
  const pathname = new URL(url).pathname;
  const filename = pathname.split('/').pop()?.split('?')[0] || 'download';

  return filename;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
}

// Form Data 参数相关
const formDataParams = ref<
  Array<{
    enabled: boolean;
    name: string;
    type: 'file' | 'text';
    value: string;
  }>
>([]);

// URL Encoded 参数相关
const urlEncodedParams = ref<
  Array<{
    enabled: boolean;
    name: string;
    value: string;
  }>
>([]);

defineExpose({});
</script>

<template>
  <Splitpanes class="default-theme max-h-[88vh]" horizontal>
    <Pane :size="70" class="flex flex-col">
      <ElSpace class="mb-4 px-4 pt-5 font-medium">
        <ElIcon @click="handleClose" class="cursor-pointer">
          <SvgCloseIcon />
        </ElIcon>
        <span class="font-medium">在线运行</span>
      </ElSpace>
      <div class="mb-4 px-4">
        <ElSpace direction="vertical" :size="12" class="w-full" fill>
          <div class="flex">
            <ElInput
              v-model="requestUrl"
              placeholder="请输入正确的URL"
              class="flex-1"
            >
              <template #prefix>
                <span
                  class="round font-600 inline-flex h-[24px] max-h-[90px] items-center !rounded px-1.5 py-[2px] text-sm"
                  :style="{ ...methodType[method?.toUpperCase()] }"
                >
                  {{ method?.toUpperCase() }}
                </span>
              </template>
            </ElInput>
            <ElButton type="primary" class="ml-2" @click="sendRequest">
              发送
            </ElButton>
          </div>
        </ElSpace>
      </div>

      <div class="flex-1 overflow-hidden">
        <ElTabs v-model="activeTab">
          <ElTabPane name="Params" label="Params">
            <template #label>
              <span class="px-2 font-normal">Params </span>
              <span
                class="highlight circle"
                v-if="pathParams.length + queryParams.length"
              >
                {{ pathParams.length + queryParams.length }}
              </span>
            </template>
            <div v-if="pathParams.length > 0">
              <h3 class="text-sm">Path 参数</h3>
              <div class="params-table">
                <ElTable
                  border
                  class="params-table"
                  :data="pathParams"
                  header-cell-class-name="p-2"
                >
                  <ElTableColumn prop="name" label="参数名">
                    <template #default="{ row }">
                      <ElInput v-model="row.name" />
                    </template>
                  </ElTableColumn>
                  <ElTableColumn prop="value" label="参数值">
                    <template #default="{ row }">
                      <ElInput v-model="row.value" />
                    </template>
                  </ElTableColumn>
                </ElTable>
              </div>
            </div>

            <div>
              <h3 class="text-sm">Query 参数</h3>
              <params-table :table-data="queryParams" />
            </div>
          </ElTabPane>

          <body-params
            ref="bodyTabRef"
            :request-body="requestBody"
            :form-data-params="formDataParams"
            :url-encoded-params="urlEncodedParams"
            :request-body-type="requestBodyType"
          />

          <ElTabPane name="Headers" label="Headers">
            <template #label>
              <span class="px-2 font-normal">Headers </span>
            </template>
            <params-table :table-data="headers" />
          </ElTabPane>
          <ElTabPane name="Cookies" label="Cookies">
            <template #label>
              <span class="px-2 font-normal">Cookies </span>
            </template>
            <params-table :table-data="cookies" />
          </ElTabPane>
        </ElTabs>
      </div>
    </Pane>
    <Pane :size="30" :min-size="10" :max-size="60">
      <div class="flex h-full w-full flex-col">
        <div class="mb-4 flex justify-between px-4 pt-2">
          <span class="font-medium">返回结果</span>
          <ElSpace
            v-if="responseStatus.type !== 'default'"
            class="text-xs text-[--el-color-success]"
          >
            <ElTooltip
              :content="`HTTP 状态码: ${responseStatus.type}`"
              placement="top"
            >
              <span>{{ responseStatus.text }}</span>
            </ElTooltip>
            <ElTooltip content="耗时" placement="top">
              <span>{{ responseTime }}ms</span>
            </ElTooltip>
            <ElTooltip content="大小" placement="top">
              <span>{{ responseSize }}</span>
            </ElTooltip>
          </ElSpace>
        </div>
        <div class="w-full flex-1 overflow-hidden">
          <ElTabs
            v-model="responseTab"
            v-if="responseStatus.type !== 'default'"
          >
            <ElTabPane name="Body" label="Body">
              <template #label>
                <span class="px-2 font-normal">Body </span>
              </template>
              <JsonView
                :data="responseData"
                :descriptions="responseDescriptions"
                :image-render="true"
                class="response-body"
              />
            </ElTabPane>
            <ElTabPane name="Headers" label="Headers">
              <template #label>
                <span class="px-2 font-normal">Headers </span>
                <span
                  v-if="responseHeaders.length > 0"
                  class="highlight circle"
                >
                  {{ responseHeaders.length }}
                </span>
              </template>
              <div class="response-headers">
                <ElTable border :data="responseHeaders">
                  <ElTableColumn label="参数名" prop="name" />
                  <ElTableColumn label="参数值" prop="value" />
                </ElTable>
              </div>
            </ElTabPane>
          </ElTabs>
          <ElEmpty v-else :image-size="80">
            <template #description>
              <span class="text-sm">点击"发送"按钮获取返回结果</span>
            </template>
          </ElEmpty>
        </div>
      </div>
    </Pane>
  </Splitpanes>
</template>

<style lang="scss" scoped>
.api-tester {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fff;
}

.response-header {
  .response-status,
  .response-time,
  .response-size {
    @apply mb-2;

    .label {
      @apply inline-block w-[80px] text-sm;
    }
  }
}

:deep(.params-table.el-table) {
  @apply mb-4 mt-2;

  .el-table__cell {
    padding: 0;
  }

  .cell {
    padding: 0;

    .el-input__wrapper {
      background-color: transparent;
      border: none;
      border-radius: 0;
      box-shadow: none;
    }
  }

  .el-table__header {
    .cell {
      padding: 4px 8px;
    }
  }
}

:deep(.el-tabs) {
  width: 100%;
  height: 100%;
  overflow: hidden;

  .el-tabs__nav-wrap {
    padding: 0 10px;
  }

  .el-tabs__item {
    padding: 0 4px;
  }

  .el-tabs__content {
    .el-tab-pane {
      @apply px-4 pb-4;

      width: 100%;
      height: 100%;
      overflow-y: auto;
    }
  }
}
</style>
