<script lang="ts" setup>
import type { ParamsType } from './body-params.vue';

import type {
  ParameterObject,
  ResponseObject,
  SchemaObject,
  SecuritySchemeObject,
} from '#/typings/openApi';
import type { DetectedBase64Image } from '#/utils/base64-image';

import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue';

import { useAppConfig } from '@vben/hooks';
import {
  ApiTestRun,
  SvgAiCopyIcon,
  SvgApiPrefixIcon,
  SvgDocumentLayoutIcon,
  SvgDocumentOmittedIcon,
  SvgDocumentResetIcon,
  SvgGlobalConfigIcon,
} from '@vben/icons';
import { usePreferences } from '@vben/preferences';

import {
  ElButton,
  ElDialog,
  ElDrawer,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElEmpty,
  ElInput,
  ElMessage,
  ElTable,
  ElTableColumn,
  ElTabPane,
  ElTabs,
  ElTooltip,
} from 'element-plus';

import JsonViewer from '#/components/json-viewer/index.vue';
import MarkdownCodeBlock from '#/components/markdown-code-block.vue';
import XmlView from '#/components/xml-view.vue';
import { getMethodStyle } from '#/constants/methods';
import {
  ONLINE_DEBUG_TIMEOUT_MESSAGE,
  REQUEST_TIMEOUTS,
} from '#/constants/request-timeout';
import {
  useApiStore,
  useApiTestCacheStore,
  useDocManageStore,
  useTokenStore,
} from '#/store';
import { useAggregationStore } from '#/store/aggregation';
import { buildDebugPrompt } from '#/utils/ai-copy';
import {
  buildDetectedImageFileName,
  detectBase64ImagesInData,
  formatDetectedImageSize,
} from '#/utils/base64-image';
import { copyText } from '#/utils/clipboard';
import { adaptSchemaForView, hasRenderableSchema } from '#/utils/schema';

import bodyParams from './body-params.vue';
import GlobalConfigPanel from './global-config-panel.vue';
import paramsTable from './params-table.vue';
import SseEventList from './sse-event-list.vue';

const props = defineProps<{
  method: string;
  parameters: ParameterObject[];
  path: string;
  requestBody: any;
  requestBodyType: string;
  requestBodyVariantState?: Record<string, number>;
  responses?: Record<string, ResponseObject>;
  security: any;
}>();

defineEmits(['cancel']);

interface TableParamsObject {
  __rowKey?: string;
  contentType?: string;
  description?: string;
  enabled: boolean;
  fileList?: any[];
  format?: string;
  fromGlobal?: boolean;
  fromSecurity?: boolean;
  name: string;
  required?: boolean;
  value: any;
  type?: string;
}

type DebugBodyType =
  | 'binary'
  | 'form-data'
  | 'json'
  | 'none'
  | 'raw'
  | 'x-www-form-urlencoded'
  | 'xml';

interface DebugRequestStateSnapshot {
  activeTab: string;
  bodyContent?: string;
  bodyDrafts?: Partial<Record<'json' | 'raw' | 'xml', string>>;
  bodyType?: string;
  cacheVersion?: number;
  cookies: TableParamsObject[];
  formDataParams: TableParamsObject[];
  headers: TableParamsObject[];
  pathParams: TableParamsObject[];
  queryParams: TableParamsObject[];
  requestUrl: string;
  urlEncodedParams: TableParamsObject[];
}

interface DebugActualRequestSnapshot {
  bodyText: string;
  bodyType: string;
  headers: Array<{ name: string; value: string }>;
  method: string;
  pathParams: Array<{ name: string; value: string }>;
  queryParams: Array<{ name: string; value: string }>;
  url: string;
}

interface DebugInlineTab {
  count?: number;
  key: string;
  label: string;
}

// SSE（text/event-stream）单条事件的结构化表示
interface SseEvent {
  // data 字段原始文本（多行 data 以 \n 拼接）
  data: string;
  // event 字段名，缺省为 message
  event: string;
  // id 字段，可能不存在
  id?: string;
  // data 能被 JSON.parse 时的结构化结果，否则为 undefined
  parsed?: unknown;
  // 到达顺序序号，从 1 开始
  seq: number;
  // 到达时间，格式 HH:mm:ss.SSS
  time: string;
}

interface DebugBodyTabExpose {
  bodyType?: string;
  fileList?: any[];
  getExample?: () => string;
  getTextBodyDrafts?: () => Partial<Record<'json' | 'raw' | 'xml', string>>;
  setEditorValue?: (value: string) => Promise<void> | void;
  setTextBodyDrafts?: (
    drafts: Partial<Record<'json' | 'raw' | 'xml', string>>,
  ) => void;
  syncByRequestBodyType?: (options?: {
    forceBodyType?: boolean;
    preserveValue?: boolean;
  }) => Promise<void> | void;
}

const { apiURL } = useAppConfig(import.meta.env, import.meta.env.PROD);
const { isDark } = usePreferences();
const baseUrl = ref();
const activeTab = ref(props.requestBody ? 'Body' : 'Params');
const bodyTabRef = ref<DebugBodyTabExpose | null>(null);
const responseTab = ref('RealtimeResponse');
const base64ImageDrawerVisible = ref(false);
const realtimeResponseJsonRef = ref<InstanceType<typeof JsonViewer> | null>(
  null,
);
const realtimeResponseScrollTop = ref(0);
const paneLayout = ref<'horizontal' | 'vertical'>('horizontal');
const paneRatio = ref(0.52);
const debugLayoutRef = ref<HTMLElement>();
const isNarrowLayout = ref(false);
const isPaneResizing = ref(false);
const actualRequestSnapshot = ref<DebugActualRequestSnapshot | null>(null);
let removePaneResizeListeners: (() => void) | null = null;
const aggregationStore = useAggregationStore();
const docManageStore = useDocManageStore();
const apiTestCacheStore = useApiTestCacheStore();
const apiStore = useApiStore();
const tokenStore = useTokenStore();

// 组件状态
const loading = ref(false);
const responseLoading = ref(false);
const requestUrl = ref('');

const queryParams = ref<Array<TableParamsObject>>([]);
const pathParams = ref<Array<TableParamsObject>>([]);
const headers = ref<Array<TableParamsObject>>([]);
const cookies = ref<Array<TableParamsObject>>([]);
const isRestoringCache = ref(false);
const defaultRequestState = ref<DebugRequestStateSnapshot | null>(null);
// 全局配置弹窗（全局参数 + 全局认证）显示状态
const globalConfigVisible = ref(false);
let persistTimer: null | number = null;

const methodPillStyle = computed(() => {
  return getMethodStyle(props.method, isDark.value);
});

const normalizeParamName = (name: string) => name.trim();
const normalizeHeaderName = (name: string) => name.trim().toLowerCase();
const PATH_PLACEHOLDER_SEGMENT_RE = /^\{[^/{}]+\}$/;
const DEBUG_STACKED_BREAKPOINT = 720;
const DEBUG_REQUEST_CACHE_VERSION = 1;
let tableRowKeySeed = 0;

const createTableRowKey = () => `api-test-row-${tableRowKeySeed++}`;

const withTableRowKey = <T extends object>(item: T) => {
  return {
    ...item,
    __rowKey: (item as { __rowKey?: string }).__rowKey || createTableRowKey(),
  };
};

const splitRequestUrlParts = (url: string) => {
  const [pathAndSearch = '', hashFragment = ''] = `${url || ''}`.split('#', 2);
  const [pathname = '', searchQuery = ''] = pathAndSearch.split('?', 2);
  return {
    hash: hashFragment ? `#${hashFragment}` : '',
    pathname,
    search: searchQuery ? `?${searchQuery}` : '',
  };
};

const applyPathParamsToRequestUrl = (
  templateUrl: string,
  params: Array<Partial<TableParamsObject>> = pathParams.value,
) => {
  const { pathname, search, hash } = splitRequestUrlParts(templateUrl);
  let resolvedPathname = pathname;

  params.forEach((param) => {
    const name = normalizeParamName(param.name || '');
    if (!name) {
      return;
    }

    const placeholder = `{${name}}`;
    const rawValue =
      param.value === undefined || param.value === null ? '' : `${param.value}`;
    const nextSegment = rawValue ? encodeURIComponent(rawValue) : placeholder;
    resolvedPathname = resolvedPathname.replaceAll(placeholder, nextSegment);
  });

  return `${resolvedPathname}${search}${hash}`;
};

const normalizeRequestUrlTemplate = (
  inputUrl: string,
  currentTemplateUrl: string,
) => {
  const nextUrl = inputUrl || props.path;
  const currentTemplate = currentTemplateUrl || props.path;
  const currentParts = splitRequestUrlParts(currentTemplate);
  const nextParts = splitRequestUrlParts(nextUrl);
  const templateSegments = currentParts.pathname.split('/');
  const nextSegments = nextParts.pathname.split('/');

  const normalizedPathname = nextSegments
    .map((segment, index) => {
      const templateSegment = templateSegments[index];
      if (
        templateSegment &&
        PATH_PLACEHOLDER_SEGMENT_RE.test(templateSegment)
      ) {
        return templateSegment;
      }
      return segment;
    })
    .join('/');

  return `${normalizedPathname}${nextParts.search}${nextParts.hash}`;
};

const cacheKey = computed(() => {
  const serviceScope = aggregationStore.isAggregation
    ? aggregationStore.currentService?.url || '__aggregation__'
    : '__single__';
  return `${serviceScope}::${props.method.toUpperCase()}::${props.path}`;
});

const requestUrlDisplay = computed({
  get: () => applyPathParamsToRequestUrl(requestUrl.value || props.path),
  set: (value: string) => {
    requestUrl.value = normalizeRequestUrlTemplate(
      value,
      requestUrl.value || props.path,
    );
  },
});

const cloneTableParams = (
  items: Array<
    Partial<TableParamsObject> & { name?: string; value?: any }
  > = [],
) => {
  return items.map((item) =>
    withTableRowKey({
      ...item,
      contentType: item.contentType,
      description: item.description || '',
      enabled: item.enabled ?? true,
      format: item.format,
      fromGlobal: item.fromGlobal,
      fromSecurity: item.fromSecurity,
      name: item.name || '',
      required: item.required,
      type: item.type,
      value:
        typeof item.value === 'string' ||
        typeof item.value === 'number' ||
        typeof item.value === 'boolean'
          ? `${item.value}`
          : '',
    }),
  );
};

const mergeCachedTableParamsWithLatest = (
  latestItems: TableParamsObject[],
  cachedItems: TableParamsObject[],
  normalizeName = normalizeParamName,
) => {
  const cachedMap = new Map<string, TableParamsObject>();

  cachedItems.forEach((item) => {
    const key = normalizeName(item.name || '');
    if (!key || cachedMap.has(key)) {
      return;
    }
    cachedMap.set(key, item);
  });

  return latestItems.map((item) => {
    const key = normalizeName(item.name || '');
    const cached = key ? cachedMap.get(key) : undefined;

    if (!cached) {
      return withTableRowKey({ ...item });
    }

    return withTableRowKey({
      ...item,
      contentType: cached.contentType ?? item.contentType,
      enabled: cached.enabled ?? item.enabled,
      fileList: cached.fileList ?? item.fileList,
      value:
        Object.prototype.hasOwnProperty.call(cached, 'value') &&
        cached.value !== undefined
          ? cached.value
          : item.value,
    });
  });
};

const mergeCachedRequestState = (cachedState: DebugRequestStateSnapshot) => {
  const latestState = defaultRequestState.value ?? buildCurrentSnapshot();
  const latestLocalQueryParams = latestState.queryParams.filter(
    (item) => !item.fromGlobal && !item.fromSecurity,
  );
  const cachedLocalQueryParams = cachedState.queryParams.filter(
    (item) => !item.fromGlobal && !item.fromSecurity,
  );
  const shouldRestoreGeneratedJson =
    cachedState.cacheVersion !== DEBUG_REQUEST_CACHE_VERSION &&
    cachedState.bodyType === 'json' &&
    !cachedState.bodyContent?.trim() &&
    !cachedState.bodyDrafts?.json?.trim() &&
    Boolean(latestState.bodyContent?.trim());

  return {
    ...cachedState,
    bodyContent: shouldRestoreGeneratedJson
      ? latestState.bodyContent
      : cachedState.bodyContent,
    bodyDrafts: shouldRestoreGeneratedJson
      ? {
          ...cachedState.bodyDrafts,
          json: latestState.bodyDrafts?.json ?? latestState.bodyContent,
        }
      : cachedState.bodyDrafts,
    cacheVersion: DEBUG_REQUEST_CACHE_VERSION,
    formDataParams: mergeCachedTableParamsWithLatest(
      latestState.formDataParams,
      cachedState.formDataParams,
    ),
    queryParams: mergeCachedTableParamsWithLatest(
      latestLocalQueryParams,
      cachedLocalQueryParams,
    ),
    urlEncodedParams: mergeCachedTableParamsWithLatest(
      latestState.urlEncodedParams,
      cachedState.urlEncodedParams,
    ),
  };
};

const DEBUG_BODY_TYPES = new Set<DebugBodyType>([
  'binary',
  'form-data',
  'json',
  'none',
  'raw',
  'x-www-form-urlencoded',
  'xml',
]);

const toDebugBodyType = (value: unknown): DebugBodyType | undefined => {
  return DEBUG_BODY_TYPES.has(value as DebugBodyType)
    ? (value as DebugBodyType)
    : undefined;
};
const resetResponseState = () => {
  responseStatus.value = { code: 0, text: '-', type: 'default' };
  responseTime.value = 0;
  responseSize.value = '0 B';
  responseData.value = null;
  responseLanguage.value = 'json';
  base64ImageDrawerVisible.value = false;
  responseMimeType.value = '';
  responseHeaders.value = [];
  actualRequestSnapshot.value = null;
  isStreaming.value = false;
  sseAborted.value = false;
  sseEvents.value = [];
};

const resolveBodyContent = () => {
  const bodyType = bodyTabRef.value?.bodyType as DebugBodyType | undefined;
  if (!bodyType || !['json', 'raw', 'xml'].includes(bodyType)) {
    return '';
  }
  return bodyTabRef.value?.getExample?.() ?? '';
};

const buildCurrentSnapshot = (): DebugRequestStateSnapshot => {
  return {
    activeTab: activeTab.value,
    bodyContent: resolveBodyContent(),
    bodyDrafts: bodyTabRef.value?.getTextBodyDrafts?.() ?? {},
    bodyType: bodyTabRef.value?.bodyType,
    cacheVersion: DEBUG_REQUEST_CACHE_VERSION,
    cookies: cloneTableParams(cookies.value),
    formDataParams: cloneTableParams(formDataParams.value),
    headers: cloneTableParams(headers.value),
    pathParams: cloneTableParams(pathParams.value),
    queryParams: cloneTableParams(queryParams.value),
    requestUrl: requestUrl.value || props.path,
    urlEncodedParams: cloneTableParams(urlEncodedParams.value),
  };
};

const applySnapshot = async (
  snapshot: DebugRequestStateSnapshot,
  options: { syncGlobal?: boolean } = {},
) => {
  isRestoringCache.value = true;

  requestUrl.value = snapshot.requestUrl || props.path;
  activeTab.value =
    snapshot.activeTab || (props.requestBody ? 'Body' : 'Params');
  queryParams.value = cloneTableParams(snapshot.queryParams);
  pathParams.value = cloneTableParams(snapshot.pathParams);
  headers.value = cloneTableParams(snapshot.headers);
  cookies.value = cloneTableParams(snapshot.cookies);
  formDataParams.value = cloneTableParams(snapshot.formDataParams);
  urlEncodedParams.value = cloneTableParams(snapshot.urlEncodedParams);

  const snapshotBodyType = toDebugBodyType(snapshot.bodyType);
  bodyTabRef.value?.setTextBodyDrafts?.(snapshot.bodyDrafts ?? {});
  if (bodyTabRef.value && snapshotBodyType) {
    bodyTabRef.value.bodyType = snapshotBodyType;
    await nextTick();
    if (
      snapshot.bodyContent !== undefined &&
      ['json', 'raw', 'xml'].includes(snapshotBodyType)
    ) {
      await bodyTabRef.value.setEditorValue?.(snapshot.bodyContent);
    }
  }

  if (options.syncGlobal) {
    syncSecurityParamsToDebugTable();
    syncGlobalParamsToDebugTable();
  }

  isRestoringCache.value = false;
};

const flushPersistCache = () => {
  if (!apiTestCacheStore.debugCacheEnabled || isRestoringCache.value) {
    return;
  }
  if (persistTimer) {
    window.clearTimeout(persistTimer);
    persistTimer = null;
  }
  apiTestCacheStore.saveRequestCache(cacheKey.value, buildCurrentSnapshot());
};

const schedulePersistCache = () => {
  if (!apiTestCacheStore.debugCacheEnabled || isRestoringCache.value) {
    return;
  }
  if (persistTimer) {
    window.clearTimeout(persistTimer);
  }
  persistTimer = window.setTimeout(() => {
    flushPersistCache();
  }, 150);
};

const captureDefaultRequestState = async () => {
  await nextTick();
  defaultRequestState.value = buildCurrentSnapshot();
};

const restoreDefaultRequestState = async () => {
  if (!defaultRequestState.value) {
    return;
  }
  await applySnapshot(defaultRequestState.value, {
    syncGlobal: true,
  });
  apiTestCacheStore.removeRequestCache(cacheKey.value);
  resetResponseState();
};

const handlePageHide = () => {
  flushPersistCache();
};

const syncSelectedRequestBodyType = async (
  options: { forceBodyType?: boolean; preserveValue?: boolean } = {},
) => {
  if (!props.requestBody) {
    return;
  }
  await nextTick();
  await bodyTabRef.value?.syncByRequestBodyType?.({
    forceBodyType: options.forceBodyType ?? true,
    preserveValue: options.preserveValue ?? true,
  });
};
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

      const paramItem = withTableRowKey({
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
              'x-nextdoc4j-enum': (schema as any)['x-nextdoc4j-enum'],
              items: items
                ? {
                    enum: items.enum,
                    format: items.format,
                  }
                : undefined,
            }
          : undefined,
      });

      const targetArray = paramMap[param.in];
      if (targetArray) {
        targetArray.push(paramItem);
      }
    });

    syncSecurityParamsToDebugTable();
    syncGlobalParamsToDebugTable();
  },
  { immediate: true },
);

watch(
  () => [docManageStore.scopedParams, aggregationStore.currentService?.url],
  () => {
    syncSecurityParamsToDebugTable();
    syncGlobalParamsToDebugTable();
  },
  { deep: true, immediate: true },
);

watch(
  () => props.security,
  () => {
    syncSecurityParamsToDebugTable();
    syncGlobalParamsToDebugTable();
  },
  { deep: true },
);

watch(
  () => tokenStore.token,
  () => {
    syncSecurityParamsToDebugTable();
    syncGlobalParamsToDebugTable();
  },
  { deep: true },
);

// 响应状态
const responseStatus = ref({ code: 0, text: '-', type: 'default' });
const responseTime = ref(0);
const responseSize = ref('0 B');
const responseData = shallowRef<any>(null);
// 响应体高亮语言（json/xml/html/yaml/plaintext…），驱动实时响应的展示方式
const responseLanguage = ref('json');
const responseMimeType = ref('');
const responseHeaders = ref<
  Array<{ enabled: boolean; name: string; value: string }>
>([]);

// SSE 流式响应状态
const isStreaming = ref(false); // 是否正在接收 text/event-stream 流
const sseAborted = ref(false); // 是否被用户主动停止
const sseEvents = shallowRef<SseEvent[]>([]); // 已接收的 SSE 事件
// 当前进行中请求的中止控制器，供停止按钮及卸载时释放连接
let activeAbortController: AbortController | null = null;

const realtimeDetectedBase64Images = computed<DetectedBase64Image[]>(() => {
  if (responseStatus.value.type === 'default') {
    return [];
  }
  if (responseData.value === null || responseData.value === undefined) {
    return [];
  }
  return detectBase64ImagesInData(responseData.value);
});

const hasRealtimeBase64Images = computed(() => {
  return realtimeDetectedBase64Images.value.length > 0;
});

const pickContentSchema = (
  content?: Record<string, { schema?: SchemaObject }>,
) => {
  if (!content) return null;

  return (
    content['application/json']?.schema ||
    content['*/*']?.schema ||
    Object.values(content).find((item) => Boolean(item?.schema))?.schema ||
    null
  );
};

const findMatchedResponse = (statusCode: number) => {
  const responseMap = props.responses || {};
  const entries = Object.entries(responseMap);
  if (entries.length === 0) {
    return null;
  }

  const statusText = String(statusCode || '').trim();
  const familyKey = /^\d{3}$/.test(statusText) ? `${statusText[0]}xx` : '';
  const candidates = [
    statusText,
    familyKey.toUpperCase(),
    familyKey,
    'default',
  ].filter(Boolean);

  for (const candidate of candidates) {
    const exact = responseMap[candidate];
    if (exact) {
      return exact;
    }

    const fuzzy = entries.find(
      ([code]) => code.trim().toLowerCase() === candidate.trim().toLowerCase(),
    );
    if (fuzzy?.[1]) {
      return fuzzy[1];
    }
  }

  if (statusCode >= 200 && statusCode < 300 && responseMap['200']) {
    return responseMap['200'];
  }
  return entries[0]?.[1] || null;
};

const responseSchemaForViewer = computed(() => {
  if (responseStatus.value.type === 'default') {
    return null;
  }
  const matchedResponse = findMatchedResponse(responseStatus.value.code);
  const schema =
    pickContentSchema(matchedResponse?.content) || matchedResponse?.schema;
  if (!schema || !hasRenderableSchema(schema)) {
    return null;
  }
  const resolved = adaptSchemaForView(schema, { mode: 'response' });
  return resolved && hasRenderableSchema(resolved) ? resolved : null;
});

// XML 响应用原样 XML 树视图展示（保留标签/缩进，支持节点折叠与复制、背景透明）
const showResponseAsXml = computed(() => {
  return (
    responseLanguage.value === 'xml' &&
    typeof responseData.value === 'string' &&
    responseData.value !== ''
  );
});

// 其余字符串类响应（HTML/YAML/纯文本等）用代码块高亮展示；
// 对象类响应（JSON、form-urlencoded、二进制提示）走 JsonViewer 树形展示
const showResponseAsCode = computed(() => {
  return (
    !showResponseAsXml.value &&
    typeof responseData.value === 'string' &&
    responseData.value !== '' &&
    responseLanguage.value !== 'json'
  );
});

const activeGlobalQueryCount = computed(() => {
  return docManageStore
    .getMergedQueryParams(aggregationStore.currentService?.url)
    .filter((item) => item.enabled && item.name).length;
});

const activeGlobalHeaderCount = computed(() => {
  return docManageStore
    .getMergedHeaderParams(aggregationStore.currentService?.url)
    .filter((item) => item.enabled && item.name).length;
});

const requestBodyCount = computed(() => {
  const bodyType = bodyTabRef.value?.bodyType as DebugBodyType | undefined;
  if (bodyType === 'form-data') {
    return formDataParams.value.filter((item) => item.enabled && item.name)
      .length;
  }
  if (bodyType === 'x-www-form-urlencoded') {
    return urlEncodedParams.value.filter((item) => item.enabled && item.name)
      .length;
  }
  return 0;
});

const requestInlineTabs = computed<DebugInlineTab[]>(() => {
  return [
    {
      key: 'Params',
      label: 'Params',
      count: pathParams.value.length + queryParams.value.length,
    },
    {
      key: 'Body',
      label: 'Body',
      count: requestBodyCount.value,
    },
    {
      key: 'Headers',
      label: 'Headers',
      count: headers.value.length,
    },
    {
      key: 'Cookies',
      label: 'Cookies',
      count: cookies.value.length,
    },
  ];
});

// 是否为 SSE 响应：接收中或已接收到事件时以事件流形式展示
const isSseResponse = computed(
  () => isStreaming.value || sseEvents.value.length > 0,
);

const responseInlineTabs = computed<DebugInlineTab[]>(() => {
  return [
    isSseResponse.value
      ? {
          key: 'EventStream',
          label: '事件流',
          count: sseEvents.value.length,
        }
      : {
          key: 'RealtimeResponse',
          label: '实时响应',
        },
    {
      key: 'ResponseHeaders',
      label: '响应头',
      count: responseHeaders.value.length,
    },
    {
      key: 'ActualRequest',
      label: '实际请求',
    },
  ];
});

const requestTabsHostRef = ref<HTMLElement>();
const responseTabsHostRef = ref<HTMLElement>();
const requestMoreMeasureRef = ref<HTMLElement>();
const responseMoreMeasureRef = ref<HTMLElement>();
const requestVisibleTabKeys = ref<null | string[]>(null);
const responseVisibleTabKeys = ref<null | string[]>(null);
const requestTabMeasureRefs = new Map<string, HTMLElement>();
const responseTabMeasureRefs = new Map<string, HTMLElement>();
const TAB_OVERFLOW_GAP = 6;
let tabOverflowObserver: null | ResizeObserver = null;
let overflowRaf: null | number = null;

const setRequestTabMeasureRef = (key: string, el: null | unknown) => {
  if (el instanceof HTMLElement) {
    requestTabMeasureRefs.set(key, el);
  } else {
    requestTabMeasureRefs.delete(key);
  }
};

const setResponseTabMeasureRef = (key: string, el: null | unknown) => {
  if (el instanceof HTMLElement) {
    responseTabMeasureRefs.set(key, el);
  } else {
    responseTabMeasureRefs.delete(key);
  }
};

/**
 * 用途：计算内联 Tab 在当前容器宽度下可直接展示的 key。
 * 参数说明：options 包含激活项、容器元素、测量节点、更多按钮节点和完整 Tab 列表。
 * 返回值说明：返回可直接展示的 Tab key；空数组表示当前宽度仅展示更多按钮。
 */
const resolveOverflowVisibleKeys = (options: {
  activeKey: string;
  hostElement?: HTMLElement;
  measureRefs: Map<string, HTMLElement>;
  moreMeasureElement?: HTMLElement;
  tabs: DebugInlineTab[];
}) => {
  const { activeKey, hostElement, measureRefs, moreMeasureElement, tabs } =
    options;
  const keys = tabs.map((tab) => tab.key);
  if (keys.length === 0 || !hostElement) {
    return keys;
  }

  const containerWidth = hostElement.clientWidth;
  if (!containerWidth) {
    return keys;
  }

  const getTabWidth = (key: string) => {
    const width = measureRefs.get(key)?.getBoundingClientRect().width ?? 0;
    return Math.max(54, Math.ceil(width) || 72);
  };

  const moreWidth = Math.max(
    24,
    Math.ceil(moreMeasureElement?.getBoundingClientRect().width ?? 0) || 28,
  );

  const totalTabsWidth =
    keys.reduce((sum, key) => sum + getTabWidth(key), 0) +
    TAB_OVERFLOW_GAP * Math.max(0, keys.length - 1);
  if (totalTabsWidth <= containerWidth) {
    return keys;
  }

  const canFitWithMoreButton = (candidateKeys: string[]) => {
    const tabsWidth = candidateKeys.reduce(
      (sum, key) => sum + getTabWidth(key),
      0,
    );
    const tabsGap = TAB_OVERFLOW_GAP * Math.max(0, candidateKeys.length - 1);
    const moreGap = candidateKeys.length > 0 ? TAB_OVERFLOW_GAP : 0;
    return tabsWidth + tabsGap + moreGap + moreWidth <= containerWidth;
  };

  const visibleKeys: string[] = [];
  keys.forEach((key) => {
    const candidateKeys = [...visibleKeys, key];
    if (canFitWithMoreButton(candidateKeys)) {
      visibleKeys.push(key);
    }
  });

  if (
    activeKey &&
    keys.includes(activeKey) &&
    !visibleKeys.includes(activeKey)
  ) {
    const adjustedKeys = visibleKeys.filter((key) => key !== activeKey);
    while (
      adjustedKeys.length > 0 &&
      !canFitWithMoreButton([...adjustedKeys, activeKey])
    ) {
      adjustedKeys.pop();
    }
    if (canFitWithMoreButton([...adjustedKeys, activeKey])) {
      adjustedKeys.push(activeKey);
    } else {
      return [];
    }

    const keyIndexMap = new Map(keys.map((key, index) => [key, index]));
    adjustedKeys.sort((a, b) => {
      return (keyIndexMap.get(a) ?? 0) - (keyIndexMap.get(b) ?? 0);
    });
    return adjustedKeys;
  }

  return visibleKeys;
};

const requestVisibleTabs = computed(() => {
  const tabs = requestInlineTabs.value;
  if (!requestVisibleTabKeys.value) {
    return tabs;
  }
  const visibleKeySet = new Set(requestVisibleTabKeys.value);
  return tabs.filter((tab) => visibleKeySet.has(tab.key));
});

const requestHiddenTabs = computed(() => {
  const visibleKeySet = new Set(requestVisibleTabs.value.map((tab) => tab.key));
  return requestInlineTabs.value.filter((tab) => !visibleKeySet.has(tab.key));
});

const responseVisibleTabs = computed(() => {
  const tabs = responseInlineTabs.value;
  if (!responseVisibleTabKeys.value) {
    return tabs;
  }
  const visibleKeySet = new Set(responseVisibleTabKeys.value);
  return tabs.filter((tab) => visibleKeySet.has(tab.key));
});

const responseHiddenTabs = computed(() => {
  const visibleKeySet = new Set(
    responseVisibleTabs.value.map((tab) => tab.key),
  );
  return responseInlineTabs.value.filter((tab) => !visibleKeySet.has(tab.key));
});

const updateRequestTabOverflow = () => {
  requestVisibleTabKeys.value = resolveOverflowVisibleKeys({
    activeKey: activeTab.value,
    hostElement: requestTabsHostRef.value,
    measureRefs: requestTabMeasureRefs,
    moreMeasureElement: requestMoreMeasureRef.value,
    tabs: requestInlineTabs.value,
  });
};

const updateResponseTabOverflow = () => {
  responseVisibleTabKeys.value = resolveOverflowVisibleKeys({
    activeKey: responseTab.value,
    hostElement: responseTabsHostRef.value,
    measureRefs: responseTabMeasureRefs,
    moreMeasureElement: responseMoreMeasureRef.value,
    tabs: responseInlineTabs.value,
  });
};

const updateAllTabOverflow = () => {
  updateRequestTabOverflow();
  updateResponseTabOverflow();
};

const scheduleTabOverflowUpdate = () => {
  if (typeof window === 'undefined') {
    return;
  }
  if (overflowRaf) {
    window.cancelAnimationFrame(overflowRaf);
  }
  overflowRaf = window.requestAnimationFrame(() => {
    overflowRaf = null;
    updateAllTabOverflow();
  });
};

const syncTabOverflowObserver = () => {
  if (typeof ResizeObserver === 'undefined') {
    return;
  }
  tabOverflowObserver?.disconnect();
  tabOverflowObserver = new ResizeObserver(() => {
    scheduleTabOverflowUpdate();
  });
  if (requestTabsHostRef.value) {
    tabOverflowObserver.observe(requestTabsHostRef.value);
  }
  if (responseTabsHostRef.value) {
    tabOverflowObserver.observe(responseTabsHostRef.value);
  }
};

const handleRequestHiddenTabCommand = (command: number | string) => {
  activeTab.value = `${command}`;
  scheduleTabOverflowUpdate();
};

const handleResponseHiddenTabCommand = (command: number | string) => {
  responseTab.value = `${command}`;
  scheduleTabOverflowUpdate();
};

watch(
  () => [requestInlineTabs.value, activeTab.value],
  () => {
    scheduleTabOverflowUpdate();
  },
  { deep: true },
);

watch(
  () => [responseInlineTabs.value, responseTab.value],
  () => {
    scheduleTabOverflowUpdate();
  },
  { deep: true },
);

watch(
  () => responseTab.value,
  async (tab, previousTab) => {
    if (previousTab === 'RealtimeResponse') {
      realtimeResponseScrollTop.value =
        realtimeResponseJsonRef.value?.getScrollTop?.() ?? 0;
    }
    if (tab !== 'RealtimeResponse') {
      return;
    }
    await nextTick();
    realtimeResponseJsonRef.value?.setScrollTop?.(
      realtimeResponseScrollTop.value,
    );
  },
);

watch(hasRealtimeBase64Images, (hasImages) => {
  if (!hasImages) {
    base64ImageDrawerVisible.value = false;
  }
});

watch([() => requestTabsHostRef.value, () => responseTabsHostRef.value], () => {
  syncTabOverflowObserver();
  scheduleTabOverflowUpdate();
});

const isStackedLayout = computed(
  () => isNarrowLayout.value || paneLayout.value === 'vertical',
);
watch([paneRatio, isStackedLayout], () => {
  scheduleTabOverflowUpdate();
});
const layoutTooltipText = computed(() => {
  if (isNarrowLayout.value) {
    return '窄屏固定上下布局';
  }
  return isStackedLayout.value ? '切换为左右布局' : '切换为上下布局';
});
const responseStatusTone = computed(() => {
  if (responseStatus.value.type === 'success') return 'success';
  if (responseStatus.value.type === 'error') return 'error';
  return 'default';
});
const layoutGridStyle = computed(() => {
  if (isStackedLayout.value) {
    return {
      gridTemplateRows: `minmax(0, ${paneRatio.value}fr) 10px minmax(0, ${
        1 - paneRatio.value
      }fr)`,
    };
  }
  return {
    gridTemplateColumns: `minmax(0, ${paneRatio.value}fr) 10px minmax(0, ${
      1 - paneRatio.value
    }fr)`,
  };
});

async function handleCopyBaseUrl() {
  if (!baseUrl.value) {
    return;
  }
  const copied = await copyText(baseUrl.value);
  if (copied) {
    ElMessage.success('Base URL 已复制');
    return;
  }
  ElMessage.error('Base URL 复制失败');
}

/**
 * 复制在线调试的请求 / 响应 / 错误信息，便于粘贴给 Coding Agent 排查并修复代码
 */
async function handleCopyForAi() {
  const snapshot = actualRequestSnapshot.value;
  const hasResponse = responseStatus.value.type !== 'default';

  const resolveResponseBody = () => {
    if (responseData.value === null || responseData.value === undefined) {
      return '';
    }
    return typeof responseData.value === 'string'
      ? responseData.value
      : toPrettyJson(responseData.value);
  };
  const responseBody = resolveResponseBody();

  const prompt = buildDebugPrompt({
    method: props.method,
    url:
      snapshot?.url ||
      applyPathParamsToRequestUrl(requestUrl.value || props.path),
    headers: snapshot?.headers,
    queryParams: snapshot?.queryParams,
    pathParams: snapshot?.pathParams,
    bodyText: snapshot?.bodyText,
    bodyType: snapshot?.bodyType,
    responseStatus: hasResponse ? responseStatus.value.text : '',
    responseTime: hasResponse ? responseTime.value : '',
    responseSize: hasResponse ? responseSize.value : '',
    responseMime: hasResponse ? responseMimeType.value : '',
    responseBody,
    errorMessage:
      responseStatus.value.type === 'error' ? responseStatus.value.text : '',
  });

  const copied = await copyText(prompt);
  if (copied) {
    ElMessage.success('已复制调试信息，可粘贴给 Coding Agent');
    return;
  }
  ElMessage.error('复制失败');
}

const normalizeResizeRatio = (value: number) => {
  if (Number.isNaN(value)) return paneRatio.value;
  return Math.min(0.85, Math.max(0.15, value));
};

const clearPaneResizeListeners = () => {
  if (removePaneResizeListeners) {
    removePaneResizeListeners();
    removePaneResizeListeners = null;
  }
};

/**
 * 用途：根据当前视口宽度同步调试面板是否强制上下布局。
 * 参数说明：无参数，方法内部读取浏览器窗口宽度。
 * 返回值说明：无返回值，仅更新窄屏布局状态。
 */
function syncNarrowLayoutState() {
  if (typeof window === 'undefined') {
    isNarrowLayout.value = false;
    return;
  }
  isNarrowLayout.value = window.innerWidth <= DEBUG_STACKED_BREAKPOINT;
}

const startPaneResize = (event: PointerEvent) => {
  if (!debugLayoutRef.value) return;

  event.preventDefault();
  const layoutRect = debugLayoutRef.value.getBoundingClientRect();
  const containerSize = isStackedLayout.value
    ? layoutRect.height
    : layoutRect.width;
  if (!containerSize) return;

  const startPointer = isStackedLayout.value ? event.clientY : event.clientX;
  const startRatio = paneRatio.value;
  isPaneResizing.value = true;

  const onPointerMove = (moveEvent: PointerEvent) => {
    const currentPointer = isStackedLayout.value
      ? moveEvent.clientY
      : moveEvent.clientX;
    const delta = currentPointer - startPointer;
    paneRatio.value = normalizeResizeRatio(startRatio + delta / containerSize);
  };

  const onPointerUp = () => {
    isPaneResizing.value = false;
    clearPaneResizeListeners();
  };

  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  removePaneResizeListeners = () => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  };
};

function normalizeSecurityIn(value?: string) {
  const normalized = (value || '').trim().toLowerCase();
  if (
    normalized === 'cookie' ||
    normalized === 'header' ||
    normalized === 'query'
  ) {
    return normalized as 'cookie' | 'header' | 'query';
  }
  return '';
}

function syncSecurityParamsToDebugTable() {
  const securityList: any[] = Array.isArray(props.security)
    ? props.security
    : [];
  if (securityList.length === 0) {
    queryParams.value = queryParams.value.filter(
      (item) => !item.fromGlobal && !item.fromSecurity,
    );
    headers.value = headers.value.filter(
      (item) => !item.fromGlobal && !item.fromSecurity,
    );
    cookies.value = cookies.value.filter(
      (item) => !item.fromGlobal && !item.fromSecurity,
    );
    return;
  }

  const securitySchemes = apiStore.openApi?.components?.securitySchemes ?? {};
  const gatewayGlobalSecuritySchemes =
    aggregationStore.mainConfigCache.config?.['x-nextdoc4j-gateway']
      ?.globalSecuritySchemes ?? {};
  const gatewaySecuritySchemes =
    aggregationStore.mainConfigCache.openApi?.components?.securitySchemes ?? {};

  const resolveSecurityScheme = (
    key: string,
  ): SecuritySchemeObject | undefined => {
    return (
      securitySchemes?.[key] ||
      gatewayGlobalSecuritySchemes?.[key] ||
      gatewaySecuritySchemes?.[key]
    );
  };

  const securityKeys = new Set<string>();
  securityList.forEach((securityItem) => {
    Object.keys(securityItem || {}).forEach((key) => securityKeys.add(key));
  });

  const securityQueryNames = new Set<string>();
  const securityHeaderNames = new Set<string>();
  const securityCookieNames = new Set<string>();
  const securityRows: Array<{
    description: string;
    in: 'cookie' | 'header' | 'query';
    name: string;
    tokenValue: string;
    type?: string;
  }> = [];

  securityKeys.forEach((key) => {
    const securityScheme = resolveSecurityScheme(key);
    const rawSecurityIn = securityScheme?.in;
    const securityIn =
      normalizeSecurityIn(rawSecurityIn) ||
      (String(securityScheme?.type || '')
        .trim()
        .toLowerCase() === 'http'
        ? 'header'
        : 'header');
    const tokenCandidates = [
      `${key}_${securityIn}`,
      `${key}_${securityIn.toLowerCase()}`,
      `${key}_${securityIn.toUpperCase()}`,
      ...(rawSecurityIn
        ? [
            `${key}_${rawSecurityIn}`,
            `${key}_${rawSecurityIn.toLowerCase()}`,
            `${key}_${rawSecurityIn.toUpperCase()}`,
          ]
        : []),
    ];
    const tokenValue =
      tokenCandidates
        .map((candidate) => tokenStore?.token?.[candidate])
        .find((value) => value !== undefined && value !== null) ?? '';

    let name = '';
    switch (securityIn) {
      case 'cookie': {
        name = normalizeParamName(securityScheme?.name ?? key);
        if (!name) {
          break;
        }
        securityCookieNames.add(name);
        securityRows.push({
          in: 'cookie',
          name,
          tokenValue,
          description: securityScheme?.description ?? '',
          type: securityScheme?.type,
        });
        break;
      }
      case 'header': {
        name = normalizeParamName(
          securityScheme?.name ?? key ?? 'Authorization',
        );
        if (!name) {
          break;
        }
        securityHeaderNames.add(normalizeHeaderName(name));
        securityRows.push({
          in: 'header',
          name,
          tokenValue,
          description: securityScheme?.description ?? '',
          type: securityScheme?.type,
        });
        break;
      }
      case 'query': {
        name = normalizeParamName(securityScheme?.name ?? key);
        if (!name) {
          break;
        }
        securityQueryNames.add(name);
        securityRows.push({
          in: 'query',
          name,
          tokenValue,
          description: securityScheme?.description ?? '',
          type: securityScheme?.type,
        });
        break;
      }
      // No default
    }
  });

  const hasSecurityMarkerInState = [
    ...queryParams.value,
    ...headers.value,
    ...cookies.value,
  ].some((item) => item.fromSecurity !== undefined);

  // 兼容历史缓存：旧数据没有 fromSecurity 标记，导致无法被实时同步接管
  if (!hasSecurityMarkerInState) {
    queryParams.value = queryParams.value.map((item) => {
      const name = normalizeParamName(item.name || '');
      if (!item.fromGlobal && name && securityQueryNames.has(name)) {
        return {
          ...item,
          fromSecurity: true,
        };
      }
      return item;
    });
    headers.value = headers.value.map((item) => {
      const name = normalizeHeaderName(item.name || '');
      if (!item.fromGlobal && name && securityHeaderNames.has(name)) {
        return {
          ...item,
          fromSecurity: true,
        };
      }
      return item;
    });
    cookies.value = cookies.value.map((item) => {
      const name = normalizeParamName(item.name || '');
      if (!item.fromGlobal && name && securityCookieNames.has(name)) {
        return {
          ...item,
          fromSecurity: true,
        };
      }
      return item;
    });
  }

  const localQueryRows = queryParams.value.filter(
    (item) => !item.fromGlobal && !item.fromSecurity,
  );
  const localHeaderRows = headers.value.filter(
    (item) => !item.fromGlobal && !item.fromSecurity,
  );
  const localCookieRows = cookies.value.filter(
    (item) => !item.fromGlobal && !item.fromSecurity,
  );

  const localQueryNames = new Set(
    localQueryRows
      .map((item) => normalizeParamName(item.name || ''))
      .filter(Boolean),
  );
  const localHeaderNames = new Set(
    localHeaderRows
      .map((item) => normalizeHeaderName(item.name || ''))
      .filter(Boolean),
  );
  const localCookieNames = new Set(
    localCookieRows
      .map((item) => normalizeParamName(item.name || ''))
      .filter(Boolean),
  );

  const securityQueryRows: TableParamsObject[] = [];
  const securityHeaderRows: TableParamsObject[] = [];
  const securityCookieRows: TableParamsObject[] = [];

  securityRows.forEach((item) => {
    switch (item.in) {
      case 'cookie': {
        if (localCookieNames.has(item.name)) {
          return;
        }
        localCookieNames.add(item.name);
        securityCookieRows.push(
          withTableRowKey({
            name: item.name,
            enabled: true,
            fromSecurity: true,
            value: item.tokenValue,
            description: item.description,
            type: item.type,
          }),
        );
        return;
      }
      case 'header': {
        const normalizedName = normalizeHeaderName(item.name);
        if (localHeaderNames.has(normalizedName)) {
          return;
        }
        localHeaderNames.add(normalizedName);
        securityHeaderRows.push(
          withTableRowKey({
            enabled: true,
            fromSecurity: true,
            name: item.name,
            value: item.tokenValue,
            description: item.description,
            type: item.type,
          }),
        );
        return;
      }
      case 'query': {
        if (localQueryNames.has(item.name)) {
          return;
        }
        localQueryNames.add(item.name);
        securityQueryRows.push(
          withTableRowKey({
            name: item.name,
            enabled: true,
            fromSecurity: true,
            value: item.tokenValue,
            description: item.description,
            type: item.type,
          }),
        );
      }
      // No default
    }
  });

  queryParams.value = [...localQueryRows, ...securityQueryRows];
  headers.value = [...localHeaderRows, ...securityHeaderRows];
  cookies.value = [...localCookieRows, ...securityCookieRows];
}

function syncGlobalParamsToDebugTable() {
  const localQueryRows = queryParams.value.filter((item) => !item.fromGlobal);
  const localQueryNames = new Set(
    localQueryRows
      .map((item) => normalizeParamName(item.name || ''))
      .filter(Boolean),
  );
  const globalQueryRows = docManageStore
    .getMergedQueryParams(aggregationStore.currentService?.url)
    .filter((item) => item.enabled && normalizeParamName(item.name || ''))
    .filter((item) => !localQueryNames.has(normalizeParamName(item.name || '')))
    .map((item) =>
      withTableRowKey({
        description: item.description || '全局参数',
        enabled: true,
        fromGlobal: true,
        name: normalizeParamName(item.name || ''),
        type: 'string',
        value: item.value,
      }),
    );
  queryParams.value = [...localQueryRows, ...globalQueryRows];

  const localHeaderRows = headers.value.filter((item) => !item.fromGlobal);
  const localHeaderNames = new Set(
    localHeaderRows
      .map((item) => normalizeHeaderName(item.name || ''))
      .filter(Boolean),
  );
  const globalHeaderRows = docManageStore
    .getMergedHeaderParams(aggregationStore.currentService?.url)
    .filter((item) => item.enabled && normalizeParamName(item.name || ''))
    .filter(
      (item) => !localHeaderNames.has(normalizeHeaderName(item.name || '')),
    )
    .map((item) =>
      withTableRowKey({
        description: item.description || '全局参数',
        enabled: true,
        fromGlobal: true,
        name: normalizeParamName(item.name || ''),
        type: 'string',
        value: item.value,
      }),
    );
  headers.value = [...localHeaderRows, ...globalHeaderRows];
}

const handleRestoreDefault = async () => {
  if (!defaultRequestState.value) {
    ElMessage.warning('默认请求数据尚未初始化');
    return;
  }
  await restoreDefaultRequestState();
  ElMessage.success('已恢复默认请求数据');
};

const togglePaneLayout = () => {
  if (isNarrowLayout.value) {
    return;
  }
  paneLayout.value = isStackedLayout.value ? 'horizontal' : 'vertical';
};

const normalizeContentType = (contentType: null | string) => {
  return (contentType || '').split(';')[0]?.trim().toLowerCase() || '';
};

const isJsonContentType = (contentType: string) => {
  return contentType.includes('/json') || contentType.endsWith('+json');
};

const isXmlContentType = (contentType: string) => {
  return contentType.includes('/xml') || contentType.endsWith('+xml');
};

const isTextContentType = (contentType: string) => {
  if (contentType.startsWith('text/')) {
    return true;
  }

  return [
    'application/graphql',
    'application/javascript',
    'application/x-javascript',
    'application/x-www-form-urlencoded',
    'application/yaml',
    'application/x-yaml',
    'text/yaml',
  ].some((type) => contentType.includes(type));
};

const isBinaryContentType = (contentType: string) => {
  if (!contentType) return false;
  if (
    isJsonContentType(contentType) ||
    isXmlContentType(contentType) ||
    isTextContentType(contentType) ||
    contentType.endsWith('+yaml') ||
    contentType.endsWith('+yml')
  ) {
    return false;
  }
  if (
    contentType.startsWith('audio/') ||
    contentType.startsWith('font/') ||
    contentType.startsWith('image/') ||
    contentType.startsWith('video/')
  ) {
    return true;
  }

  return [
    'application/msword',
    'application/octet-stream',
    'application/pdf',
    'application/vnd',
    'application/x-7z-compressed',
    'application/x-bzip',
    'application/x-gzip',
    'application/x-rar-compressed',
    'application/zip',
  ].some((type) => contentType.includes(type));
};

const isAttachmentResponse = (response: Response) => {
  const disposition = response.headers.get('Content-Disposition') || '';
  return /attachment/i.test(disposition) || /filename\*?=/i.test(disposition);
};

const looksLikeXml = (text: string) => {
  return /^<\?xml|^<[a-zA-Z_][\w:.-]*[\s>]/.test(text.trim());
};

const looksLikeJson = (text: string) => {
  const value = text.trim();
  if (!value) return false;
  return (
    (value.startsWith('{') && value.endsWith('}')) ||
    (value.startsWith('[') && value.endsWith(']'))
  );
};

const parseUrlEncodedBody = (text: string) => {
  const params = new URLSearchParams(text);
  const result: Record<string, string | string[]> = {};
  params.forEach((value, key) => {
    const current = result[key];
    if (current === undefined) {
      result[key] = value;
      return;
    }
    if (Array.isArray(current)) {
      current.push(value);
      return;
    }
    result[key] = [current, value];
  });
  return result;
};

const toPrettyJson = (value: any) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? '');
  }
};

const resolveActualRequestBody = (
  bodyType: DebugBodyType | undefined,
  bodyData: string,
) => {
  switch (bodyType) {
    case 'binary': {
      const binaryFile = bodyTabRef.value?.fileList?.[0];
      return {
        bodyText: binaryFile?.name ? `file: ${binaryFile.name}` : '',
        bodyType: 'binary',
      };
    }
    case 'form-data': {
      const enabledItems = formDataParams.value
        .filter((item) => item.enabled && item.name)
        .map((item) => ({
          contentType: item.contentType || '',
          name: item.name,
          value: item.value ?? '',
        }));
      return {
        bodyText: enabledItems.length > 0 ? toPrettyJson(enabledItems) : '',
        bodyType: 'form-data',
      };
    }
    case 'json': {
      if (!bodyData) {
        return {
          bodyText: '',
          bodyType: 'json',
        };
      }
      try {
        return {
          bodyText: JSON.stringify(JSON.parse(bodyData), null, 2),
          bodyType: 'json',
        };
      } catch {
        return {
          bodyText: bodyData,
          bodyType: 'json',
        };
      }
    }
    case 'raw': {
      return {
        bodyText: bodyData || '',
        bodyType: 'raw',
      };
    }
    case 'x-www-form-urlencoded': {
      const enabledItems = urlEncodedParams.value
        .filter((item) => item.enabled && item.name)
        .map((item) => ({
          name: item.name,
          value: item.value ?? '',
        }));
      return {
        bodyText: enabledItems.length > 0 ? toPrettyJson(enabledItems) : '',
        bodyType: 'x-www-form-urlencoded',
      };
    }
    case 'xml': {
      return {
        bodyText: bodyData || '',
        bodyType: 'xml',
      };
    }
    default: {
      return {
        bodyText: '',
        bodyType: 'none',
      };
    }
  }
};

const resolveResponseLanguage = (contentType: string) => {
  if (isJsonContentType(contentType)) return 'json';
  if (isXmlContentType(contentType)) return 'xml';
  if (contentType.includes('x-www-form-urlencoded')) return 'json';
  if (contentType.includes('html')) return 'html';
  if (
    contentType.includes('javascript') ||
    contentType.includes('ecmascript')
  ) {
    return 'javascript';
  }
  if (contentType.includes('yaml') || contentType.includes('yml'))
    return 'yaml';
  return 'plaintext';
};

async function parseResponseBody(response: Response, requestUrl: string) {
  const contentType = normalizeContentType(
    response.headers.get('content-type'),
  );
  const language = resolveResponseLanguage(contentType);

  if (response.status === 204 || response.status === 205) {
    return {
      contentType,
      data: '',
      language: 'plaintext',
    };
  }

  if (isAttachmentResponse(response) || isBinaryContentType(contentType)) {
    const blob = await response.blob();
    const filename = getDownloadFilename(response, requestUrl);
    downloadBlob(blob, filename);
    return {
      contentType,
      data: {
        contentType: contentType || blob.type || 'application/octet-stream',
        filename,
        size: formatSize(blob.size),
        tip: '检测到二进制响应，已自动下载文件',
      },
      language: 'json',
    };
  }

  const rawText = await response.text();

  if (!rawText) {
    return {
      contentType,
      data: '',
      language,
    };
  }

  if (
    isJsonContentType(contentType) ||
    (!contentType && looksLikeJson(rawText))
  ) {
    try {
      return {
        contentType,
        data: JSON.parse(rawText),
        language: 'json',
      };
    } catch {
      return {
        contentType,
        data: rawText,
        language: 'plaintext',
      };
    }
  }

  if (isXmlContentType(contentType) || looksLikeXml(rawText)) {
    // 保留原始文本（含 <?xml?> 声明），由 XmlView 自行解析并排版，保真展示
    return {
      contentType,
      data: rawText,
      language: 'xml',
    };
  }

  if (contentType.includes('x-www-form-urlencoded')) {
    return {
      contentType,
      data: parseUrlEncodedBody(rawText),
      language: 'json',
    };
  }

  if (isTextContentType(contentType) || !contentType) {
    return {
      contentType,
      data: rawText,
      language,
    };
  }

  return {
    contentType,
    data: rawText,
    language: 'plaintext',
  };
}

const openBase64ImageDrawer = () => {
  if (!hasRealtimeBase64Images.value) {
    ElMessage.warning('当前响应未检测到可预览的 base64 图片');
    return;
  }
  base64ImageDrawerVisible.value = true;
};

const closeBase64ImageDrawer = () => {
  base64ImageDrawerVisible.value = false;
};

const base64ImageTotalSize = computed(() => {
  return realtimeDetectedBase64Images.value.reduce((total, item) => {
    return total + item.sizeBytes;
  }, 0);
});

const downloadDetectedBase64Image = (
  image: DetectedBase64Image,
  index: number,
) => {
  const link = document.createElement('a');
  link.href = image.dataUrl;
  link.download = buildDetectedImageFileName(image, index + 1);
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
};

// 生成 SSE 事件到达时间，格式 HH:mm:ss.SSS
const formatSseTime = () => {
  const now = new Date();
  const pad = (value: number, len = 2) => String(value).padStart(len, '0');
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(
    now.getSeconds(),
  )}.${pad(now.getMilliseconds(), 3)}`;
};

/**
 * 解析单个 SSE 事件块（以空行分隔的一段文本）为结构化事件。
 * @param block - 事件块原始文本，可能包含多行 data/event/id 字段
 * @param seq - 该事件的到达序号
 * @returns 解析后的事件；不含任何 data 字段时返回 null
 */
const parseSseEventBlock = (block: string, seq: number): null | SseEvent => {
  const dataLines: string[] = [];
  let event = 'message';
  let id: string | undefined;

  for (const line of block.split('\n')) {
    // 忽略空行与注释行（以冒号开头）
    if (!line || line.startsWith(':')) {
      continue;
    }
    const colonIndex = line.indexOf(':');
    const field = colonIndex === -1 ? line : line.slice(0, colonIndex);
    let value = colonIndex === -1 ? '' : line.slice(colonIndex + 1);
    // 规范：字段值前的单个空格需去除
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }
    switch (field) {
      case 'data': {
        dataLines.push(value);
        break;
      }
      case 'event': {
        event = value || 'message';
        break;
      }
      case 'id': {
        id = value;
        break;
      }
      // retry 字段与其他字段调试场景无需展示，忽略
    }
  }

  if (dataLines.length === 0) {
    return null;
  }
  const data = dataLines.join('\n');
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    parsed = undefined;
  }
  return { data, event, id, parsed, seq, time: formatSseTime() };
};

/**
 * 增量消费 text/event-stream 响应流，按 SSE 协议分帧并实时追加到 sseEvents。
 * @param response - fetch 返回的流式响应对象
 * @param startTime - 请求开始时间戳，用于持续更新耗时
 */
async function consumeEventStream(response: Response, startTime: number) {
  if (!response.body) {
    isStreaming.value = false;
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let seq = 0;
  let totalBytes = 0;

  // 追加事件：shallowRef 需替换数组引用以触发视图更新，并同步耗时
  const appendEvent = (block: string) => {
    const parsedEvent = parseSseEventBlock(block, seq + 1);
    if (!parsedEvent) {
      return;
    }
    seq += 1;
    sseEvents.value = [...sseEvents.value, parsedEvent];
    responseTime.value = Number((performance.now() - startTime).toFixed(2));
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      responseSize.value = formatSize(totalBytes);
      buffer = (buffer + decoder.decode(value, { stream: true })).replaceAll(
        '\r\n',
        '\n',
      );
      // 按空行切分出完整事件块，保留末尾不完整片段等待后续数据
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';
      blocks.forEach((block) => appendEvent(block));
    }
    // 处理流结束时残留在缓冲区的最后一个事件块
    if (buffer.trim()) {
      appendEvent(buffer);
    }
  } finally {
    reader.releaseLock();
    isStreaming.value = false;
  }
}

// 停止当前请求，主要用于中止 SSE 长连接并保留已接收事件
const stopRequest = () => {
  sseAborted.value = true;
  activeAbortController?.abort();
};

async function sendRequest() {
  loading.value = true;
  responseLoading.value = true;
  // 每次请求都是新的：清空上一次的流式事件，避免旧数据残留
  sseEvents.value = [];
  sseAborted.value = false;
  isStreaming.value = false;
  const startTime = performance.now(); // 记录开始时间;
  const abortController = new AbortController();
  activeAbortController = abortController;
  const timeoutId = window.setTimeout(() => {
    abortController.abort();
  }, REQUEST_TIMEOUTS.onlineDebug);

  try {
    // 构建请求URL，处理路径参数
    const url = applyPathParamsToRequestUrl(requestUrl.value || props.path);

    // 获取聚合模式下的服务前缀
    let servicePrefix = '';
    if (aggregationStore.isAggregation && aggregationStore.currentService) {
      // 从服务 URL 中提取前缀，如 "/file/v3/api-docs" -> "/file"
      const serviceUrl = aggregationStore.currentService.url;
      servicePrefix = serviceUrl.replace('/v3/api-docs', '');
    }

    const finalUrl = new URL(window.origin + apiURL + servicePrefix + url);

    const globalQueryParams = docManageStore
      .getMergedQueryParams(aggregationStore.currentService?.url)
      .filter((item) => item.enabled && item.name);
    const globalHeaderParams = docManageStore
      .getMergedHeaderParams(aggregationStore.currentService?.url)
      .filter((item) => item.enabled && item.name);

    // 添加查询参数（同名本地参数优先）
    const localQueryNames = new Set<string>();
    queryParams.value.forEach((p) => {
      const name = normalizeParamName(p.name || '');
      if (!name) return;

      if (p.enabled || p.fromGlobal) {
        localQueryNames.add(name);
      }
      if (p.enabled) {
        finalUrl.searchParams.append(name, p.value);
      }
    });

    globalQueryParams.forEach((item) => {
      const name = normalizeParamName(item.name || '');
      if (name && !localQueryNames.has(name)) {
        finalUrl.searchParams.append(name, item.value);
      }
    });

    // 构建请求头
    const requestHeaders = new Headers();
    const localHeaderNames = new Set<string>();
    headers.value.forEach((h) => {
      const name = normalizeParamName(h.name || '');
      if (!name) return;
      const key = normalizeHeaderName(name);

      if (h.enabled || h.fromGlobal) {
        localHeaderNames.add(key);
      }
      if (h.enabled) {
        requestHeaders.append(name, h.value);
      }
    });

    globalHeaderParams.forEach((item) => {
      const name = normalizeParamName(item.name || '');
      const key = normalizeHeaderName(name);
      if (name && !localHeaderNames.has(key)) {
        requestHeaders.append(name, item.value);
      }
    });

    // 添加form-data 添加默认的 Content-Type
    const formData = new FormData();
    const searchParams = new URLSearchParams();
    let bodyData = '';
    const currentBodyType = bodyTabRef.value?.bodyType as
      | DebugBodyType
      | undefined;
    switch (currentBodyType) {
      case 'binary': {
        const binaryData = bodyTabRef.value?.fileList?.[0];
        if (binaryData) {
          formData.append('file', binaryData);
        }
        requestHeaders.append('Content-Type', 'multipart/form-data');
        break;
      }
      case 'form-data': {
        if (formDataParams.value.some((h) => h.enabled && h.name)) {
          formDataParams.value
            .filter((h) => h.enabled && h.name)
            .forEach((h) => {
              let value = h.value;

              // 根据 contentType 处理值
              if (h.contentType === 'application/json') {
                // JSON 类型需要序列化，并用 Blob 设置 Content-Type
                try {
                  const jsonStr = JSON.stringify(
                    typeof value === 'string' ? JSON.parse(value) : value,
                  );
                  const blob = new Blob([jsonStr], {
                    type: 'application/json',
                  });
                  formData.append(h.name, blob);
                  return; // 已处理，直接返回
                } catch {
                  // 如果解析失败，直接字符串化
                  value = String(value);
                }
              }

              if (Array.isArray(value) && value.length > 0) {
                value.forEach((item) => {
                  formData.append(h.name, item);
                });
              } else {
                formData.append(h.name, value);
              }
            });
        }
        break;
      }
      case 'json': {
        if (props.requestBody) {
          bodyData = bodyTabRef.value?.getExample?.() ?? '';
        }
        requestHeaders.append('Content-Type', 'application/json');
        break;
      }
      case 'raw': {
        if (props.requestBody) {
          bodyData = bodyTabRef.value?.getExample?.() ?? '';
        }
        requestHeaders.append('Content-Type', 'text/plain');
        break;
      }
      case 'x-www-form-urlencoded': {
        if (urlEncodedParams.value.some((h) => h.enabled && h.name)) {
          urlEncodedParams.value
            .filter((h) => h.enabled && h.name)
            .forEach((h) => searchParams.append(h.name, h.value));
        }
        requestHeaders.append(
          'Content-Type',
          'application/x-www-form-urlencoded',
        );
        break;
      }
      case 'xml': {
        if (props.requestBody) {
          bodyData = bodyTabRef.value?.getExample?.() ?? '';
        }
        requestHeaders.append('Content-Type', 'text/xml');
        break;
      }
      default: {
        requestHeaders.append('Content-Type', 'application/json');
      }
    }
    const bodyType = bodyTabRef.value?.bodyType as DebugBodyType | undefined;
    const actualRequestBody = resolveActualRequestBody(bodyType, bodyData);
    actualRequestSnapshot.value = {
      bodyText: actualRequestBody.bodyText,
      bodyType: actualRequestBody.bodyType,
      headers: [...requestHeaders.entries()].map(([name, value]) => ({
        name,
        value,
      })),
      method: props.method.toUpperCase(),
      pathParams: pathParams.value
        .filter((item) => normalizeParamName(item.name || ''))
        .map((item) => ({
          name: normalizeParamName(item.name || ''),
          value: item.value ?? '',
        })),
      queryParams: [...finalUrl.searchParams.entries()].map(
        ([name, value]) => ({
          name,
          value,
        }),
      ),
      url: finalUrl.toString(),
    };
    responseTab.value = 'RealtimeResponse';

    // 发送请求
    const response = await fetch(finalUrl, {
      method: props.method.toUpperCase(),
      headers: requestHeaders,
      signal: abortController.signal,
      body:
        props.method.toLowerCase() !== 'get' &&
        ['binary', 'form-data'].includes(bodyType || '')
          ? formData
          : // eslint-disable-next-line unicorn/no-nested-ternary
            bodyType === 'x-www-form-urlencoded'
            ? searchParams
            : bodyData || undefined,
    });

    // 响应头到达即可展示状态与头信息（SSE 与普通响应共用）
    responseStatus.value = {
      code: response.status,
      text: `${response.status} ${response.statusText}`,
      type: response.ok ? 'success' : 'error',
    };
    responseMimeType.value =
      normalizeContentType(response.headers.get('content-type')) || '-';
    const header = Object.fromEntries(response.headers.entries());
    responseHeaders.value = [];
    for (const key in header) {
      responseHeaders.value.push({
        name: key,
        value: header[key] ?? '',
        enabled: true,
      });
    }

    // text/event-stream 走流式分支：首字节已到达，取消建连超时后持续接收
    if (
      normalizeContentType(response.headers.get('content-type')) ===
      'text/event-stream'
    ) {
      window.clearTimeout(timeoutId);
      isStreaming.value = true;
      responseLoading.value = false;
      responseTab.value = 'EventStream';
      await consumeEventStream(response, startTime);
      return;
    }

    // 处理响应：按 content-type 自动解析 JSON/XML/Text/Form/Binary
    const parsedResponse = await parseResponseBody(
      response,
      finalUrl.toString(),
    );

    responseTime.value = Number((performance.now() - startTime).toFixed(2));
    responseData.value = parsedResponse.data;
    responseLanguage.value = parsedResponse.language || 'plaintext';
    responseMimeType.value = parsedResponse.contentType || '-';

    // 计算响应大小
    const size =
      typeof parsedResponse.data === 'string'
        ? parsedResponse.data.length * 2 // 字符串按UTF-16计算
        : JSON.stringify(parsedResponse.data ?? '').length * 2;
    responseSize.value = formatSize(size);
  } catch (error: any) {
    // 用户主动停止 SSE 时保留已接收事件，不提示错误
    if (error?.name === 'AbortError' && sseAborted.value) {
      return;
    }
    const errorMessage =
      error?.name === 'AbortError'
        ? ONLINE_DEBUG_TIMEOUT_MESSAGE
        : error?.msg || '请求失败';
    ElMessage.error(errorMessage);
    responseStatus.value = {
      code: 0,
      text: errorMessage,
      type: 'error',
    };
    responseData.value = null;
    responseMimeType.value = '-';
  } finally {
    window.clearTimeout(timeoutId);
    isStreaming.value = false;
    activeAbortController = null;
    loading.value = false;
    responseLoading.value = false;
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
 * 从HTTP响应获取下载文件名（支持 filename 和 filename*）
 * @param response - fetch响应对象
 * @param url - 请求URL（备用）
 * @returns 提取到的文件名
 */
function getDownloadFilename(response: Response, url: string): string {
  // 优先从Content-Disposition头获取
  const contentDisposition = response.headers.get('Content-Disposition');
  let filename = '';

  if (contentDisposition) {
    // filename* (RFC 5987) UTF-8
    const filenameStarMatch = contentDisposition.match(
      /filename\*=([^']+)'[^']*'(.+)/i,
    );
    if (filenameStarMatch?.[2]) {
      try {
        filename = decodeURIComponent(filenameStarMatch[2]);
      } catch {
        filename = filenameStarMatch[2];
      }
    } else {
      // 普通 filename
      const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
      if (filenameMatch?.[1]) {
        filename = filenameMatch[1];
      }
    }
  }
  // 备选 url 获取
  if (!filename) {
    const pathname = new URL(url, window.location.origin).pathname;
    filename = pathname.split('/').pop() || 'download';
  }
  // 去除非法字符
  filename = filename.replaceAll(/[/\\?%*:|"<>]/g, '_').trim();
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
const formDataParams = ref<Array<ParamsType>>([]);

// URL Encoded 参数相关
const urlEncodedParams = ref<Array<ParamsType>>([]);

onMounted(async () => {
  const openApi = apiStore.openApi;
  baseUrl.value = openApi?.servers?.[0]?.url;
  syncNarrowLayoutState();
  window.addEventListener('pagehide', handlePageHide);
  window.addEventListener('resize', syncNarrowLayoutState);
  syncSecurityParamsToDebugTable();
  syncGlobalParamsToDebugTable();
  await captureDefaultRequestState();

  if (apiTestCacheStore.debugCacheEnabled) {
    const cachedState = apiTestCacheStore.getRequestCache(cacheKey.value);
    if (cachedState) {
      await applySnapshot(mergeCachedRequestState(cachedState), {
        syncGlobal: true,
      });
    }
  }

  await syncSelectedRequestBodyType({
    forceBodyType: true,
    preserveValue: true,
  });

  await nextTick();
  syncTabOverflowObserver();
  scheduleTabOverflowUpdate();
});

watch(
  () => props.requestBodyType,
  async (newType, oldType) => {
    if (newType === oldType) {
      return;
    }
    await syncSelectedRequestBodyType({
      forceBodyType: true,
      preserveValue: true,
    });
  },
);

watch(
  () => props.requestBody,
  async (nextBody, prevBody) => {
    if (nextBody === prevBody) {
      return;
    }
    await syncSelectedRequestBodyType({
      forceBodyType: true,
      preserveValue: false,
    });
  },
  { deep: true },
);

watch(
  () => JSON.stringify(props.requestBodyVariantState || {}),
  async () => {
    await syncSelectedRequestBodyType({
      forceBodyType: true,
      preserveValue: false,
    });
  },
);
watch(
  () => apiTestCacheStore.debugCacheEnabled,
  (enabled) => {
    if (!enabled && persistTimer) {
      window.clearTimeout(persistTimer);
      persistTimer = null;
      return;
    }
    if (enabled) {
      schedulePersistCache();
    }
  },
);

watch(
  [
    requestUrl,
    activeTab,
    queryParams,
    pathParams,
    headers,
    cookies,
    formDataParams,
    urlEncodedParams,
    () => bodyTabRef.value?.bodyType,
    () => props.requestBodyType,
    () => props.requestBodyVariantState,
  ],
  () => {
    schedulePersistCache();
  },
  { deep: true },
);

onBeforeUnmount(() => {
  // 卸载时中止进行中的请求，释放 SSE 长连接
  activeAbortController?.abort();
  window.removeEventListener('pagehide', handlePageHide);
  window.removeEventListener('resize', syncNarrowLayoutState);
  flushPersistCache();
  clearPaneResizeListeners();
  tabOverflowObserver?.disconnect();
  tabOverflowObserver = null;
  if (overflowRaf) {
    window.cancelAnimationFrame(overflowRaf);
    overflowRaf = null;
  }
});
</script>

<template>
  <div class="debug-console">
    <div class="debug-console__top">
      <div class="debug-console__toolbar">
        <div class="debug-back-button-wrap">
          <ElButton class="debug-back-button" @click="$emit('cancel')">
            <svg
              class="debug-back-button__icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
            <span class="debug-back-button__label">接口详情</span>
          </ElButton>
        </div>

        <div class="debug-console__request-row">
          <ElInput
            v-model="requestUrlDisplay"
            placeholder="请输入正确的URL"
            class="debug-request-input"
          >
            <template #prefix>
              <span class="method-pill" :style="methodPillStyle">
                {{ method?.toUpperCase() }}
              </span>
              <button
                v-if="baseUrl"
                type="button"
                class="debug-base-url"
                @click="handleCopyBaseUrl"
              >
                <SvgApiPrefixIcon class="debug-base-url__icon" />
                <span class="debug-base-url__text">{{ baseUrl }}</span>
              </button>
            </template>
          </ElInput>
          <div class="debug-console__request-actions">
            <ElButton
              v-if="isStreaming"
              type="danger"
              class="debug-send-button"
              @click="stopRequest"
            >
              <span>停止</span>
            </ElButton>
            <ElButton
              v-else
              type="primary"
              class="debug-send-button"
              :loading="loading"
              @click="sendRequest"
            >
              <ApiTestRun v-if="!loading" class="debug-send-button__icon" />
              <span>发送</span>
            </ElButton>
            <div class="debug-console__icon-group">
              <ElTooltip content="全局配置管理" placement="top">
                <ElButton
                  text
                  class="debug-icon-button"
                  @click="globalConfigVisible = true"
                >
                  <SvgGlobalConfigIcon class="size-4" />
                </ElButton>
              </ElTooltip>
              <ElTooltip
                content="一键复制请求信息、响应内容、错误信息，粘贴到 claude code 等 AI 编程工具，让 AI 排查和修复代码"
                placement="top"
                :enterable="false"
              >
                <ElButton
                  text
                  class="debug-icon-button"
                  @click="handleCopyForAi"
                >
                  <SvgAiCopyIcon class="size-4" />
                </ElButton>
              </ElTooltip>
              <ElTooltip content="恢复默认" placement="top">
                <ElButton
                  text
                  class="debug-icon-button"
                  @click="handleRestoreDefault"
                >
                  <SvgDocumentResetIcon class="size-4" />
                </ElButton>
              </ElTooltip>
              <ElTooltip :content="layoutTooltipText" placement="top">
                <ElButton
                  text
                  class="debug-icon-button"
                  :class="{ 'debug-icon-button--active': !isStackedLayout }"
                  @click="togglePaneLayout"
                >
                  <SvgDocumentLayoutIcon
                    class="size-4 transition-transform"
                    :class="{ 'rotate-90': !isStackedLayout }"
                  />
                </ElButton>
              </ElTooltip>
            </div>
          </div>
        </div>
      </div>
      <div
        v-if="activeGlobalQueryCount > 0 || activeGlobalHeaderCount > 0"
        class="debug-console__hint"
      >
        已注入全局参数：Query {{ activeGlobalQueryCount }} 项，Header
        {{ activeGlobalHeaderCount }} 项
      </div>
    </div>

    <div class="debug-console__body">
      <div
        ref="debugLayoutRef"
        class="debug-layout"
        :class="{
          'debug-layout--horizontal': !isStackedLayout,
          'debug-layout--resizing': isPaneResizing,
        }"
        :style="layoutGridStyle"
      >
        <section class="debug-pane debug-pane--request">
          <div class="debug-pane-shell">
            <div class="debug-pane__header debug-pane__header--inline-tabs">
              <div class="debug-pane__header-main">
                <span class="debug-pane__title">请求参数</span>
                <div ref="requestTabsHostRef" class="debug-inline-tabs">
                  <button
                    v-for="tabItem in requestVisibleTabs"
                    :key="tabItem.key"
                    type="button"
                    class="debug-inline-tab"
                    :class="{
                      'debug-inline-tab--active': activeTab === tabItem.key,
                    }"
                    @click="activeTab = tabItem.key"
                  >
                    <span class="debug-inline-tab__label">{{
                      tabItem.label
                    }}</span>
                    <span v-if="tabItem.count" class="debug-inline-tab__count">
                      {{ tabItem.count }}
                    </span>
                  </button>
                  <ElDropdown
                    v-if="requestHiddenTabs.length > 0"
                    trigger="click"
                    placement="bottom-end"
                    popper-class="debug-tab-overflow-menu"
                    @command="handleRequestHiddenTabCommand"
                  >
                    <button
                      type="button"
                      class="debug-inline-tab debug-inline-tab--more"
                      aria-label="更多标签"
                    >
                      <SvgDocumentOmittedIcon
                        class="debug-inline-tab__more-icon"
                      />
                    </button>
                    <template #dropdown>
                      <ElDropdownMenu>
                        <ElDropdownItem
                          v-for="tabItem in requestHiddenTabs"
                          :key="tabItem.key"
                          :command="tabItem.key"
                          :class="{
                            'debug-hidden-tab--active':
                              activeTab === tabItem.key,
                          }"
                        >
                          <span class="debug-hidden-tab__label">
                            {{ tabItem.label }}
                          </span>
                          <span
                            v-if="tabItem.count"
                            class="debug-hidden-tab__count"
                          >
                            {{ tabItem.count }}
                          </span>
                        </ElDropdownItem>
                      </ElDropdownMenu>
                    </template>
                  </ElDropdown>
                </div>
              </div>
            </div>
            <div class="debug-tabs-wrap">
              <ElTabs v-model="activeTab" class="debug-tabs debug-tabs--inline">
                <ElTabPane name="Params" label="Params">
                  <div class="params-tab-sections">
                    <div
                      v-if="pathParams.length > 0"
                      class="actual-request__block"
                    >
                      <h3 class="actual-request__title">Path 参数</h3>
                      <params-table
                        :table-data="pathParams"
                        :allow-delete="false"
                        :show-add-button="false"
                        :show-selection-column="false"
                        show-description-column
                      />
                    </div>

                    <div class="actual-request__block">
                      <h3 class="actual-request__title">Query 参数</h3>
                      <params-table
                        :table-data="queryParams"
                        show-description-column
                        show-delete-in-description
                      />
                    </div>
                  </div>
                </ElTabPane>

                <body-params
                  ref="bodyTabRef"
                  :request-body="requestBody"
                  :form-data-params="formDataParams"
                  :url-encoded-params="urlEncodedParams"
                  :request-body-type="props.requestBodyType"
                  :request-body-variant-state="
                    props.requestBodyVariantState || {}
                  "
                  @body-change="schedulePersistCache"
                />

                <ElTabPane name="Headers" label="Headers">
                  <params-table
                    :table-data="headers"
                    show-description-column
                    show-delete-in-description
                  />
                </ElTabPane>
                <ElTabPane name="Cookies" label="Cookies">
                  <params-table
                    :table-data="cookies"
                    show-description-column
                    show-delete-in-description
                  />
                </ElTabPane>
              </ElTabs>
            </div>
          </div>
        </section>

        <div
          class="debug-resizer"
          :class="{ 'debug-resizer--horizontal': !isStackedLayout }"
          @pointerdown="startPaneResize"
        >
          <span class="debug-resizer__thumb"></span>
        </div>

        <section class="debug-pane debug-pane--response">
          <div class="debug-pane-shell">
            <div class="debug-pane__header debug-pane__header--inline-tabs">
              <div class="debug-pane__header-main">
                <span class="debug-pane__title">响应结果</span>
                <div ref="responseTabsHostRef" class="debug-inline-tabs">
                  <button
                    v-for="tabItem in responseVisibleTabs"
                    :key="tabItem.key"
                    type="button"
                    class="debug-inline-tab"
                    :class="{
                      'debug-inline-tab--active': responseTab === tabItem.key,
                    }"
                    @click="responseTab = tabItem.key"
                  >
                    <span class="debug-inline-tab__label">{{
                      tabItem.label
                    }}</span>
                    <span v-if="tabItem.count" class="debug-inline-tab__count">
                      {{ tabItem.count }}
                    </span>
                  </button>
                  <ElDropdown
                    v-if="responseHiddenTabs.length > 0"
                    trigger="click"
                    placement="bottom-end"
                    popper-class="debug-tab-overflow-menu"
                    @command="handleResponseHiddenTabCommand"
                  >
                    <button
                      type="button"
                      class="debug-inline-tab debug-inline-tab--more"
                      aria-label="更多标签"
                    >
                      <SvgDocumentOmittedIcon
                        class="debug-inline-tab__more-icon"
                      />
                    </button>
                    <template #dropdown>
                      <ElDropdownMenu>
                        <ElDropdownItem
                          v-for="tabItem in responseHiddenTabs"
                          :key="tabItem.key"
                          :command="tabItem.key"
                          :class="{
                            'debug-hidden-tab--active':
                              responseTab === tabItem.key,
                          }"
                        >
                          <span class="debug-hidden-tab__label">
                            {{ tabItem.label }}
                          </span>
                          <span
                            v-if="tabItem.count"
                            class="debug-hidden-tab__count"
                          >
                            {{ tabItem.count }}
                          </span>
                        </ElDropdownItem>
                      </ElDropdownMenu>
                    </template>
                  </ElDropdown>
                </div>
                <ElTooltip
                  v-if="hasRealtimeBase64Images"
                  :content="`已识别 ${realtimeDetectedBase64Images.length} 张图片`"
                  placement="top"
                >
                  <button
                    type="button"
                    class="debug-inline-tab debug-inline-tab--image"
                    :class="{
                      'debug-inline-tab--active': base64ImageDrawerVisible,
                    }"
                    @click="openBase64ImageDrawer"
                  >
                    <span class="debug-inline-tab__label">图片</span>
                    <span class="debug-inline-tab__count">
                      {{ realtimeDetectedBase64Images.length }}
                    </span>
                  </button>
                </ElTooltip>
              </div>
              <div
                v-if="responseStatus.type !== 'default' && !responseLoading"
                class="debug-status-list"
              >
                <ElTooltip
                  :content="`HTTP 状态: ${responseStatus.type}`"
                  placement="top"
                >
                  <span
                    class="debug-status-chip"
                    :class="`debug-status-chip--${responseStatusTone}`"
                  >
                    {{ responseStatus.text }}
                  </span>
                </ElTooltip>
                <ElTooltip content="耗时" placement="top">
                  <span class="debug-status-chip debug-status-chip--metric">
                    {{ responseTime }} ms
                  </span>
                </ElTooltip>
                <ElTooltip content="大小" placement="top">
                  <span class="debug-status-chip debug-status-chip--metric">
                    {{ responseSize }}
                  </span>
                </ElTooltip>
                <ElTooltip content="响应类型" placement="top">
                  <span class="debug-status-chip debug-status-chip--metric">
                    {{ responseMimeType }}
                  </span>
                </ElTooltip>
              </div>
              <span v-else-if="!responseLoading" class="debug-pane__meta">
                等待发送请求
              </span>
            </div>

            <div class="debug-response-wrap">
              <div
                v-if="responseLoading"
                class="flex h-full items-center justify-center"
              >
                <div class="flex flex-col items-center gap-3">
                  <div class="loading-spinner">
                    <svg
                      class="animate-spin"
                      width="40"
                      height="40"
                      viewBox="0 0 24 24"
                    >
                      <path
                        fill="#409EFF"
                        d="M12,4V2A10,10 0 0,0 2,12H4A8,8 0 0,1 12,4Z"
                      />
                    </svg>
                  </div>
                  <div class="loading-text">
                    <span>正在获取响应数据</span>
                    <span class="loading-dots">
                      <span class="dot">.</span>
                      <span class="dot">.</span>
                      <span class="dot">.</span>
                    </span>
                  </div>
                </div>
              </div>

              <template v-else>
                <ElTabs
                  v-if="
                    responseStatus.type !== 'default' || actualRequestSnapshot
                  "
                  v-model="responseTab"
                  class="debug-response-tabs debug-response-tabs--inline"
                >
                  <ElTabPane
                    v-if="isSseResponse"
                    name="EventStream"
                    label="事件流"
                  >
                    <SseEventList
                      :events="sseEvents"
                      :streaming="isStreaming"
                      class="response-body"
                    />
                  </ElTabPane>
                  <ElTabPane
                    v-else
                    name="RealtimeResponse"
                    label="实时响应"
                    lazy
                  >
                    <template v-if="responseStatus.type !== 'default'">
                      <XmlView
                        v-if="showResponseAsXml"
                        :xml="responseData"
                        :dark="isDark"
                        class="response-body"
                      />
                      <MarkdownCodeBlock
                        v-else-if="showResponseAsCode"
                        :code="responseData"
                        :language="responseLanguage"
                        :dark="isDark"
                        class="response-body response-body--code"
                      />
                      <JsonViewer
                        v-else
                        ref="realtimeResponseJsonRef"
                        :value="responseData"
                        :schema="responseSchemaForViewer"
                        :default-expanded="true"
                        :enable-chunked-render="true"
                        :initial-render-count="60"
                        :render-chunk-size="60"
                        class="response-body app-json-schema-viewer"
                      />
                    </template>
                    <ElEmpty v-else :image-size="68">
                      <template #description>
                        <span class="text-sm">发送请求后展示实时响应结果</span>
                      </template>
                    </ElEmpty>
                  </ElTabPane>
                  <ElTabPane name="ResponseHeaders" label="响应头" lazy>
                    <div
                      v-if="responseHeaders.length > 0"
                      class="response-headers"
                    >
                      <ElTable border :data="responseHeaders">
                        <ElTableColumn label="参数名" prop="name" />
                        <ElTableColumn label="参数值" prop="value" />
                      </ElTable>
                    </div>
                    <ElEmpty v-else :image-size="68">
                      <template #description>
                        <span class="text-sm">暂无响应头信息</span>
                      </template>
                    </ElEmpty>
                  </ElTabPane>
                  <ElTabPane name="ActualRequest" label="实际请求" lazy>
                    <div v-if="actualRequestSnapshot" class="actual-request">
                      <div class="actual-request__block">
                        <div class="actual-request__title">请求 URL</div>
                        <pre
                          class="actual-request__code"
                          v-text="
                            `${actualRequestSnapshot.method} ${actualRequestSnapshot.url}`
                          "
                        ></pre>
                      </div>

                      <div
                        v-if="actualRequestSnapshot.headers.length > 0"
                        class="actual-request__block"
                      >
                        <div class="actual-request__title">请求头</div>
                        <ElTable border :data="actualRequestSnapshot.headers">
                          <ElTableColumn label="参数名" prop="name" />
                          <ElTableColumn label="参数值" prop="value" />
                        </ElTable>
                      </div>

                      <div
                        v-if="actualRequestSnapshot.queryParams.length > 0"
                        class="actual-request__block"
                      >
                        <div class="actual-request__title">Query 参数</div>
                        <ElTable
                          border
                          :data="actualRequestSnapshot.queryParams"
                        >
                          <ElTableColumn label="参数名" prop="name" />
                          <ElTableColumn label="参数值" prop="value" />
                        </ElTable>
                      </div>

                      <div
                        v-if="actualRequestSnapshot.pathParams.length > 0"
                        class="actual-request__block"
                      >
                        <div class="actual-request__title">Path 参数</div>
                        <ElTable
                          border
                          :data="actualRequestSnapshot.pathParams"
                        >
                          <ElTableColumn label="参数名" prop="name" />
                          <ElTableColumn label="参数值" prop="value" />
                        </ElTable>
                      </div>

                      <div
                        v-if="actualRequestSnapshot.bodyText"
                        class="actual-request__block"
                      >
                        <div class="actual-request__title">
                          请求体 ({{ actualRequestSnapshot.bodyType }})
                        </div>
                        <pre class="actual-request__code">{{
                          actualRequestSnapshot.bodyText
                        }}</pre>
                      </div>
                    </div>
                    <ElEmpty v-else :image-size="68">
                      <template #description>
                        <span class="text-sm">发送请求后展示实际请求内容</span>
                      </template>
                    </ElEmpty>
                  </ElTabPane>
                </ElTabs>
                <ElEmpty v-else :image-size="80">
                  <template #description>
                    <span class="text-sm">点击“发送”按钮获取返回结果</span>
                  </template>
                </ElEmpty>
              </template>
            </div>
          </div>
        </section>
      </div>
    </div>

    <ElDrawer
      v-model="base64ImageDrawerVisible"
      direction="rtl"
      size="min(560px, 92vw)"
      :with-header="false"
      append-to-body
      class="debug-base64-drawer"
    >
      <div class="debug-base64-drawer__shell">
        <div class="debug-base64-drawer__header">
          <div class="debug-base64-drawer__heading">
            <div class="debug-base64-drawer__title-row">
              <span class="debug-base64-drawer__title">Base64 响应图片</span>
              <span
                v-if="hasRealtimeBase64Images"
                class="debug-base64-drawer__title-count"
              >
                {{ realtimeDetectedBase64Images.length }}
              </span>
            </div>
          </div>
          <ElButton
            text
            class="debug-base64-drawer__collapse"
            @click="closeBase64ImageDrawer"
          >
            收起
          </ElButton>
        </div>

        <div class="debug-base64-drawer__body">
          <div
            v-if="hasRealtimeBase64Images"
            class="debug-base64-drawer__summary"
          >
            <span class="debug-status-chip debug-status-chip--metric">
              共 {{ realtimeDetectedBase64Images.length }} 张图片
            </span>
            <span class="debug-status-chip debug-status-chip--metric">
              总计 {{ formatDetectedImageSize(base64ImageTotalSize) }}
            </span>
          </div>

          <ElEmpty
            v-if="!hasRealtimeBase64Images"
            :image-size="80"
            class="debug-base64-empty"
          >
            <template #description>
              <span class="text-secondary text-sm">
                未检测到可预览的 Base64 图片数据
              </span>
            </template>
          </ElEmpty>

          <div v-else class="debug-base64-drawer__list">
            <article
              v-for="(item, index) in realtimeDetectedBase64Images"
              :key="`${item.path}-${index}`"
              class="debug-base64-card"
            >
              <div class="debug-base64-card__header">
                <div class="debug-base64-card__info">
                  <span class="debug-base64-card__index">#{{ index + 1 }}</span>
                  <span class="debug-base64-card__path" :title="item.path">{{
                    item.path
                  }}</span>
                </div>
                <ElButton
                  size="small"
                  type="primary"
                  plain
                  @click="downloadDetectedBase64Image(item, index)"
                >
                  下载
                </ElButton>
              </div>

              <div class="debug-base64-card__preview">
                <div class="debug-base64-card__preview-stage">
                  <img
                    :src="item.dataUrl"
                    :alt="`image-${index}`"
                    loading="lazy"
                  />
                </div>
              </div>

              <div class="debug-base64-card__footer">
                <span class="debug-base64-card__chip">{{ item.mimeType }}</span>
                <span class="debug-base64-card__chip">{{
                  formatDetectedImageSize(item.sizeBytes)
                }}</span>
              </div>
            </article>
          </div>
        </div>
      </div>
    </ElDrawer>

    <div class="debug-tab-measure" aria-hidden="true">
      <div class="debug-inline-tabs">
        <button
          v-for="tabItem in requestInlineTabs"
          :key="`measure-request-${tabItem.key}`"
          type="button"
          class="debug-inline-tab"
          :ref="(el) => setRequestTabMeasureRef(tabItem.key, el)"
        >
          <span class="debug-inline-tab__label">{{ tabItem.label }}</span>
          <span v-if="tabItem.count" class="debug-inline-tab__count">
            {{ tabItem.count }}
          </span>
        </button>
        <button
          ref="requestMoreMeasureRef"
          type="button"
          class="debug-inline-tab debug-inline-tab--more"
        >
          <SvgDocumentOmittedIcon class="debug-inline-tab__more-icon" />
        </button>
      </div>
      <div class="debug-inline-tabs">
        <button
          v-for="tabItem in responseInlineTabs"
          :key="`measure-response-${tabItem.key}`"
          type="button"
          class="debug-inline-tab"
          :ref="(el) => setResponseTabMeasureRef(tabItem.key, el)"
        >
          <span class="debug-inline-tab__label">{{ tabItem.label }}</span>
          <span v-if="tabItem.count" class="debug-inline-tab__count">
            {{ tabItem.count }}
          </span>
        </button>
        <button
          ref="responseMoreMeasureRef"
          type="button"
          class="debug-inline-tab debug-inline-tab--more"
        >
          <SvgDocumentOmittedIcon class="debug-inline-tab__more-icon" />
        </button>
      </div>
    </div>

    <!-- 全局配置弹窗：左侧全局参数、右侧全局认证，与文档管理共用数据 -->
    <ElDialog
      v-model="globalConfigVisible"
      title="全局配置管理"
      align-center
      append-to-body
      class="global-config-dialog"
      modal-class="global-config-dialog-overlay"
      width="min(1180px, calc(100vw - 80px))"
    >
      <GlobalConfigPanel
        params-table-max-height="min(384px, calc(100vh - 360px))"
      />
    </ElDialog>
  </div>
</template>

<style lang="scss" scoped>
@keyframes dot-pulse {
  0% {
    opacity: 0.2;
    transform: translateY(0);
  }

  50% {
    opacity: 1;
    transform: translateY(-2px);
  }

  100% {
    opacity: 0.2;
    transform: translateY(0);
  }
}

@media (max-width: 1024px) {
  /* 中等宽度：保持单行，收起返回按钮文案为图标，避免换行 */
  .debug-back-button__label {
    display: none;
  }

  .debug-back-button {
    width: 52px;
    padding: 0;
  }

  .debug-send-button {
    min-width: 64px;
  }

  .debug-base-url {
    max-width: 160px;
  }
}

@media (max-width: 720px) {
  /* 窄屏：返回按钮独立占位，请求条内部按空间换行，图标组保持在一行不再拆散 */
  .debug-console__toolbar {
    align-items: flex-start;
  }

  .debug-console__request-row {
    flex-wrap: wrap;
  }

  .debug-request-input {
    flex: 1 1 auto;
    min-width: 0;
  }

  .debug-console__request-actions {
    flex: 1 0 auto;
    justify-content: space-between;
    width: 100%;
  }

  .debug-console__request-actions::before {
    display: none;
  }

  .debug-send-button {
    flex: 1;
    min-width: 72px;
    max-width: 120px;
  }

  .debug-console__icon-group {
    flex: 0 0 auto;
  }

  .debug-base-url {
    justify-content: center;
    width: 30px;
    padding: 0;
  }

  .debug-base-url__text {
    display: none;
  }

  .debug-status-list {
    justify-content: flex-start;
  }
}

@media (max-width: 768px) {
  :global(.global-config-dialog) {
    width: calc(100vw - 32px) !important;
    height: calc(100vh - 48px);
    max-height: calc(100vh - 48px);
  }
}

.debug-console {
  --debug-chip-radius: var(--radius);
  --debug-radius-xs: calc(var(--radius) * 0.56);
  --debug-radius-sm: calc(var(--radius) * 0.72);
  --debug-radius-md: calc(var(--radius) * 0.94);
  --debug-radius-lg: calc(var(--radius) * 1.18);
  --debug-count-radius: var(--radius);
  --debug-menu-radius: calc(var(--radius) * 1.12);
  --el-border-radius-base: calc(var(--radius) * 0.75);
  --el-border-radius-small: calc(var(--radius) * 0.62);
  --debug-page-bg: #f8fafc;
  --debug-surface: #fff;
  --debug-soft-bg: #f8fafc;
  --debug-soft-bg-strong: #f1f5f9;
  --debug-border: #e2e8f0;
  --debug-border-strong: #cbd5e1;
  --debug-text-muted: #64748b;
  --debug-request-shell-bg: #fff;
  --debug-shadow: 0 8px 18px rgb(15 23 42 / 4%);
  --debug-shadow-strong: 0 12px 26px rgb(15 23 42 / 7%);

  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 16px;
  background: var(--debug-page-bg);
}

/* --- Base64 图片抽屉增强样式 --- */
:deep(.debug-base64-drawer .el-drawer) {
  background: var(--debug-surface);
  border-left: 1px solid var(--debug-border);
  box-shadow: -4px 0 16px color-mix(in srgb, #000 10%, transparent);
}

.debug-base64-drawer__shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--debug-soft-bg); /* 与左侧面板背景统一 */
}

.debug-base64-drawer__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  background: var(--debug-surface);
  border-bottom: 1px solid var(--debug-border);
}

.debug-base64-drawer__title {
  font-size: 15px;
  font-weight: 800;
  color: var(--el-text-color-primary);
}

.debug-base64-drawer__title-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  margin-left: 8px;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  background: var(--el-color-primary);
  border-radius: var(--radius);
}

.debug-base64-drawer__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  overflow-y: auto;
}

.debug-base64-drawer__summary {
  display: flex;
  gap: 8px;
  margin-bottom: 4px;
}

.debug-base64-drawer__list {
  display: flex;
  flex-direction: column;
  gap: 20px; /* 图片卡片之间的明显界限 */
}

.debug-base64-card {
  overflow: hidden;
  background: var(--el-bg-color);
  border: 1px solid var(--debug-border-strong);
  border-radius: var(--debug-radius-md);
  box-shadow: 0 4px 12px
    color-mix(in srgb, var(--el-text-color-primary) 6%, transparent);
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;

  &:hover {
    box-shadow: 0 8px 24px
      color-mix(in srgb, var(--el-text-color-primary) 10%, transparent);
    transform: translateY(-2px);
  }
}

.debug-base64-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--debug-soft-bg-strong);
  border-bottom: 1px solid var(--debug-border);
}

.debug-base64-card__info {
  display: flex;
  flex: 1;
  gap: 8px;
  align-items: center;
  min-width: 0;
}

.debug-base64-card__index {
  padding: 2px 6px;
  font-size: 11px;
  font-weight: 800;
  color: var(--el-color-primary);
  background: color-mix(in srgb, var(--el-color-primary) 10%, transparent);
  border-radius: 4px;
}

.debug-base64-card__path {
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}

.debug-base64-card__preview {
  padding: 12px;
  background: var(--debug-surface);
}

.debug-base64-card__preview-stage {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 180px;
  max-height: 400px;
  overflow: hidden;

  /* 棋盘格背景：适配透明图片 */
  background-color: var(--el-fill-color-lighter);
  background-image:
    linear-gradient(45deg, var(--el-fill-color-darker) 25%, transparent 25%),
    linear-gradient(-45deg, var(--el-fill-color-darker) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--el-fill-color-darker) 75%),
    linear-gradient(-45deg, transparent 75%, var(--el-fill-color-darker) 75%);
  background-position:
    0 0,
    0 10px,
    10px -10px,
    -10px 0;
  background-size: 20px 20px;
  border: 1px solid var(--debug-border);
  border-radius: var(--debug-radius-sm);
  box-shadow: inset 0 2px 8px color-mix(in srgb, #000 5%, transparent);

  img {
    max-width: 100%;
    max-height: 380px;
    object-fit: contain;
    background: transparent;
    filter: drop-shadow(0 4px 12px color-mix(in srgb, #000 15%, transparent));
  }
}

.debug-base64-card__footer {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px 14px;
  background: var(--debug-surface);
  border-top: 1px solid var(--debug-border);

  .debug-base64-card__chip {
    padding: 2px 6px;
    font-size: 10px;
    font-weight: 600;
    color: var(--el-text-color-regular);
    background: var(--debug-soft-bg-strong);
    border: 1px solid var(--debug-border);
    border-radius: 4px;
  }
}

.debug-base64-empty {
  margin-top: 40px;
  opacity: 0.8;
}

/* --- 基础布局与原有样式 --- */

.debug-console__top {
  display: grid;
  flex: none;
  gap: 10px;
  padding: 0;
  margin-bottom: 14px;
  background: transparent;
  border: none;
  box-shadow: none;
}

.debug-console__toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  min-width: 0;
  margin: 0;
}

.debug-console__request-row {
  display: flex;
  flex: 1 1 auto;
  gap: 10px;
  align-items: center;
  min-width: 0;
  min-height: 52px;
  padding: 8px 10px;
  margin: 0;
  background: var(--debug-request-shell-bg);
  border: 1px solid var(--debug-border);
  border-radius: var(--debug-radius-md);
  box-shadow: var(--debug-shadow);
  transition:
    border-color 0.16s ease,
    box-shadow 0.16s ease;
}

.debug-back-button-wrap {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
}

.debug-console__request-row:hover,
.debug-console__request-row:focus-within {
  border-color: color-mix(in srgb, var(--el-color-primary) 34%, transparent);
  box-shadow: var(--debug-shadow-strong);
}

.debug-console__hint {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 10px;
  margin: 0;
  font-size: 11px;
  font-weight: 500;
  color: var(--debug-text-muted);
  background: var(--debug-soft-bg-strong);
  border: 1px solid var(--debug-border);
  border-radius: var(--debug-chip-radius);
}

.debug-console__request-actions {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.debug-console__request-actions::before {
  width: 1px;
  height: 18px;
  content: '';
  background: var(--debug-border);
}

/* 图标按钮组：响应式布局时保证按钮不换行 */
.debug-console__icon-group {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
  align-items: center;
}

.debug-console__body {
  flex: 1;
  min-height: 0;
}

.debug-layout {
  position: relative;
  display: grid;
  grid-template-rows: minmax(0, 1fr) 10px minmax(0, 1fr);
  grid-template-columns: minmax(0, 1fr);
  height: 100%;
  min-height: 0;
}

.debug-layout--horizontal {
  grid-template-rows: minmax(0, 1fr);
  grid-template-columns: minmax(0, 1fr) 10px minmax(0, 1fr);
}

.debug-layout--resizing {
  user-select: none;
}

.debug-pane {
  display: flex;
  min-width: 0;
  min-height: 0;
}

.debug-resizer {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  touch-action: none;
  cursor: row-resize;
}

.debug-resizer__thumb {
  width: 42px;
  height: 4px;
  background: color-mix(in srgb, var(--el-text-color-primary) 20%, transparent);
  border-radius: var(--debug-chip-radius);
  transition: background-color 0.16s ease;
}

.debug-resizer:hover .debug-resizer__thumb {
  background: color-mix(in srgb, var(--el-color-primary) 42%, transparent);
}

.debug-resizer--horizontal {
  cursor: col-resize;
}

.debug-resizer--horizontal .debug-resizer__thumb {
  width: 4px;
  height: 42px;
}

.debug-pane-shell {
  display: flex;
  flex: 1;
  flex-direction: column;
  width: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--debug-surface);
  border: 1px solid var(--debug-border);
  border-radius: var(--debug-radius-lg);
  box-shadow: var(--debug-shadow);
}

.debug-pane__header {
  display: flex;
  flex: none;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  min-height: 42px;
  padding: 0 14px;
  background: var(--debug-surface);
  border-bottom: 1px solid var(--debug-border);
}

.debug-pane__header--inline-tabs {
  flex-wrap: nowrap;
  gap: 10px;
  align-items: center;
}

.debug-pane__header-main {
  display: inline-flex;
  flex: 1;
  flex-wrap: nowrap;
  gap: 8px;
  align-items: center;
  min-width: 0;
}

.debug-pane--response .debug-pane__header--inline-tabs {
  flex-wrap: wrap;
  padding-top: 4px;
  padding-bottom: 4px;
}

.debug-pane--response .debug-pane__header-main {
  flex: 1 1 220px;
  max-width: 100%;
}

.debug-pane__title {
  font-size: 13px;
  font-weight: 800;
  color: var(--el-text-color-primary);
}

.debug-pane__meta {
  font-size: 11px;
  font-weight: 500;
  color: var(--debug-text-muted);
}

.debug-inline-tabs {
  display: inline-flex;
  flex: 1;
  flex-wrap: nowrap;
  gap: 6px;
  align-items: center;
  min-width: 0;
  overflow: hidden;
}

.debug-inline-tab {
  position: relative;
  display: inline-flex;
  flex: none;
  gap: 5px;
  align-items: center;
  justify-content: center;
  max-width: 146px;
  min-height: 42px;
  padding: 0 1px;
  font-size: 12px;
  font-weight: 700;
  color: var(--debug-text-muted);
  cursor: pointer;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 0;
  transition: all 0.14s ease;
}

.debug-inline-tab::after {
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 2px;
  content: '';
  background: transparent;
  border-radius: 999px 999px 0 0;
}

.debug-inline-tab__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.debug-inline-tab:hover {
  color: var(--el-text-color-primary);
  background: transparent;
  border-color: transparent;
}

.debug-inline-tab--active {
  color: var(--el-color-primary);
  background: transparent;
  border-color: transparent;
}

.debug-inline-tab--active::after {
  background: var(--el-color-primary);
}

.debug-inline-tab__count {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  min-width: 15px;
  height: 15px;
  padding: 0 3px;
  font-size: 9.5px;
  font-weight: 700;
  color: var(--debug-text-muted);
  background: var(--debug-soft-bg-strong);
  border: 1px solid var(--debug-border);
  border-radius: var(--radius);
}

.debug-inline-tab--image {
  flex: none;
  max-width: none;
  min-height: 24px;
  padding: 0 8px;
  margin-left: 4px;
  border-color: var(--debug-border);
  border-radius: var(--radius);
}

.debug-inline-tab--image::after,
.debug-inline-tab--more::after {
  display: none;
}

.debug-inline-tab--image:disabled {
  color: var(--el-text-color-placeholder);
  cursor: not-allowed;
  opacity: 0.72;
}

.debug-inline-tab--image:disabled:hover {
  color: var(--el-text-color-placeholder);
  background: var(--debug-soft-bg);
  border-color: var(--debug-border);
}

.debug-inline-tab--more {
  width: 22px;
  min-width: 22px;
  min-height: 24px;
  padding: 0;
  background: transparent;
  border: none;
  box-shadow: none;
}

.debug-inline-tab__more-icon {
  width: 16px;
  height: 16px;
  line-height: 1;
  color: currentcolor;
  transition: transform 0.18s ease;
}

.debug-inline-tab--more:hover,
.debug-inline-tab--more:focus-visible {
  color: var(--el-color-primary);
  background: transparent;
  border-color: transparent;
}

.debug-inline-tab--more:hover .debug-inline-tab__more-icon,
.debug-inline-tab--more:focus-visible .debug-inline-tab__more-icon {
  transform: scale(1.15);
}

.debug-tab-measure {
  position: fixed;
  top: -9999px;
  left: -9999px;
  z-index: -1;
  display: grid;
  visibility: hidden;
  gap: 6px;
  pointer-events: none;
}

:global(.debug-tab-overflow-menu) {
  padding: 4px;
  border-radius: var(--debug-menu-radius);
}

:global(.debug-tab-overflow-menu .el-dropdown-menu__item) {
  border-radius: var(--debug-radius-xs);
}

:global(
  .debug-tab-overflow-menu .el-dropdown-menu__item.debug-hidden-tab--active
) {
  color: var(--el-color-primary);
  background: color-mix(
    in srgb,
    var(--el-color-primary-light-9) 65%,
    var(--el-bg-color) 35%
  );
}

:global(
  .debug-tab-overflow-menu .el-dropdown-menu__item .debug-hidden-tab__label
) {
  margin-right: 6px;
}

:global(
  .debug-tab-overflow-menu .el-dropdown-menu__item .debug-hidden-tab__count
) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  margin-left: auto;
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  background: var(--el-color-primary);
  border-radius: var(--radius, var(--el-border-radius-base, 4px));
}

.debug-icon-button {
  --el-button-bg-color: transparent;
  --el-button-border-color: transparent;
  --el-button-hover-bg-color: transparent;
  --el-button-hover-border-color: transparent;
  --el-button-active-bg-color: transparent;
  --el-button-active-border-color: transparent;
  --el-button-text-color: var(--el-text-color-secondary);
  --el-button-hover-text-color: var(--el-color-primary);

  width: 24px;
  min-width: 24px;
  height: 24px;
  padding: 0;
  color: var(--el-text-color-secondary);
  background: transparent;
  border: none;
  border-radius: 0;
  box-shadow: none;
  transition:
    color 0.18s ease,
    transform 0.18s ease;
}

.debug-icon-button:hover {
  color: var(--el-color-primary);
  background: transparent;
  transform: scale(1.15);
}

.debug-icon-button:focus-visible {
  color: var(--el-color-primary);
  background: transparent;
  transform: scale(1.15);
}

.debug-icon-button--active {
  color: var(--el-color-primary);
  background: transparent;
  border: none;
}

.debug-icon-button :deep(svg) {
  width: 16px;
  height: 16px;
}

.debug-request-input {
  --el-input-border-color: transparent;
  --el-input-focus-border-color: transparent;
  --el-input-hover-border-color: transparent;

  flex: 1 1 200px;
  min-width: 0;
}

:deep(.debug-request-input .el-input__wrapper) {
  min-height: 38px;
  outline: none;
  background: transparent;
  border: none !important;
  border-radius: var(--debug-radius-sm);
  box-shadow: none !important;
}

:deep(.debug-request-input .el-input__wrapper::before),
:deep(.debug-request-input .el-input__wrapper::after) {
  display: none !important;
}

:deep(.debug-request-input .el-input__wrapper:hover) {
  box-shadow: none !important;
}

:deep(.debug-request-input .el-input__wrapper.is-focus) {
  box-shadow: none !important;
}

:deep(.debug-request-input .el-input__prefix) {
  margin-right: 10px;
}

:deep(.debug-request-input .el-input__prefix-inner) {
  display: flex;
  gap: 8px;
  align-items: center;
  min-width: 0;
}

.method-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 72px;
  height: 32px;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 800;
  border-radius: var(--debug-chip-radius);
}

.debug-base-url {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  max-width: clamp(120px, 22vw, 280px);
  height: 30px;
  padding: 0 8px;
  color: var(--debug-text-muted);
  cursor: pointer;
  background: var(--debug-soft-bg);
  border: 1px solid var(--debug-border);
  border-radius: var(--debug-chip-radius);
  transition:
    color 0.16s ease,
    background-color 0.16s ease,
    border-color 0.16s ease;
}

.debug-base-url__icon {
  flex: none;
  width: 12px;
  height: 12px;
}

.debug-base-url__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: 'JetBrains Mono', 'Fira Code', SFMono-Regular, monospace;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.debug-base-url:hover {
  color: var(--el-color-primary);
  background: color-mix(
    in srgb,
    var(--el-color-primary-light-9) 76%,
    var(--debug-surface) 24%
  );
  border-color: color-mix(in srgb, var(--el-color-primary) 32%, transparent);
}

.debug-send-button {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  justify-content: center;
  min-width: 78px;
  height: 32px;
  padding: 0 14px;
  font-size: 12px;
  font-weight: 700;
  border-radius: var(--debug-chip-radius);
  box-shadow: 0 4px 10px
    color-mix(in srgb, var(--el-color-primary) 20%, transparent);
  transition: transform 0.16s ease;
}

.debug-send-button:hover {
  transform: translateY(-1px);
}

.debug-send-button__icon {
  width: 14px;
  height: 14px;
}

.debug-back-button {
  --el-button-bg-color: var(--debug-surface);
  --el-button-border-color: var(--debug-border);
  --el-button-hover-bg-color: color-mix(
    in srgb,
    var(--el-color-primary-light-9) 62%,
    transparent
  );
  --el-button-hover-border-color: color-mix(
    in srgb,
    var(--el-color-primary) 34%,
    transparent
  );
  --el-button-active-bg-color: var(--el-color-primary-light-9);
  --el-button-active-border-color: color-mix(
    in srgb,
    var(--el-color-primary) 40%,
    transparent
  );
  --el-button-text-color: var(--el-text-color-regular);
  --el-button-hover-text-color: var(--el-color-primary);

  display: inline-flex;
  flex: none;
  gap: 7px;
  align-items: center;
  height: 52px;
  padding: 0 16px;
  font-size: 14.5px;
  font-weight: 700;
  color: var(--el-text-color-regular);
  background: var(--debug-surface);
  border: 1px solid var(--debug-border);
  border-radius: var(--debug-radius-md);
  box-shadow: 0 3px 9px
    color-mix(in srgb, var(--el-text-color-primary) 5%, transparent);
  transition:
    border-color 0.16s ease,
    box-shadow 0.16s ease,
    color 0.16s ease,
    background-color 0.16s ease;
}

.debug-back-button:hover {
  color: var(--el-color-primary);
  background: color-mix(
    in srgb,
    var(--el-color-primary-light-9) 62%,
    transparent
  );
  border-color: color-mix(in srgb, var(--el-color-primary) 34%, transparent);
  box-shadow: 0 5px 14px
    color-mix(in srgb, var(--el-color-primary) 9%, transparent);
}

.debug-back-button__icon {
  width: 18px;
  height: 18px;
}

.debug-tabs-wrap,
.debug-response-wrap {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--debug-surface);
}

/* 作为参数值编辑覆盖层（Teleport 自 params-table）的定位上下文，使其填满请求参数区 */
.debug-tabs-wrap {
  position: relative;
}

.debug-section-title {
  margin-top: 2px;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 700;
  color: var(--el-text-color-secondary);
}

.params-tab-sections {
  display: grid;
  gap: 16px;
}

.response-body {
  height: 100%;
  min-height: 0;
}

.response-body--code {
  overflow: auto;
}

:deep(.response-body.theme-light),
:deep(.response-body.theme-dark) {
  height: 100%;
  min-height: 0;
  background: transparent;
  border: none;
  border-radius: 0;
}

.debug-status-list {
  display: flex;
  flex: 0 1 auto;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  justify-content: flex-end;
  min-width: 0;
  max-width: 100%;
}

.debug-status-chip {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  max-width: 100%;
  min-height: 22px;
  padding: 0 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
  background: var(--debug-soft-bg-strong);
  border: 1px solid var(--debug-border);
  border-radius: var(--debug-chip-radius);
}

.debug-status-chip--success {
  color: var(--el-color-success-dark-2);
  background: var(--el-color-success-light-9);
  border-color: var(--el-color-success-light-7);
}

.debug-status-chip--error {
  color: var(--el-color-danger-dark-2);
  background: var(--el-color-danger-light-9);
  border-color: var(--el-color-danger-light-7);
}

.debug-status-chip--default {
  color: var(--el-text-color-secondary);
}

.debug-status-chip--metric {
  color: var(--el-text-color-primary);
}

.response-headers {
  padding: 0 2px 10px 1px;
}

.actual-request {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.actual-request__block {
  min-width: 0;
}

/* 去掉外层包裹框，仅以左侧强调条 + 标签区分分组，内部表格/代码块自带唯一边框 */
.actual-request__title {
  display: flex;
  align-items: center;
  padding-left: 8px;
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.3;
  color: var(--debug-text-muted);
  border-left: 3px solid var(--el-color-primary);
}

.actual-request__code {
  padding: 10px;
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-primary);
  word-break: break-all;
  white-space: pre-wrap;
  background: var(--debug-soft-bg);
  border: 1px solid var(--debug-border);
  border-radius: var(--debug-radius-xs);
}

:deep(.actual-request__block .el-table) {
  width: 100% !important;
  min-width: 0;
}

:deep(.actual-request__block .el-table .cell) {
  word-break: break-all;
  overflow-wrap: anywhere;
}

.loading-text {
  display: flex;
  gap: 2px;
  align-items: center;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.loading-dots {
  display: inline-flex;
  gap: 2px;
}

.loading-dots .dot {
  color: #409eff;
  animation: dot-pulse 1.5s infinite;
  animation-fill-mode: both;
}

.loading-dots .dot:nth-child(1) {
  animation-delay: 0s;
}

.loading-dots .dot:nth-child(2) {
  animation-delay: 0.2s;
}

.loading-dots .dot:nth-child(3) {
  animation-delay: 0.4s;
}

:deep(.debug-tabs.el-tabs),
:deep(.debug-response-tabs.el-tabs) {
  width: 100%;
  height: 100%;
  overflow: hidden;

  .el-tabs__header {
    margin: 0;
    background: var(--debug-surface);
    border-bottom: 1px solid var(--debug-border);
  }

  .el-tabs__nav-wrap::after {
    display: none;
  }

  .el-tabs__nav-wrap {
    padding: 0 10px;
  }

  .el-tabs__item {
    height: 36px;
    padding: 0 6px;
    font-size: 12px;
    font-weight: 600;
    line-height: 36px;
  }

  .el-tabs__item.is-active {
    font-weight: 700;
    color: var(--el-color-primary);
  }

  .el-tabs__active-bar {
    height: 2px;
    border-radius: var(--debug-radius-xs) var(--debug-radius-xs) 0 0;
  }

  .el-tabs__content {
    height: calc(100% - 37px);
  }

  .el-tab-pane {
    width: 100%;
    height: 100%;
    padding: 10px 12px 12px;
    overflow: hidden auto;
  }
}

:deep(.debug-tabs--inline.el-tabs .el-tabs__header),
:deep(.debug-response-tabs--inline.el-tabs .el-tabs__header) {
  display: none;
}

:deep(.debug-tabs--inline.el-tabs .el-tabs__content),
:deep(.debug-response-tabs--inline.el-tabs .el-tabs__content) {
  height: 100%;
}

:deep(.debug-response-wrap .el-empty) {
  height: 100%;
}

:deep(.debug-response-wrap .el-empty__description p) {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

:global(.document-page--dark .debug-console),
:global(html.dark .debug-console) {
  --debug-page-bg: var(--el-bg-color);
  --debug-surface: color-mix(in srgb, var(--el-bg-color) 92%, #fff 8%);
  --debug-soft-bg: color-mix(
    in srgb,
    var(--el-bg-color) 86%,
    var(--el-fill-color-light) 14%
  );
  --debug-soft-bg-strong: color-mix(
    in srgb,
    var(--el-bg-color) 76%,
    var(--el-fill-color-light) 24%
  );
  --debug-border: color-mix(
    in srgb,
    var(--el-text-color-primary) 16%,
    transparent
  );
  --debug-border-strong: color-mix(
    in srgb,
    var(--el-text-color-primary) 24%,
    transparent
  );
  --debug-text-muted: var(--el-text-color-secondary);
  --debug-request-shell-bg: color-mix(
    in srgb,
    var(--el-bg-color) 88%,
    #fff 12%
  );
  --debug-shadow: 0 8px 20px color-mix(in srgb, #000 45%, transparent);
  --debug-shadow-strong: 0 12px 26px color-mix(in srgb, #000 52%, transparent);
}

:global(.document-page--dark .debug-base-url:hover),
:global(html.dark .debug-base-url:hover),
:global(.document-page--dark .debug-back-button:hover),
:global(html.dark .debug-back-button:hover) {
  background: color-mix(in srgb, var(--el-color-primary) 14%, transparent);
}

:global(.document-page--dark .debug-status-chip--success),
:global(html.dark .debug-status-chip--success) {
  color: #34d399;
  background: rgb(16 185 129 / 12%);
  border-color: rgb(16 185 129 / 32%);
}

:global(.document-page--dark .debug-status-chip--error),
:global(html.dark .debug-status-chip--error) {
  color: #fb7185;
  background: rgb(244 63 94 / 12%);
  border-color: rgb(244 63 94 / 32%);
}

:global(.document-page--dark .debug-status-chip--metric),
:global(html.dark .debug-status-chip--metric),
:global(.document-page--dark .actual-request__code),
:global(html.dark .actual-request__code) {
  color: var(--el-text-color-primary);
}

:global(.document-page--dark .debug-base64-card__preview-stage),
:global(html.dark .debug-base64-card__preview-stage) {
  background-color: color-mix(in srgb, var(--el-bg-color) 78%, #fff 10%);
  background-image:
    linear-gradient(45deg, rgb(255 255 255 / 7%) 25%, transparent 25%),
    linear-gradient(-45deg, rgb(255 255 255 / 7%) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgb(255 255 255 / 7%) 75%),
    linear-gradient(-45deg, transparent 75%, rgb(255 255 255 / 7%) 75%);
}

/* 全局配置弹窗样式：弹窗固定高度，整体不滚动；参数表格约 8 行后在右侧卡片内滚动 */
:global(.global-config-dialog-overlay) {
  overflow: hidden;
}

:global(.global-config-dialog-overlay .el-overlay-dialog) {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
  overflow: hidden;
}

:global(.global-config-dialog) {
  display: flex;
  flex-direction: column;
  height: 760px;
  max-height: calc(100vh - 80px);
  margin: 0 !important;
  overflow: hidden;
}

:global(.global-config-dialog .el-dialog__header) {
  flex: none;
}

:global(.global-config-dialog .el-dialog__body) {
  flex: 1;
  min-height: 0;

  /* body 不滚动，滚动交给内部参数表格和认证列表 */
  padding: 16px 20px 20px;
  overflow: hidden;
}

:global(.global-config-dialog .global-config-panel) {
  grid-template-columns: 180px minmax(0, 1fr);
  height: 100%;
  min-height: 0;
}

:global(.global-config-dialog .gcp-content) {
  min-height: 0;
  overflow: hidden;
}

:global(.global-config-dialog .gcp-section--params) {
  overflow: hidden !important;
}

:global(.global-config-dialog .gcp-section--params .config-card) {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

:global(.global-config-dialog .gcp-section--params .el-card__header) {
  flex: none;
}

:global(.global-config-dialog .gcp-section--params .el-card__body) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  padding: 18px 20px 20px;
  overflow: hidden;
}

:global(.global-config-dialog .gcp-section--params .el-alert),
:global(.global-config-dialog .gcp-section--params .el-form) {
  flex: none;
}

:global(.global-config-dialog .gcp-section--params .el-tabs) {
  flex: 1;
  min-height: 0;
}

:global(.global-config-dialog .gcp-section--params .el-tab-pane) {
  min-height: 0;
  overflow: hidden;
}

:global(.global-config-dialog .gcp-section--params .el-table) {
  width: 100%;
}

:global(.global-config-dialog .gcp-section--params .el-table__inner-wrapper) {
  min-width: 0;
}

:global(.global-config-dialog .gcp-section--params .el-table__cell .cell) {
  white-space: nowrap;
}
</style>
