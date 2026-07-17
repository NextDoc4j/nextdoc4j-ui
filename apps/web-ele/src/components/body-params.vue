<script lang="ts" setup>
import type { UploadInstance, UploadProps, UploadRawFile } from 'element-plus';

import type { BodySchemaValidationIssue } from '#/utils/body-schema-validation';

import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';

import { SvgDocumentOmittedIcon } from '@vben/icons';

import {
  ElButton,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElTabPane,
  ElUpload,
  genFileId,
} from 'element-plus';
import X2JS from 'x2js';

import {
  formatBodyEnumValidationMessage,
  hasBodyEnumConstraints,
  validateBodyEnumValues,
} from '#/utils/body-schema-validation';
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
interface BodyValidationResult {
  issues: BodySchemaValidationIssue[];
  message: string;
  valid: boolean;
}
export interface ParamsType {
  __rowKey?: string;
  enum?: Array<number | string>;
  enabled: boolean;
  name: string;
  value: any;
  fileList?: any[];
  required?: boolean;
  format?: string;
  type?: string;
  description?: string;
  contentType?: string;
  schema?: {
    enum?: Array<number | string>;
    format?: string;
    items?: {
      enum?: Array<number | string>;
      format?: string;
    };
    type?: string;
    'x-nextdoc4j-enum'?: {
      items?: Array<{ description?: string; value: number | string }>;
    };
  };
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

// Body 类型切换项：与请求/响应内联 Tab 一致，宽度不足时溢出收进「···」下拉
const BODY_TYPE_OPTIONS: Array<{ label: string; value: BodyType }> = [
  { label: 'none', value: 'none' },
  { label: 'form-data', value: 'form-data' },
  { label: 'x-www-form-urlencoded', value: 'x-www-form-urlencoded' },
  { label: 'json', value: 'json' },
  { label: 'raw', value: 'raw' },
  { label: 'binary', value: 'binary' },
  { label: 'xml', value: 'xml' },
];
const BODY_TYPE_OVERFLOW_GAP = 6;

const bodyTypeHostRef = ref<HTMLElement>();
const bodyTypeMoreMeasureRef = ref<HTMLElement>();
// 隐藏测量层里各切换项的真实宽度节点，供溢出计算使用
const bodyTypeMeasureRefs = new Map<string, HTMLElement>();
// 当前宽度下可直接展示的切换项 key；null 表示尚未测量，先全部展示
const bodyTypeVisibleKeys = ref<null | string[]>(null);
// 从「···」折叠下拉里选出的项：钉在可见区最右侧；点击已可见项不会改变它
const promotedBodyType = ref<BodyType | null>(null);
let bodyTypeResizeObserver: null | ResizeObserver = null;
let bodyTypeOverflowRaf: null | number = null;

const setBodyTypeMeasureRef = (key: string, el: null | unknown) => {
  if (el instanceof HTMLElement) {
    bodyTypeMeasureRefs.set(key, el);
  } else {
    bodyTypeMeasureRefs.delete(key);
  }
};

/**
 * 计算当前容器宽度下按顺序展示的 Body 类型切换项。
 * 基础布局：从左往右按原始顺序尽量塞入，放不下的收进「···」下拉。
 * 被提升项（promotedKey，来自下拉选择）先在最右侧占位，其余项再从左依次填充剩余空间。
 * 返回的 key 列表已是最终展示顺序（被提升项排在末尾）。
 */
const resolveBodyTypeVisibleKeys = () => {
  const keys = BODY_TYPE_OPTIONS.map((option) => option.value);
  const host = bodyTypeHostRef.value;
  const promotedKey = promotedBodyType.value;
  if (!host) {
    return keys;
  }

  const containerWidth = host.clientWidth;
  if (!containerWidth) {
    return keys;
  }

  const getTabWidth = (key: string) => {
    const width =
      bodyTypeMeasureRefs.get(key)?.getBoundingClientRect().width ?? 0;
    return Math.max(40, Math.ceil(width) || 60);
  };

  const totalWidth =
    keys.reduce((sum, key) => sum + getTabWidth(key), 0) +
    BODY_TYPE_OVERFLOW_GAP * Math.max(0, keys.length - 1);
  if (totalWidth <= containerWidth) {
    return keys;
  }

  const moreWidth = Math.max(
    24,
    Math.ceil(
      bodyTypeMoreMeasureRef.value?.getBoundingClientRect().width ?? 0,
    ) || 28,
  );

  // 判断一组 key（含末尾被提升项，需为「···」预留宽度）能否放入容器
  const canFit = (candidateKeys: string[]) => {
    if (candidateKeys.length === 0) {
      return true;
    }
    const tabsWidth = candidateKeys.reduce(
      (sum, key) => sum + getTabWidth(key),
      0,
    );
    const tabsGap =
      BODY_TYPE_OVERFLOW_GAP * Math.max(0, candidateKeys.length - 1);
    // 溢出态必然存在「···」按钮，始终为其预留宽度与间距
    return (
      tabsWidth + tabsGap + BODY_TYPE_OVERFLOW_GAP + moreWidth <= containerWidth
    );
  };

  const hasPromoted = Boolean(promotedKey && keys.includes(promotedKey));
  // 顺序填充候选项（排除被提升项，它固定在最右）
  const fillKeys = hasPromoted
    ? keys.filter((key) => key !== promotedKey)
    : keys;

  const visibleKeys: string[] = [];
  fillKeys.forEach((key) => {
    // 被提升项占用最右一格，候选组合需带上它一起校验宽度
    const candidate = hasPromoted
      ? [...visibleKeys, key, promotedKey as string]
      : [...visibleKeys, key];
    if (canFit(candidate)) {
      visibleKeys.push(key);
    }
  });

  if (hasPromoted) {
    // 极窄场景下连一个填充项都放不下时，至少保留被提升项
    return [...visibleKeys, promotedKey as string];
  }
  return visibleKeys;
};

// 直接展示的切换项，顺序与 resolveBodyTypeVisibleKeys 返回一致（被提升项在最右）
const visibleBodyTypeOptions = computed(() => {
  if (!bodyTypeVisibleKeys.value) {
    return BODY_TYPE_OPTIONS;
  }
  const optionMap = new Map(
    BODY_TYPE_OPTIONS.map((option) => [option.value, option]),
  );
  return bodyTypeVisibleKeys.value
    .map((key) => optionMap.get(key as BodyType))
    .filter((option) => option !== undefined);
});

// 溢出收纳进「···」下拉的切换项（保持原始顺序）
const hiddenBodyTypeOptions = computed(() => {
  const visibleKeySet = new Set(
    visibleBodyTypeOptions.value.map((option) => option.value),
  );
  return BODY_TYPE_OPTIONS.filter((option) => !visibleKeySet.has(option.value));
});

const updateBodyTypeOverflow = () => {
  bodyTypeVisibleKeys.value = resolveBodyTypeVisibleKeys();
};

const scheduleBodyTypeOverflow = () => {
  if (typeof window === 'undefined') {
    updateBodyTypeOverflow();
    return;
  }
  if (bodyTypeOverflowRaf) {
    window.cancelAnimationFrame(bodyTypeOverflowRaf);
  }
  bodyTypeOverflowRaf = window.requestAnimationFrame(() => {
    bodyTypeOverflowRaf = null;
    updateBodyTypeOverflow();
  });
};

/**
 * 点击已可见的切换项：仅改变选中态，不触发提升，基础布局保持不变。
 */
const handleBodyTypeSelect = (value: BodyType) => {
  bodyType.value = value;
};

/**
 * 从「···」折叠下拉里选择：将该项提升到可见区最右侧，右侧原可见项按需挤入折叠。
 */
const handleBodyTypeDropdownSelect = (value: BodyType) => {
  promotedBodyType.value = value;
  bodyType.value = value;
  scheduleBodyTypeOverflow();
};

// Raw 请求体
const editorRef = ref();
const uploadRef = ref<UploadInstance>();
const fileList = ref([]);
const textBodyDrafts = ref<Partial<Record<TextBodyType, string>>>({});
const textBodyValidationMessage = ref('');
let textBodyValidationTimer: null | number = null;
let bodyParamRowKeySeed = 0;

const createBodyParamRowKey = () => `body-param-row-${bodyParamRowKeySeed++}`;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return Object.prototype.toString.call(value) === '[object Object]';
};

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

const mergeStructuredDataWithExample = (
  exampleData: unknown,
  currentData: unknown,
): unknown => {
  if (currentData === null || currentData === undefined) {
    return exampleData;
  }

  if (exampleData === null || exampleData === undefined) {
    return currentData;
  }

  if (Array.isArray(exampleData)) {
    return Array.isArray(currentData) ? currentData : exampleData;
  }

  if (isPlainObject(exampleData)) {
    if (!isPlainObject(currentData)) {
      return currentData;
    }

    const merged: Record<string, unknown> = {};
    Object.keys(exampleData).forEach((key) => {
      merged[key] = mergeStructuredDataWithExample(
        exampleData[key],
        currentData[key],
      );
    });
    return merged;
  }

  return currentData;
};

const resolveMergedStructuredData = (structuredData: unknown) => {
  if (structuredData === null || structuredData === undefined) {
    return structuredData;
  }
  return mergeStructuredDataWithExample(
    requestBodyExample.value,
    structuredData,
  );
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

const createBodyValidationResult = (
  issues: BodySchemaValidationIssue[] = [],
  message = formatBodyEnumValidationMessage(issues),
): BodyValidationResult => ({
  issues,
  message,
  valid: issues.length === 0 && !message,
});

const validateTextBodyValue = (
  type: TextBodyType,
  source: string,
): BodyValidationResult => {
  const schema = resolveCurrentRequestSchema();
  if (!schema) {
    return createBodyValidationResult();
  }

  const text = `${source || ''}`.trim();
  if (!text) {
    return createBodyValidationResult();
  }

  let structuredData: unknown;
  if (type === 'xml') {
    const xmlDoc = new DOMParser().parseFromString(text, 'application/xml');
    if (xmlDoc.querySelector('parsererror')) {
      return createBodyValidationResult([], 'XML 格式错误，无法校验 Body 参数');
    }
    structuredData = parseStructuredText(type, text);
    if (isPlainObject(structuredData)) {
      const dataKeys = Object.keys(structuredData);
      const schemaProperties = schema.properties || {};
      const hasDirectSchemaField = dataKeys.some((key) =>
        Object.hasOwn(schemaProperties, key),
      );
      if (dataKeys.length === 1 && !hasDirectSchemaField) {
        structuredData = structuredData[dataKeys[0] as string];
      }
    }
  } else {
    try {
      structuredData = JSON.parse(text);
    } catch {
      if (type === 'raw' && !schema.properties && !schema.items) {
        structuredData = text;
      } else if (type === 'raw' && !hasBodyEnumConstraints(schema)) {
        return createBodyValidationResult();
      } else {
        const format =
          type === 'raw' ? 'Raw 内容不是有效的 JSON' : 'JSON 格式错误';
        return createBodyValidationResult(
          [],
          `${format}，无法按请求 Schema 校验`,
        );
      }
    }
  }

  return createBodyValidationResult(
    validateBodyEnumValues(structuredData, schema),
  );
};

const clearTextBodyValidationTimer = () => {
  if (textBodyValidationTimer !== null) {
    window.clearTimeout(textBodyValidationTimer);
    textBodyValidationTimer = null;
  }
};

const applyTextBodyValidation = (
  type: TextBodyType,
  source: string,
): BodyValidationResult => {
  const result = validateTextBodyValue(type, source);
  textBodyValidationMessage.value = result.message;
  return result;
};

const scheduleTextBodyValidation = (type: TextBodyType, source: string) => {
  clearTextBodyValidationTimer();
  textBodyValidationTimer = window.setTimeout(() => {
    textBodyValidationTimer = null;
    if (bodyType.value === type) {
      applyTextBodyValidation(type, source);
    }
  }, 300);
};

const validateCurrentBody = (): BodyValidationResult => {
  clearTextBodyValidationTimer();
  const currentType = bodyType.value;
  if (!isTextBodyType(currentType)) {
    textBodyValidationMessage.value = '';
    return createBodyValidationResult();
  }
  const source = editorRef.value?.getEditorValue?.() ?? '';
  return applyTextBodyValidation(currentType, source);
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

const handleBodyChange = (value: string) => {
  const currentType = bodyType.value;
  if (isTextBodyType(currentType)) {
    setTextBodyDraft(currentType, value);
    scheduleTextBodyValidation(currentType, value);
  }
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
        __rowKey: previous?.__rowKey || createBodyParamRowKey(),
        contentType: inferContentType(property.type, fieldFormat),
        description: property.description,
        enabled: previous?.enabled ?? required,
        enum: property.enum,
        fileList: previous?.fileList ?? [],
        format: fieldFormat,
        name: key,
        required,
        // 保留完整字段 Schema，枚举选项、扩展枚举说明及数组项元数据
        // 都由通用参数表统一解析。
        schema: property,
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
    return type === 'json' ? JSON.stringify(example) : example;
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
  const mergedStructuredData = resolveMergedStructuredData(structuredData);

  if (type === 'xml') {
    if (mergedStructuredData !== null && mergedStructuredData !== undefined) {
      try {
        const xml = x2js.js2xml(mergedStructuredData);
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

  if (mergedStructuredData !== null && mergedStructuredData !== undefined) {
    if (type === 'json') {
      try {
        return JSON.stringify(mergedStructuredData, null, 2) ?? '';
      } catch {
        return resolveEditorValueByBodyType(type);
      }
    }
    return normalizeStructuredValue(mergedStructuredData);
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
  // 程序性同步（切换接口等）恢复默认布局，清除下拉提升态
  promotedBodyType.value = null;
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
    return;
  }

  if (options.preserveValue && isTextBodyType(bodyType.value)) {
    const currentType = bodyType.value;
    const structuredData = resolveStructuredDataFromBody(currentType);

    if (structuredData !== null && structuredData !== undefined) {
      const nextValue = resolveNextTextValue(
        currentType,
        structuredData,
        resolveCurrentTextValue(currentType),
        currentType,
      );
      setTextBodyDraft(currentType, nextValue);
      await setEditorValue(nextValue);
    }
  }
};

watch(
  bodyType,
  async (nextType, previousType) => {
    if (!nextType || nextType === previousType) {
      return;
    }

    clearTextBodyValidationTimer();
    textBodyValidationMessage.value = '';
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

  // 容器宽度变化时（如拖动分栏）重算 Body 类型切换项的溢出折叠
  if (typeof ResizeObserver !== 'undefined' && bodyTypeHostRef.value) {
    bodyTypeResizeObserver = new ResizeObserver(scheduleBodyTypeOverflow);
    bodyTypeResizeObserver.observe(bodyTypeHostRef.value);
  }
  scheduleBodyTypeOverflow();
});

onBeforeUnmount(() => {
  clearTextBodyValidationTimer();
  bodyTypeResizeObserver?.disconnect();
  bodyTypeResizeObserver = null;
  if (bodyTypeOverflowRaf) {
    window.cancelAnimationFrame(bodyTypeOverflowRaf);
    bodyTypeOverflowRaf = null;
  }
});

// 选中项变化后重算布局（提升逻辑由下拉选择单独维护，此处仅同步溢出计算）
watch(bodyType, () => {
  scheduleBodyTypeOverflow();
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
  focusEditor: focusJsonEditor,
  getTextBodyDrafts: () => ({ ...textBodyDrafts.value }),
  getExample,
  validateCurrentBody,
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
      <div class="body-params">
        <!-- Body 类型切换：宽度不足时溢出项收进「···」下拉，从下拉选出的项固定在最右侧 -->
        <div ref="bodyTypeHostRef" class="body-type-switch">
          <button
            v-for="option in visibleBodyTypeOptions"
            :key="option.value"
            type="button"
            class="body-type-tab"
            :class="{ 'body-type-tab--active': bodyType === option.value }"
            @click="handleBodyTypeSelect(option.value)"
          >
            {{ option.label }}
          </button>

          <ElDropdown
            v-if="hiddenBodyTypeOptions.length > 0"
            trigger="click"
            placement="bottom-end"
            @command="handleBodyTypeDropdownSelect($event)"
          >
            <button
              type="button"
              class="body-type-tab body-type-tab--more"
              :class="{
                'body-type-tab--active': hiddenBodyTypeOptions.some(
                  (option) => option.value === bodyType,
                ),
              }"
            >
              <SvgDocumentOmittedIcon class="body-type-tab__more-icon" />
            </button>

            <template #dropdown>
              <ElDropdownMenu>
                <ElDropdownItem
                  v-for="option in hiddenBodyTypeOptions"
                  :key="option.value"
                  :command="option.value"
                  :class="{ 'is-active': bodyType === option.value }"
                >
                  {{ option.label }}
                </ElDropdownItem>
              </ElDropdownMenu>
            </template>
          </ElDropdown>
        </div>

        <!-- 隐藏测量层：常驻渲染全部切换项供溢出计算真实宽度 -->
        <div class="body-type-measure" aria-hidden="true">
          <button
            v-for="option in BODY_TYPE_OPTIONS"
            :key="`measure-${option.value}`"
            type="button"
            class="body-type-tab"
            :ref="(el) => setBodyTypeMeasureRef(option.value, el)"
          >
            {{ option.label }}
          </button>
          <button
            ref="bodyTypeMoreMeasureRef"
            type="button"
            class="body-type-tab body-type-tab--more"
          >
            <SvgDocumentOmittedIcon class="body-type-tab__more-icon" />
          </button>
        </div>
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

        <div
          v-if="isTextBodyType(bodyType) && textBodyValidationMessage"
          class="body-validation-error"
          role="alert"
        >
          {{ textBodyValidationMessage }}
        </div>
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
  margin-bottom: 12px;
}

/* Body 类型切换：单行不换行，宽度不足时溢出项收进「···」下拉 */
.body-type-switch {
  display: flex;
  flex-wrap: nowrap;
  gap: 6px;
  align-items: center;
  min-width: 0;
  overflow: hidden;
}

.body-type-tab {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
  color: var(--el-text-color-regular);
  white-space: nowrap;
  cursor: pointer;
  background: transparent;
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-base);
  transition:
    color 0.14s ease,
    background-color 0.14s ease,
    border-color 0.14s ease;
}

.body-type-tab:hover {
  color: var(--el-color-primary);
  border-color: var(--el-color-primary-light-5);
}

.body-type-tab--active {
  color: var(--el-color-white);
  background: var(--el-color-primary);
  border-color: var(--el-color-primary);
}

.body-type-tab--active:hover {
  color: var(--el-color-white);
  border-color: var(--el-color-primary);
}

.body-type-tab--more {
  width: 28px;
  padding: 0;
}

.body-type-tab__more-icon {
  width: 16px;
  height: 16px;
}

/* 隐藏测量层：不参与布局，仅供溢出计算真实宽度 */
.body-type-measure {
  position: fixed;
  top: -9999px;
  left: -9999px;
  display: flex;
  visibility: hidden;
  gap: 6px;
  pointer-events: none;
}

.body-editor {
  position: relative;
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

.body-validation-error {
  position: absolute;
  right: 12px;
  bottom: 10px;
  left: 12px;
  z-index: 12;
  flex: none;
  max-height: 58px;
  padding: 7px 10px;
  overflow: auto;
  font-size: 12px;
  line-height: 18px;
  color: var(--el-color-danger);
  overflow-wrap: anywhere;
  background: var(--el-color-danger-light-9);
  border: 1px solid var(--el-color-danger-light-7);
  border-radius: 4px;
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
