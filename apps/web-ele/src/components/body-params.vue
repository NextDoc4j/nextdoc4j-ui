<script lang="ts" setup>
import type { UploadInstance, UploadProps, UploadRawFile } from 'element-plus';

import type { Schema } from '#/typings/openApi';

import { computed, onMounted, ref } from 'vue';

import {
  ElButton,
  ElRadioButton,
  ElRadioGroup,
  ElTabPane,
  ElUpload,
  genFileId,
} from 'element-plus';
import X2JS from 'x2js';

import { generateExample, resolveSchema } from '#/utils/schema';

import JsonView from './json-view.vue';
import paramsTable from './params-table.vue';

const props = defineProps<{
  formDataParams: ParamsType[];
  requestBody: any;
  requestBodyType: string;
  urlEncodedParams: ParamsType[];
}>();

const x2js = new X2JS({
  // 是否忽略根元素
  ignoreRoot: false,
  // 属性前缀
  attributePrefix: '_',
  // 数组标签
  arrayAccessForm: 'none',
  // 日期格式化
  datetimeAccessFormPaths: ['root.date'],
});

type BodyType =
  | 'binary'
  | 'form-data'
  | 'json'
  | 'none'
  | 'raw'
  | 'x-www-form-urlencoded'
  | 'xml';
export interface ParamsType {
  enabled: boolean;
  name: string;
  value: string;
  format?: string;
  type?: string;
  description?: string;
  contentType?: string;
}

// 根据参数类型推断默认的 Content-Type
function inferContentType(type?: string, format?: string): string | undefined {
  // 优先检查 format 是否为 binary（文件类型）
  if (format === 'binary') {
    return 'application/octet-stream';
  }
  if (!type) return undefined;
  switch (type) {
    case 'array':
    case 'object': {
      return 'application/json';
    }
    case 'boolean':
    case 'integer':
    case 'number':
    case 'string': {
      return 'text/plain';
    }
    case 'file': {
      return 'application/octet-stream';
    }
    default: {
      return undefined;
    }
  }
}
// 请求体类型
const bodyType = ref<BodyType>();
// Raw 请求体
const editorRef = ref();
const uploadRef = ref<UploadInstance>();
const fileList = ref([]);

// 获取请求体数据
const requestBody = computed(() => {
  if (!props.requestBody?.content?.['application/json']?.schema) {
    return null;
  }
  const schema = props.requestBody.content['application/json'].schema;

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

// 请求体示例
const requestBodyExample = computed(() => {
  if (!requestBody.value) return null;
  if (Array.isArray(requestBody.value)) {
    const data = requestBody.value.find(
      (item) => item.title === props.requestBodyType,
    );
    return generateExample(data);
  } else {
    return generateExample(requestBody.value);
  }
});

const requestBodyXMLExample = computed(() => {
  const data = x2js.js2xml(requestBodyExample.value);
  return `<?xml version="1.0" encoding="UTF-8"?><root>${data}</root>`;
});
const getExample = () => {
  return editorRef.value.getEditorValue();
};

const handleExceed: UploadProps['onExceed'] = (files) => {
  uploadRef.value!.clearFiles();
  const file = files[0] as UploadRawFile;
  file.uid = genFileId();
  uploadRef.value!.handleStart(file);
};

onMounted(() => {
  if (!props.requestBody || !props.requestBody.content) {
    bodyType.value = 'none';
    return;
  }

  // 遍历所有 content 类型，找第一个有实际内容的 schema
  const content = props.requestBody.content;
  const types = Object.keys(content);
  let foundType = '';
  let schema = null;
  for (const t of types) {
    const s = content[t]?.schema;
    // 检查 schema 是否有实际内容（properties 或 $ref）
    if (s && (s.properties || s.$ref || s.items)) {
      foundType = t;
      schema = s;
      break;
    }
  }

  if (!schema) {
    bodyType.value = 'none';
    return;
  }

  // 根据找到的类型设置 bodyType
  if (foundType.includes('json')) {
    bodyType.value = 'json';
  } else if (foundType.includes('multipart')) {
    bodyType.value = 'form-data';
  } else if (foundType.includes('x-www-form-urlencoded')) {
    bodyType.value = 'x-www-form-urlencoded';
  }

  // 处理 schema
  let properties: Record<string, any> = schema?.properties ?? {};
  if (schema?.$ref) {
    const resolved = resolveSchema(schema);
    properties = resolved.properties ?? {};
  }

  // 检查是否有 binary 格式的字段，有则切换到 form-data
  const hasBinaryField = Object.values(properties).some(
    (p: any) => p?.format === 'binary' || p?.items?.format === 'binary',
  );
  if (hasBinaryField) {
    bodyType.value = 'form-data';
  }

  // 遍历属性添加到 formDataParams
  Object.keys(properties).forEach((key) => {
    // eslint-disable-next-line vue/no-mutating-props
    props.formDataParams.push({
      name: key,
      enabled: true,
      value: '',
      format:
        properties[key].type === 'array'
          ? properties[key]?.items?.format
          : properties[key].format,
      description: properties[key].description,
      type: properties[key].type,
      contentType: inferContentType(
        properties[key].type,
        properties[key].type === 'array'
          ? properties[key]?.items?.format
          : properties[key].format,
      ),
    });
  });
});

defineExpose({
  bodyType,
  getExample,
  fileList,
});
</script>

<template>
  <ElTabPane name="Body" label="Body">
    <template #label>
      <span class="px-2 font-normal">Body </span>
      <span
        class="highlight"
        v-if="
          (bodyType === 'form-data' && formDataParams.length > 0) ||
          (bodyType === 'x-www-form-urlencoded' && urlEncodedParams.length > 0)
        "
      >
        {{
          bodyType === 'form-data'
            ? formDataParams.length
            : bodyType === 'x-www-form-urlencoded'
              ? urlEncodedParams.length
              : ''
        }}
      </span>
    </template>
    <div class="body-params flex flex-wrap">
      <ElRadioGroup v-model="bodyType" size="small">
        <ElRadioButton value="none">none</ElRadioButton>
        <ElRadioButton value="form-data">form-data</ElRadioButton>
        <ElRadioButton value="x-www-form-urlencoded">
          x-www-form-urlencoded
        </ElRadioButton>
        <ElRadioButton value="json">json</ElRadioButton>
        <ElRadioButton value="raw">raw</ElRadioButton>
        <ElRadioButton value="binary">binary</ElRadioButton>
        <ElRadioButton value="xml">xml</ElRadioButton>
      </ElRadioGroup>
    </div>
    <div
      v-if="bodyType === 'none'"
      class="my-2 border py-8 text-center text-sm text-inherit"
    >
      该请求没有 Body 体
    </div>

    <div class="body-editor">
      <template v-if="bodyType === 'form-data'">
        <params-table :table-data="formDataParams" show-content-type />
      </template>

      <template v-if="bodyType === 'x-www-form-urlencoded'">
        <params-table :table-data="urlEncodedParams" show-content-type />
      </template>

      <template v-if="bodyType === 'json'">
        <JsonView
          ref="editorRef"
          :one-of="true"
          :data="requestBodyExample"
          :descriptions="{}"
          :read-only="false"
        />
      </template>

      <template v-if="bodyType === 'raw'">
        <JsonView
          ref="editorRef"
          :data="requestBodyExample"
          :descriptions="{}"
          :read-only="false"
          language="null"
        />
      </template>

      <template v-if="bodyType === 'xml'">
        <JsonView
          ref="editorRef"
          :data="requestBodyXMLExample"
          :descriptions="{}"
          :read-only="false"
          language="xml"
        />
      </template>

      <template v-if="bodyType === 'binary'">
        <ElUpload
          ref="uploadRef"
          v-model:file-list="fileList"
          class="w-full"
          action="#"
          :limit="1"
          :on-exceed="handleExceed"
          :auto-upload="false"
        >
          <ElButton plain size="small" class="w-full">Upload</ElButton>
        </ElUpload>
      </template>
    </div>
  </ElTabPane>
</template>

<style lang="scss" scoped>
.body-params {
  :deep(.el-radio-button) {
    padding: 0 6px 6px;

    .el-radio-button__inner {
      border: 1px solid var(--el-border-color);
      border-radius: var(--el-border-radius-base);
    }
  }
}

:deep(.w-full .el-upload) {
  width: 100%;
}
</style>
