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
interface ParamsType {
  enabled: boolean;
  name: string;
  value: string;
  format?: string;
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
  if (props.requestBody === undefined) {
    bodyType.value = 'none';
  } else if (props.requestBody.content['application/json']) {
    const properties =
      props.requestBody.content['application/json'].schema?.properties ?? {};
    const file = Object.keys(properties).find(
      (item) => properties[item].format === 'binary',
    );
    if (file) {
      bodyType.value = 'form-data';
      // eslint-disable-next-line vue/no-mutating-props
      props.formDataParams.push({
        name: file,
        enabled: true,
        value: '',
        format: 'binary',
      });
    } else {
      bodyType.value = 'json';
    }
  }
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
        class="highlight circle"
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
        <params-table :table-data="formDataParams" />
      </template>

      <template v-if="bodyType === 'x-www-form-urlencoded'">
        <params-table :table-data="urlEncodedParams" />
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
