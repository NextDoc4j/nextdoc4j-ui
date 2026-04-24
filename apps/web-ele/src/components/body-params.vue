<script lang="ts" setup>
import type { UploadInstance, UploadProps, UploadRawFile } from 'element-plus';

import { computed, nextTick, onMounted, ref, watch } from 'vue';

import {
  ElButton,
  ElRadioButton,
  ElRadioGroup,
  ElTabPane,
  ElUpload,
  genFileId,
} from 'element-plus';
import X2JS from 'x2js';

import {
  adaptSchemaForView,
  generateExample,
  hasRenderableSchema,
  parseSchemaRefName,
} from '#/utils/schema';

import JsonView from './json-view.vue';
import paramsTable from './params-table.vue';

const props = defineProps<{
  formDataParams: ParamsType[];
  requestBody: any;
  requestBodyType: string;
  requestBodyVariantState?: Record<string, number>;
  urlEncodedParams: ParamsType[];
}>();
const emit = defineEmits<{
  bodyChange: [];
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
type TextBodyType = 'json' | 'raw' | 'xml';
export interface ParamsType {
  enabled: boolean;
  name: string;
  value: string;
  fileList?: any[];
  required?: boolean;
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
const textBodyDrafts = ref<Partial<Record<TextBodyType, string>>>({});

const isTextBodyType = (type?: BodyType): type is TextBodyType => {
  return type === 'json' || type === 'raw' || type === 'xml';
};

const hasTextBodyDraft = (type: TextBodyType) => {
  return Object.prototype.hasOwnProperty.call(textBodyDrafts.value, type);
};

const setTextBodyDraft = (type: TextBodyType, value: string) => {
  textBodyDrafts.value = {
    ...textBodyDrafts.value,
    [type]: value,
  };
};

const pickRequestBodySchema = () => {
  const content = props.requestBody?.content;
  if (!content) {
    return null;
  }

  const entries = Object.entries(content);
  const hit = entries.find(([, body]) =>
    hasRenderableSchema((body as any)?.schema),
  );
  if (hit) {
    const [contentType, body] = hit;
    return { contentType, schema: (body as any)?.schema };
  }

  const first = entries[0];
  if (!first) {
    return null;
  }
  const [contentType, body] = first;
  return { contentType, schema: (body as any)?.schema ?? null };
};

const buildRequestBodyVariantKey = (schema: any, index: number) => {
  const refName = parseSchemaRefName(schema?.$ref);
  if (refName) {
    return `ref:${index}:${refName}`;
  }
  if (schema?.title) {
    return `title:${index}:${schema.title}`;
  }
  return `index:${index}`;
};

const isMatchedRequestBodyVariant = (item: any, selected: string) => {
  if (!selected || !item) {
    return false;
  }
  return item?.variantKey === selected || item?.title === selected;
};

const mergeComposedSchema = (baseSchema: any, pickedSchema: any) => {
  if (!pickedSchema || typeof pickedSchema !== 'object') {
    return baseSchema;
  }
  const merged: any = {
    ...baseSchema,
    ...pickedSchema,
  };
  if (baseSchema?.properties || pickedSchema?.properties) {
    merged.properties = {
      ...baseSchema?.properties,
      ...pickedSchema?.properties,
    };
  }
  const required = [
    ...(Array.isArray(baseSchema?.required) ? baseSchema.required : []),
    ...(Array.isArray(pickedSchema?.required) ? pickedSchema.required : []),
  ];
  if (required.length > 0) {
    merged.required = [...new Set(required)];
  }
  if (!merged.type && merged.properties) {
    merged.type = 'object';
  }
  return merged;
};

const applyPropertyVariantState = (schema: any) => {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  const state = props.requestBodyVariantState || {};
  const keys = Object.keys(state);
  if (keys.length <= 0) {
    return schema;
  }

  const nextSchema: any = structuredClone(schema);

  keys.forEach((path) => {
    if (!path.startsWith('$.')) {
      return;
    }

    const segments = path
      .slice(2)
      .split('.')
      .map((segment) => segment.trim())
      .filter(Boolean);

    if (segments.length <= 0) {
      return;
    }

    let cursor: any = nextSchema;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const segment = segments[i] as string;
      const nextNode = cursor?.properties?.[segment];
      if (!nextNode || typeof nextNode !== 'object') {
        cursor = null;
        break;
      }
      cursor = nextNode;
      if (
        cursor?.type === 'array' &&
        cursor?.items &&
        i < segments.length - 1
      ) {
        cursor = cursor.items;
      }
    }

    if (!cursor || typeof cursor !== 'object') {
      return;
    }

    const targetKey = segments[segments.length - 1] as string;
    const current = cursor?.properties?.[targetKey];
    if (!current || typeof current !== 'object') {
      return;
    }

    const currentIndex = state[path];
    const resolveByKeyword = (keyword: 'anyOf' | 'oneOf') => {
      const options = current?.[keyword];
      if (!Array.isArray(options) || options.length <= 0) {
        return null;
      }
      const picked =
        options[
          typeof currentIndex === 'number' &&
          currentIndex >= 0 &&
          currentIndex < options.length
            ? currentIndex
            : 0
        ] || options[0];
      const base = {
        ...current,
      } as any;
      delete base.oneOf;
      delete base.anyOf;
      delete base.allOf;
      delete base['x-nextdoc4j-allOfMerged'];
      return mergeComposedSchema(base, picked);
    };

    const byOneOf = resolveByKeyword('oneOf');
    if (byOneOf) {
      cursor.properties[targetKey] = byOneOf;
      return;
    }

    const byAnyOf = resolveByKeyword('anyOf');
    if (byAnyOf) {
      cursor.properties[targetKey] = byAnyOf;
    }
  });

  return nextSchema;
};

// 获取请求体数据
const resolvedRequestBody = computed(() => {
  const picked = pickRequestBodySchema();
  const schema = picked?.schema;
  if (!schema) {
    return null;
  }

  const toTitle = (item: any, fallback: string) => {
    return item?.title || parseSchemaRefName(item?.$ref) || fallback;
  };

  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return schema.oneOf
      .map((item: any, index: number) => {
        const resolved = adaptSchemaForView(item, { mode: 'request' });
        if (!resolved) {
          return null;
        }
        return {
          ...resolved,
          description: resolved.description || item?.description || '',
          title: toTitle(resolved, toTitle(item, `请求体方案 ${index + 1}`)),
          type: resolved.type || 'object',
          variantKey: buildRequestBodyVariantKey(item, index),
        };
      })
      .filter(Boolean);
  }

  const resolved = adaptSchemaForView(schema, { mode: 'request' });
  if (!resolved) {
    return null;
  }

  return {
    ...resolved,
    description: resolved.description || schema?.description || '',
    title: toTitle(resolved, toTitle(schema, '请求体')),
    type: resolved.type || 'object',
  };
});

// 请求体示例
const requestBodyExample = computed(() => {
  const schema = resolveCurrentRequestSchema();
  if (!schema) {
    return null;
  }
  return generateExample(schema, {
    mode: 'request',
  });
});

const requestBodyXMLExample = computed(() => {
  const data = x2js.js2xml(requestBodyExample.value);
  return `<?xml version="1.0" encoding="UTF-8"?><root>${data}</root>`;
});
const getExample = () => {
  return editorRef.value.getEditorValue();
};

const setEditorValue = async (value: string) => {
  await nextTick();
  editorRef.value?.setEditorValue?.(value ?? '');
};

const captureCurrentTextDraft = (type = bodyType.value) => {
  if (!isTextBodyType(type)) {
    return;
  }
  setTextBodyDraft(type, editorRef.value?.getEditorValue?.() ?? '');
};

const normalizeStructuredValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const parseStructuredText = (type: TextBodyType, value: string) => {
  const text = `${value || ''}`.trim();
  if (!text) {
    return null;
  }

  if (type === 'xml') {
    try {
      const parsed = x2js.xml2js(text);
      if (parsed && typeof parsed === 'object' && 'root' in parsed) {
        return (parsed as any).root;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const buildStructuredDataFromParams = (params: ParamsType[]) => {
  const result: Record<string, unknown> = {};
  let hasValue = false;

  params.forEach((item) => {
    if (!item.name || item.value === '' || item.value === undefined) {
      return;
    }
    hasValue = true;
    const value = `${item.value}`.trim();
    if (!value) {
      result[item.name] = '';
      return;
    }
    try {
      result[item.name] = JSON.parse(value);
    } catch {
      result[item.name] = item.value;
    }
  });

  return hasValue ? result : null;
};

const fillParamsFromStructuredData = (params: ParamsType[], data: unknown) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return;
  }

  params.forEach((item) => {
    if (!item.name || !Object.hasOwn(data, item.name)) {
      return;
    }
    item.value = normalizeStructuredValue(
      (data as Record<string, unknown>)[item.name],
    );
  });
};

const resolveStructuredDataFromBody = (type = bodyType.value) => {
  if (isTextBodyType(type)) {
    const currentText =
      editorRef.value?.getEditorValue?.() ?? textBodyDrafts.value[type] ?? '';
    return parseStructuredText(type, currentText);
  }

  if (type === 'form-data') {
    return buildStructuredDataFromParams(props.formDataParams);
  }

  if (type === 'x-www-form-urlencoded') {
    return buildStructuredDataFromParams(props.urlEncodedParams);
  }

  return null;
};

const handleBodyChange = () => {
  captureCurrentTextDraft();
  emit('bodyChange');
};

const focusJsonEditor = () => {
  if (!['json', 'raw', 'xml'].includes(bodyType.value || '')) {
    return;
  }
  editorRef.value?.focusEditor?.();
};

const handleExceed: UploadProps['onExceed'] = (files) => {
  uploadRef.value!.clearFiles();
  const file = files[0] as UploadRawFile;
  file.uid = genFileId();
  uploadRef.value!.handleStart(file);
};

const resolveCurrentRequestSchema = () => {
  const current = resolvedRequestBody.value;
  if (!current) {
    return null;
  }

  const selectedSchema = Array.isArray(current)
    ? current.find((item) =>
        isMatchedRequestBodyVariant(item, props.requestBodyType),
      ) ||
      current[0] ||
      null
    : current;

  if (!selectedSchema) {
    return null;
  }

  return applyPropertyVariantState(selectedSchema);
};

const detectPreferredBodyType = (
  contentType: string,
  schema: any,
): BodyType => {
  const normalizedContentType = `${contentType || ''}`.toLowerCase();

  let preferred: BodyType = 'none';
  if (normalizedContentType.includes('json')) {
    preferred = 'json';
  } else if (normalizedContentType.includes('multipart')) {
    preferred = 'form-data';
  } else if (normalizedContentType.includes('x-www-form-urlencoded')) {
    preferred = 'x-www-form-urlencoded';
  } else if (normalizedContentType.includes('xml')) {
    preferred = 'xml';
  } else if (normalizedContentType.includes('text/plain')) {
    preferred = 'raw';
  }

  const properties = schema?.properties ?? {};
  const hasBinaryField = Object.values(properties).some(
    (item: any) =>
      item?.format === 'binary' || item?.items?.format === 'binary',
  );
  if (hasBinaryField) {
    return 'form-data';
  }

  if (preferred === 'none') {
    return 'json';
  }
  return preferred;
};

const rebuildBodyParamsBySchema = (
  schema: any,
  options: { preserveValue?: boolean } = {},
) => {
  const preserveValue = options.preserveValue ?? true;
  const properties: Record<string, any> = schema?.properties ?? {};
  const requiredFields: string[] = Array.isArray(schema?.required)
    ? schema.required
    : [];

  const previousFormMap = new Map(
    (props.formDataParams || []).map((item) => [item.name, item]),
  );
  const previousUrlEncodedMap = new Map(
    (props.urlEncodedParams || []).map((item) => [item.name, item]),
  );

  const nextFormDataParams: ParamsType[] = Object.keys(properties).map(
    (key) => {
      const property = properties[key] || {};
      const previous = preserveValue ? previousFormMap.get(key) : undefined;
      const required = requiredFields.includes(key);
      const fieldFormat =
        property.type === 'array' ? property?.items?.format : property?.format;

      return {
        contentType: inferContentType(property.type, fieldFormat),
        description: property.description,
        enabled: previous?.enabled ?? required,
        fileList: previous?.fileList ?? [],
        format: fieldFormat,
        name: key,
        required,
        type: property.type,
        value: previous?.value ?? '',
      };
    },
  );

  const nextUrlEncodedParams: ParamsType[] = nextFormDataParams
    .filter((item) => item.format !== 'binary')
    .map((item) => {
      const previous = preserveValue
        ? previousUrlEncodedMap.get(item.name)
        : undefined;
      return {
        ...item,
        enabled: previous?.enabled ?? item.enabled,
        value: previous?.value ?? item.value,
      };
    });

  // eslint-disable-next-line vue/no-mutating-props
  props.formDataParams.splice(
    0,
    props.formDataParams.length,
    ...nextFormDataParams,
  );
  // eslint-disable-next-line vue/no-mutating-props
  props.urlEncodedParams.splice(
    0,
    props.urlEncodedParams.length,
    ...nextUrlEncodedParams,
  );
};

const resolveEditorValueByBodyType = (type: BodyType) => {
  if (type === 'xml') {
    return requestBodyXMLExample.value || '';
  }
  const example = requestBodyExample.value;
  if (example === null || example === undefined) {
    return '';
  }
  if (typeof example === 'string') {
    return example;
  }
  try {
    return JSON.stringify(example, null, 2);
  } catch {
    return String(example ?? '');
  }
};

const resolveCurrentTextValue = (type?: BodyType) => {
  if (!isTextBodyType(type)) {
    return '';
  }
  return (
    editorRef.value?.getEditorValue?.() ?? textBodyDrafts.value[type] ?? ''
  );
};

const resolveTextEditorData = (type: TextBodyType) => {
  if (hasTextBodyDraft(type)) {
    return textBodyDrafts.value[type] ?? '';
  }
  return resolveEditorValueByBodyType(type);
};

const resolveNextTextValue = (
  type: TextBodyType,
  structuredData: unknown,
  sourceText: string,
  previousType?: BodyType,
) => {
  if (hasTextBodyDraft(type)) {
    return textBodyDrafts.value[type] ?? '';
  }

  if (type === 'xml') {
    if (structuredData !== null && structuredData !== undefined) {
      try {
        const xml = x2js.js2xml(structuredData);
        return `<?xml version="1.0" encoding="UTF-8"?><root>${xml}</root>`;
      } catch {
        return resolveEditorValueByBodyType(type);
      }
    }
    if (sourceText) {
      return sourceText;
    }
    return resolveEditorValueByBodyType(type);
  }

  if (structuredData !== null && structuredData !== undefined) {
    return normalizeStructuredValue(structuredData);
  }

  if (sourceText) {
    return sourceText;
  }

  if (isTextBodyType(previousType) && hasTextBodyDraft(previousType)) {
    return textBodyDrafts.value[previousType] ?? '';
  }

  if (hasTextBodyDraft(type)) {
    return textBodyDrafts.value[type] ?? '';
  }

  return resolveEditorValueByBodyType(type);
};

const syncByRequestBodyType = async (
  options: { forceBodyType?: boolean; preserveValue?: boolean } = {},
) => {
  const picked = pickRequestBodySchema();
  if (!picked?.schema) {
    bodyType.value = 'none';
    // eslint-disable-next-line vue/no-mutating-props
    props.formDataParams.splice(0);
    // eslint-disable-next-line vue/no-mutating-props
    props.urlEncodedParams.splice(0);
    return;
  }

  const currentSchema =
    resolveCurrentRequestSchema() ||
    adaptSchemaForView(picked.schema, { mode: 'request' });
  rebuildBodyParamsBySchema(currentSchema, {
    preserveValue: options.preserveValue,
  });

  const preferredBodyType = detectPreferredBodyType(
    picked.contentType,
    currentSchema,
  );
  if (
    !bodyType.value ||
    bodyType.value === 'none' ||
    (options.forceBodyType && !options.preserveValue)
  ) {
    bodyType.value = preferredBodyType;
  }

  if (
    !options.preserveValue &&
    bodyType.value &&
    ['json', 'raw', 'xml'].includes(bodyType.value)
  ) {
    const nextValue = resolveEditorValueByBodyType(bodyType.value);
    setTextBodyDraft(bodyType.value as TextBodyType, nextValue);
    await setEditorValue(nextValue);
  }
};

watch(
  bodyType,
  async (nextType, previousType) => {
    if (!nextType || nextType === previousType) {
      return;
    }

    captureCurrentTextDraft(previousType);
    const structuredData = resolveStructuredDataFromBody(previousType);
    const sourceText = resolveCurrentTextValue(previousType);

    if (nextType === 'form-data') {
      if (
        structuredData &&
        typeof structuredData === 'object' &&
        !Array.isArray(structuredData)
      ) {
        fillParamsFromStructuredData(props.formDataParams, structuredData);
      }
      emit('bodyChange');
      return;
    }

    if (nextType === 'x-www-form-urlencoded') {
      if (
        structuredData &&
        typeof structuredData === 'object' &&
        !Array.isArray(structuredData)
      ) {
        fillParamsFromStructuredData(props.urlEncodedParams, structuredData);
      }
      emit('bodyChange');
      return;
    }

    if (!isTextBodyType(nextType)) {
      emit('bodyChange');
      return;
    }

    const nextValue = resolveNextTextValue(
      nextType,
      structuredData,
      sourceText,
      previousType,
    );
    setTextBodyDraft(nextType, nextValue);
    await setEditorValue(nextValue);
    emit('bodyChange');
  },
  { flush: 'sync' },
);

onMounted(async () => {
  await syncByRequestBodyType({
    forceBodyType: true,
    preserveValue: false,
  });
});

watch(
  () => props.requestBodyType,
  async () => {
    await syncByRequestBodyType({
      forceBodyType: true,
      preserveValue: true,
    });
  },
);

watch(
  () => JSON.stringify(props.requestBodyVariantState || {}),
  async () => {
    await syncByRequestBodyType({
      forceBodyType: true,
      preserveValue: false,
    });
  },
  { deep: true },
);
watch(
  () => props.requestBody,
  async () => {
    await syncByRequestBodyType({
      forceBodyType: true,
      preserveValue: false,
    });
  },
  { deep: true },
);

defineExpose({
  bodyType,
  getTextBodyDrafts: () => ({ ...textBodyDrafts.value }),
  getExample,
  setEditorValue,
  setTextBodyDrafts: (drafts: Partial<Record<TextBodyType, string>>) => {
    textBodyDrafts.value = { ...drafts };
  },
  fileList,
  syncByRequestBodyType,
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
    <div class="body-tab-content">
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

      <div v-else class="body-editor" @click.capture="focusJsonEditor">
        <template v-if="bodyType === 'form-data'">
          <params-table
            :table-data="formDataParams"
            show-content-type
            show-description-column
            show-delete-in-description
          />
        </template>

        <template v-if="bodyType === 'x-www-form-urlencoded'">
          <params-table
            :table-data="urlEncodedParams"
            show-content-type
            show-description-column
            show-delete-in-description
          />
        </template>

        <template v-if="bodyType === 'json'">
          <JsonView
            ref="editorRef"
            class="body-editor__json"
            :one-of="true"
            :data="resolveTextEditorData('json')"
            :descriptions="{}"
            :read-only="false"
            @change="handleBodyChange"
          />
        </template>

        <template v-if="bodyType === 'raw'">
          <JsonView
            ref="editorRef"
            class="body-editor__json"
            :data="resolveTextEditorData('raw')"
            :descriptions="{}"
            :read-only="false"
            language="null"
            @change="handleBodyChange"
          />
        </template>

        <template v-if="bodyType === 'xml'">
          <JsonView
            ref="editorRef"
            class="body-editor__json"
            :data="resolveTextEditorData('xml')"
            :descriptions="{}"
            :read-only="false"
            language="xml"
            @change="handleBodyChange"
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
    </div>
  </ElTabPane>
</template>

<style lang="scss" scoped>
.body-tab-content {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.body-params {
  :deep(.el-radio-button) {
    padding: 0 6px 6px;

    .el-radio-button__inner {
      border: 1px solid var(--el-border-color);
      border-radius: var(--el-border-radius-base);
    }
  }
}

.body-editor {
  display: flex;
  flex: 1;
  min-height: 0;
}

.body-editor > * {
  flex: 1;
  min-height: 0;
}

.body-editor__json {
  flex: 1;
  min-height: 100%;
}

:deep(.body-editor .json-viewer-ultimate),
:deep(.body-editor .json-viewer-ultimate > .flex),
:deep(.body-editor .json-viewer-ultimate > .json-view-main),
:deep(.body-editor .json-viewer-ultimate .json-editor-instance) {
  height: 100%;
  min-height: 0;
}

:deep(.w-full .el-upload) {
  width: 100%;
}
</style>
