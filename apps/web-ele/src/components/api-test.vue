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
  SvgApiPrefixIcon,
  SvgDocumentLayoutIcon,
  SvgDocumentOmittedIcon,
  SvgDocumentResetIcon,
} from '@vben/icons';
import { usePreferences } from '@vben/preferences';

import {
  ElButton,
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
import {
  buildDetectedImageFileName,
  detectBase64ImagesInData,
  formatDetectedImageSize,
} from '#/utils/base64-image';
import { copyText } from '#/utils/clipboard';
import { adaptSchemaForView, hasRenderableSchema } from '#/utils/schema';

import bodyParams from './body-params.vue';
import paramsTable from './params-table.vue';

interface TableParamsObject {
  contentType?: string;
  description?: string;
  enabled: boolean;
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
let persistTimer: null | number = null;

const methodPillStyle = computed(() => {
  return getMethodStyle(props.method, isDark.value);
});

const normalizeParamName = (name: string) => name.trim();
const normalizeHeaderName = (name: string) => name.trim().toLowerCase();
const PATH_PLACEHOLDER_SEGMENT_RE = /^\{[^/{}]+\}$/;

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
  return items.map((item) => ({
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
  }));
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
  base64ImageDrawerVisible.value = false;
  responseMimeType.value = '';
  responseHeaders.value = [];
  actualRequestSnapshot.value = null;
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
const responseMimeType = ref('');
const responseHeaders = ref<
  Array<{ enabled: boolean; name: string; value: string }>
>([]);

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

const responseInlineTabs = computed<DebugInlineTab[]>(() => {
  return [
    {
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
const requestVisibleTabKeys = ref<string[]>([]);
const responseVisibleTabKeys = ref<string[]>([]);
const requestTabMeasureRefs = new Map<string, HTMLElement>();
const responseTabMeasureRefs = new Map<string, HTMLElement>();
const TAB_OVERFLOW_GAP = 4;
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
      adjustedKeys.splice(0, adjustedKeys.length, activeKey);
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
  const visibleKeySet = new Set(requestVisibleTabKeys.value);
  const tabs = requestInlineTabs.value;
  if (visibleKeySet.size === 0) {
    return tabs;
  }
  return tabs.filter((tab) => visibleKeySet.has(tab.key));
});

const requestHiddenTabs = computed(() => {
  const visibleKeySet = new Set(requestVisibleTabs.value.map((tab) => tab.key));
  return requestInlineTabs.value.filter((tab) => !visibleKeySet.has(tab.key));
});

const responseVisibleTabs = computed(() => {
  const visibleKeySet = new Set(responseVisibleTabKeys.value);
  const tabs = responseInlineTabs.value;
  if (visibleKeySet.size === 0) {
    return tabs;
  }
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

const isStackedLayout = computed(() => paneLayout.value === 'vertical');
const layoutTooltipText = computed(() => {
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
        securityCookieRows.push({
          name: item.name,
          enabled: true,
          fromSecurity: true,
          value: item.tokenValue,
          description: item.description,
          type: item.type,
        });
        return;
      }
      case 'header': {
        const normalizedName = normalizeHeaderName(item.name);
        if (localHeaderNames.has(normalizedName)) {
          return;
        }
        localHeaderNames.add(normalizedName);
        securityHeaderRows.push({
          enabled: true,
          fromSecurity: true,
          name: item.name,
          value: item.tokenValue,
          description: item.description,
          type: item.type,
        });
        return;
      }
      case 'query': {
        if (localQueryNames.has(item.name)) {
          return;
        }
        localQueryNames.add(item.name);
        securityQueryRows.push({
          name: item.name,
          enabled: true,
          fromSecurity: true,
          value: item.tokenValue,
          description: item.description,
          type: item.type,
        });
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
    .map((item) => ({
      description: item.description || '全局参数',
      enabled: true,
      fromGlobal: true,
      name: normalizeParamName(item.name || ''),
      type: 'string',
      value: item.value,
    }));
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
    .map((item) => ({
      description: item.description || '全局参数',
      enabled: true,
      fromGlobal: true,
      name: normalizeParamName(item.name || ''),
      type: 'string',
      value: item.value,
    }));
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

const prettyFormatXml = (xmlString: string) => {
  const xml = xmlString.replaceAll(/>\s*</g, '><').trim();
  if (!xml) return xmlString;

  const parts = xml.replaceAll(/(>)(<)(\/*)/g, '$1\n$2$3').split('\n');
  let indent = 0;

  return parts
    .map((part) => {
      const line = part.trim();
      if (!line) return '';

      if (line.startsWith('</')) {
        indent = Math.max(indent - 1, 0);
      }

      const padding = '  '.repeat(indent);
      const result = `${padding}${line}`;

      if (
        line.startsWith('<') &&
        !line.startsWith('</') &&
        !line.endsWith('/>') &&
        !line.includes('</')
      ) {
        indent += 1;
      }
      return result;
    })
    .filter(Boolean)
    .join('\n');
};

const formatXml = (text: string) => {
  if (!text) return '';
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(text, 'application/xml');
    const parseError = xmlDoc.querySelector('parsererror');
    if (parseError) {
      return text;
    }
    const serialized = new XMLSerializer().serializeToString(xmlDoc);
    return prettyFormatXml(serialized);
  } catch {
    return text;
  }
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
    return {
      contentType,
      data: formatXml(rawText),
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

async function sendRequest() {
  loading.value = true;
  responseLoading.value = true;
  const startTime = performance.now(); // 记录开始时间;
  const abortController = new AbortController();
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
    // 处理响应：按 content-type 自动解析 JSON/XML/Text/Form/Binary
    const parsedResponse = await parseResponseBody(
      response,
      finalUrl.toString(),
    );

    responseTime.value = Number((performance.now() - startTime).toFixed(2));
    responseStatus.value = {
      code: response.status,
      text: `${response.status} ${response.statusText}`,
      type: response.ok ? 'success' : 'error',
    };
    responseData.value = parsedResponse.data;
    responseMimeType.value = parsedResponse.contentType || '-';

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
    const size =
      typeof parsedResponse.data === 'string'
        ? parsedResponse.data.length * 2 // 字符串按UTF-16计算
        : JSON.stringify(parsedResponse.data ?? '').length * 2;
    responseSize.value = formatSize(size);
  } catch (error: any) {
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
  window.addEventListener('pagehide', handlePageHide);
  syncSecurityParamsToDebugTable();
  syncGlobalParamsToDebugTable();
  await captureDefaultRequestState();

  if (apiTestCacheStore.debugCacheEnabled) {
    const cachedState = apiTestCacheStore.getRequestCache(cacheKey.value);
    if (cachedState) {
      await applySnapshot(cachedState, {
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
  window.removeEventListener('pagehide', handlePageHide);
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
            <ElTooltip v-if="baseUrl" placement="top" :content="baseUrl">
              <ElButton
                text
                class="debug-prefix-button"
                @click="handleCopyBaseUrl"
              >
                <SvgApiPrefixIcon class="debug-prefix-button__icon" />
              </ElButton>
            </ElTooltip>
          </template>
        </ElInput>
        <div class="debug-console__request-actions">
          <ElButton
            type="primary"
            class="debug-send-button"
            :loading="loading"
            @click="sendRequest"
          >
            发送
          </ElButton>
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
                    <div v-if="pathParams.length > 0">
                      <div class="actual-request__block params-table-block">
                        <div class="params-table-block__header">
                          <h3 class="actual-request__title">Path 参数</h3>
                        </div>
                        <div class="params-table-block__body">
                          <params-table
                            :table-data="pathParams"
                            :allow-delete="false"
                            :show-add-button="false"
                            :show-selection-column="false"
                            show-description-column
                          />
                        </div>
                      </div>
                    </div>

                    <div>
                      <div class="actual-request__block params-table-block">
                        <div class="params-table-block__header">
                          <h3 class="actual-request__title">Query 参数</h3>
                        </div>
                        <div class="params-table-block__body">
                          <params-table
                            :table-data="queryParams"
                            show-description-column
                            show-delete-in-description
                          />
                        </div>
                      </div>
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
                  <div class="actual-request__block params-table-block">
                    <div class="params-table-block__header">
                      <h3 class="actual-request__title">Headers</h3>
                    </div>
                    <div class="params-table-block__body">
                      <params-table
                        :table-data="headers"
                        show-description-column
                        show-delete-in-description
                      />
                    </div>
                  </div>
                </ElTabPane>
                <ElTabPane name="Cookies" label="Cookies">
                  <div class="actual-request__block params-table-block">
                    <div class="params-table-block__header">
                      <h3 class="actual-request__title">Cookies</h3>
                    </div>
                    <div class="params-table-block__body">
                      <params-table :table-data="cookies" />
                    </div>
                  </div>
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
                  <ElTabPane name="RealtimeResponse" label="实时响应" lazy>
                    <template v-if="responseStatus.type !== 'default'">
                      <JsonViewer
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
  .debug-console__request-row {
    flex-direction: column;
    align-items: stretch;
  }

  .debug-console__request-actions {
    justify-content: flex-end;
    padding-left: 0;
  }

  .debug-console__request-actions::before {
    display: none;
  }

  .debug-send-button {
    min-width: 92px;
  }

  .debug-status-list {
    justify-content: flex-start;
  }
}

.debug-console {
  --debug-chip-radius: var(--radius);
  --debug-radius-xs: var(--radius);
  --debug-radius-sm: calc(var(--radius) * 1.08);
  --debug-radius-md: calc(var(--radius) * 1.16);
  --debug-radius-lg: calc(var(--radius) * 1.24);
  --debug-count-radius: var(--radius);
  --debug-menu-radius: calc(var(--radius) * 1.12);
  --el-border-radius-base: var(--radius);
  --el-border-radius-small: var(--radius);
  --debug-surface: var(--el-bg-color);
  --debug-soft-bg: color-mix(
    in srgb,
    var(--el-bg-color) 92%,
    var(--el-fill-color-light) 8%
  );
  --debug-soft-bg-strong: color-mix(
    in srgb,
    var(--el-bg-color) 86%,
    var(--el-fill-color-light) 14%
  );
  --debug-border: color-mix(
    in srgb,
    var(--el-text-color-primary) 12%,
    transparent
  );
  --debug-border-strong: color-mix(
    in srgb,
    var(--el-text-color-primary) 22%,
    transparent
  );
  --debug-request-shell-bg: color-mix(
    in srgb,
    var(--debug-surface) 88%,
    var(--el-fill-color-light) 12%
  );
  --debug-request-shell-top-line: color-mix(in srgb, #8d97a7 34%, transparent);
  --debug-request-shell-bottom-line: color-mix(
    in srgb,
    #8d97a7 20%,
    transparent
  );
  --debug-request-shell-shadow:
    inset 0 1px 0 var(--debug-request-shell-top-line),
    inset 0 -1px 0 var(--debug-request-shell-bottom-line),
    0 0 0 1px color-mix(in srgb, #9aa3b2 20%, transparent),
    0 9px 18px -15px color-mix(in srgb, #7f8899 42%, transparent),
    0 -9px 18px -15px color-mix(in srgb, #8e97a6 44%, transparent);
  --debug-request-shell-shadow-hover:
    inset 0 1px 0 color-mix(in srgb, #8692a5 42%, transparent),
    inset 0 -1px 0 color-mix(in srgb, #8692a5 24%, transparent),
    0 0 0 1px color-mix(in srgb, #8d97a7 24%, transparent),
    0 11px 22px -15px color-mix(in srgb, #738093 48%, transparent),
    0 -11px 22px -15px color-mix(in srgb, #8d97a7 50%, transparent);
  --debug-shadow: 0 6px 14px
    color-mix(in srgb, var(--el-text-color-primary) 3%, transparent);

  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
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
  gap: 9px;
  padding: 0;
  margin-bottom: 10px;
  background: transparent;
  border: none;
  box-shadow: none;
}

.debug-console__request-row {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 7px 10px;
  margin: 0 2px;
  background: var(--debug-request-shell-bg);
  border-radius: var(--debug-radius-md);
  box-shadow: var(--debug-request-shell-shadow);
  transition: box-shadow 0.16s ease;
}

.debug-console__request-row:hover,
.debug-console__request-row:focus-within {
  box-shadow: var(--debug-request-shell-shadow-hover);
}

.debug-console__hint {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 10px;
  margin: 0 2px;
  font-size: 11px;
  font-weight: 500;
  color: var(--el-text-color-secondary);
  background: var(--debug-soft-bg-strong);
  border: 1px solid var(--debug-border);
  border-radius: var(--debug-chip-radius);
}

.debug-console__request-actions {
  display: inline-flex;
  flex: none;
  gap: 8px;
  align-items: center;
  padding-left: 8px;
}

.debug-console__request-actions::before {
  width: 1px;
  height: 18px;
  content: '';
  background: var(--debug-border);
}

.debug-console__body {
  flex: 1;
  min-height: 0;
}

.debug-layout {
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
  background: var(--debug-soft-bg);
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

.debug-pane__title {
  font-size: 13px;
  font-weight: 800;
  color: var(--el-text-color-primary);
}

.debug-pane__meta {
  font-size: 11px;
  font-weight: 500;
  color: var(--el-text-color-secondary);
}

.debug-inline-tabs {
  display: inline-flex;
  flex: 1;
  flex-wrap: nowrap;
  gap: 4px;
  align-items: center;
  min-width: 0;
  overflow: hidden;
}

.debug-inline-tab {
  display: inline-flex;
  flex: none;
  gap: 3px;
  align-items: center;
  justify-content: center;
  max-width: 146px;
  min-height: 23px;
  padding: 0 7px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--debug-radius-xs);
  transition: all 0.14s ease;
}

.debug-inline-tab__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.debug-inline-tab:hover {
  color: var(--el-text-color-primary);
  background: var(--debug-soft-bg-strong);
  border-color: var(--debug-border);
}

.debug-inline-tab--active {
  color: var(--el-color-primary);
  background: color-mix(
    in srgb,
    var(--el-color-primary-light-9) 70%,
    var(--debug-surface) 30%
  );
  border-color: color-mix(in srgb, var(--el-color-primary) 28%, transparent);
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
  color: #fff;
  background: var(--el-color-primary);
  border-radius: var(--radius);
}

.debug-inline-tab--image {
  flex: none;
  max-width: none;
  margin-left: 4px;
  border-color: var(--debug-border);
  border-radius: var(--radius);
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
  border-radius: var(--debug-count-radius);
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

  flex: 1;
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

.debug-prefix-button {
  width: 30px;
  height: 30px;
  color: var(--el-text-color-secondary);
  border-radius: var(--debug-chip-radius);
  transition: all 0.16s ease;
}

.debug-prefix-button__icon {
  width: 18px;
  height: 18px;
}

.debug-prefix-button:hover {
  color: var(--el-color-primary);
  background: color-mix(
    in srgb,
    var(--el-color-primary-light-9) 65%,
    transparent
  );
}

.debug-send-button {
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

.debug-tabs-wrap,
.debug-response-wrap {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--debug-soft-bg);
}

.debug-section-title {
  margin-top: 2px;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 700;
  color: var(--el-text-color-secondary);
}

.params-table-block {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 0;
  overflow: hidden;
}

.params-tab-sections {
  display: grid;
  gap: 12px;
}

.params-table-block__header {
  display: flex;
  align-items: center;
  min-height: 36px;
  padding: 8px 12px;
  background: var(--debug-soft-bg-strong);
  border-bottom: 1px solid var(--debug-border);
}

.params-table-block__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 8px 12px 10px;
  overflow: hidden;
}

.params-table-block__header .actual-request__title {
  margin-bottom: 0;
}

.response-body {
  height: 100%;
  min-height: 0;
}

:deep(.response-body.theme-light),
:deep(.response-body.theme-dark) {
  height: 100%;
  min-height: 0;
}

.debug-status-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}

.debug-status-chip {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
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
  gap: 10px;
  min-width: 0;
}

.actual-request__block {
  min-width: 0;
  padding: 10px;
  overflow-x: auto;
  background: var(--debug-surface);
  border: 1px solid var(--debug-border);
  border-radius: var(--debug-radius-xs);
}

.actual-request__block.params-table-block {
  padding: 0;
  overflow: hidden;
}

.actual-request__title {
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.actual-request__code {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
  word-break: break-all;
  white-space: pre-wrap;
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

:deep(.document-page--dark .debug-console),
:deep(html.dark .debug-console) {
  --debug-surface: #1c1e23;
  --debug-soft-bg: #1c1e23;
  --debug-soft-bg-strong: #23272e;
  --debug-border: color-mix(in srgb, #fff 6%, transparent);
  --debug-border-strong: color-mix(in srgb, #fff 9%, transparent);
  --debug-request-shell-bg: #20242b;
  --debug-request-shell-top-line: color-mix(in srgb, #fff 18%, transparent);
  --debug-request-shell-bottom-line: color-mix(in srgb, #fff 10%, transparent);
  --debug-request-shell-shadow:
    inset 0 1px 0 var(--debug-request-shell-top-line),
    inset 0 -1px 0 var(--debug-request-shell-bottom-line),
    0 8px 18px -14px color-mix(in srgb, #000 58%, transparent),
    0 -8px 18px -14px color-mix(in srgb, #fff 12%, transparent);
  --debug-request-shell-shadow-hover:
    inset 0 1px 0 color-mix(in srgb, #fff 24%, transparent),
    inset 0 -1px 0 color-mix(in srgb, #fff 14%, transparent),
    0 10px 22px -14px color-mix(in srgb, #000 62%, transparent),
    0 -10px 22px -14px color-mix(in srgb, #fff 16%, transparent);
  --debug-shadow: 0 8px 20px color-mix(in srgb, #000 45%, transparent);
}
</style>
