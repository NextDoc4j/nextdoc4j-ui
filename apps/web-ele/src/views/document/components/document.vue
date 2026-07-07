<script setup lang="ts">
import type { ApiInfo, SecuritySchemeObject } from '#/typings/openApi';
import type { SecurityMetadata } from '#/utils/securityexpand';

import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';
import { useRoute } from 'vue-router';

import {
  ApiTestRun,
  ApiTestRunning,
  SvgAiCopyIcon,
  SvgApiPrefixIcon,
  SvgCopyIcon,
  SvgDoubleArrowUpIcon,
} from '@vben/icons';
import { usePreferences } from '@vben/preferences';

import {
  ElButton,
  ElDialog,
  ElMessage,
  ElOption,
  ElSelect,
  ElTag,
  ElTooltip,
} from 'element-plus';

import JsonViewer from '#/components/json-viewer/index.vue';
import MarkdownCodeBlock from '#/components/markdown-code-block.vue';
import SchemaView from '#/components/schema-view.vue';
import { getMethodStyle } from '#/constants/methods';
import { useApiStore } from '#/store';
import { buildApiDocPrompt } from '#/utils/ai-copy';
import { renderTypeDefinitions } from '#/utils/api-code-example';
import { copyText } from '#/utils/clipboard';
import {
  adaptSchemaForView,
  hasRenderableSchema,
  parseSchemaRefName,
} from '#/utils/schema';
import { parseSecurityMetadata } from '#/utils/securityexpand';

import ParameterView from './parameter-view.vue';
import PathSegment from './path-segment.vue';
import SecurityView from './security-view.vue';

interface AuthMethodItem {
  description?: string;
  detail?: string;
  label: string;
}

interface DebugPayload {
  info: ApiInfo;
  requestBodyType: string;
  requestBodyVariantState: Record<string, number>;
}

interface ResponseExampleOption {
  description?: string;
  key: string;
  label: string;
  value: unknown;
}

interface DocumentUiState {
  activeRequestSections: string[];
  activeResponseCode: string;
}

type CodeDialogScope = 'request' | 'response';

defineOptions({
  name: 'DocumentView',
});

const props = defineProps<{
  showTest: boolean;
}>();

const emits = defineEmits<{
  test: [data: DebugPayload];
}>();

const documentUiStateCache = new Map<string, DocumentUiState>();

const { isDark } = usePreferences();
const route = useRoute();
const apiStore = useApiStore();

const baseUrl = ref('');
const apiInfo = ref({} as ApiInfo);
const activeResponseCode = ref('');
const activeRequestSections = ref<string[]>([]);
const requestBodyType = ref('');
const requestBodyVariantState = ref<Record<string, number>>({});
const responseExampleSelection = ref<Record<string, string>>({});
// 右侧响应示例卡片当前选中的状态码 tab（与左侧响应参数手风琴的选中态互相独立）
const activeExampleCode = ref('');
const responseVariantState = ref<Record<string, Record<string, number>>>({});
const codeDialogVisible = ref(false);
const codeDialogScope = ref<CodeDialogScope>('request');
const asideStackRef = ref<HTMLElement | null>(null);
const asideShouldFlow = ref(false);
let asideResizeObserver: null | ResizeObserver = null;

const displayTags = computed(() => {
  const tags = apiInfo.value?.tags?.filter(Boolean) ?? [];
  if (tags.length > 0) {
    return tags;
  }

  const routeName = route.name as string;
  const fallbackTag = routeName?.split('*')[1] || '';
  return fallbackTag ? [fallbackTag] : [];
});

const summaryText = computed(() => {
  return apiInfo.value.summary || apiInfo.value.operationId || '未命名接口';
});

const descriptionText = computed(() => {
  return apiInfo.value.description || '暂无描述';
});

const methodStyle = computed(() => {
  const method = apiInfo.value.method?.toUpperCase?.() || 'GET';
  return getMethodStyle(method, isDark.value);
});

const securityMetadata = computed<null | SecurityMetadata>(() => {
  return parseSecurityMetadata(apiInfo.value);
});

const parametersInPath = computed(() => {
  return apiInfo.value?.parameters?.filter((item) => item.in === 'path') ?? [];
});

const parametersInQuery = computed(() => {
  return apiInfo.value?.parameters?.filter((item) => item.in === 'query') ?? [];
});

const requestSectionNames = computed(() => {
  const sections: string[] = [];
  if (parametersInPath.value.length > 0) {
    sections.push('path');
  }
  if (parametersInQuery.value.length > 0) {
    sections.push('query');
  }
  if (requestBody.value) {
    sections.push('body');
  }
  return sections;
});

const responseCodes = computed(() => {
  return Object.keys(apiInfo.value?.responses || {});
});

const routeUiStateKey = computed(() => {
  const routeName = typeof route.name === 'string' ? route.name : '';
  return route.fullPath || route.path || routeName;
});

const getDefaultResponseCode = () => {
  const codes = responseCodes.value;
  return codes.includes('200') ? '200' : codes[0] || '';
};

const persistDocumentUiState = () => {
  const key = routeUiStateKey.value;
  if (!key) {
    return;
  }

  documentUiStateCache.set(key, {
    activeRequestSections: [...activeRequestSections.value],
    activeResponseCode: activeResponseCode.value,
  });
};

const restoreDocumentUiState = () => {
  const cachedState = documentUiStateCache.get(routeUiStateKey.value);

  if (cachedState) {
    activeRequestSections.value = cachedState.activeRequestSections.filter(
      (name) => requestSectionNames.value.includes(name),
    );
    activeResponseCode.value =
      cachedState.activeResponseCode === '' ||
      responseCodes.value.includes(cachedState.activeResponseCode)
        ? cachedState.activeResponseCode
        : getDefaultResponseCode();
  } else {
    activeRequestSections.value = [...requestSectionNames.value];
    activeResponseCode.value = getDefaultResponseCode();
  }

  persistDocumentUiState();
};

const loadCurrentDocument = () => {
  const routeName = route.name;
  baseUrl.value = apiStore.openApi?.servers?.[0]?.url || '';

  if (!routeName || typeof routeName !== 'string') {
    console.warn('Route name is not available');
    apiInfo.value = {} as ApiInfo;
    activeRequestSections.value = [];
    activeResponseCode.value = '';
    return;
  }

  const [group = '', tag = '', operationId = ''] = routeName.split('*') ?? [];
  const data = apiStore.searchPathData(group, tag, operationId);
  apiInfo.value = data || ({} as ApiInfo);

  responseExampleSelection.value = {};
  responseVariantState.value = {};

  restoreDocumentUiState();
};

const securitySchemeMap = computed<Record<string, SecuritySchemeObject>>(() => {
  return apiStore.openApi?.components?.securitySchemes || {};
});

const schemaMap = computed(() => {
  return apiStore.openApi?.components?.schemas || {};
});

const authMethods = computed<AuthMethodItem[]>(() => {
  const security = apiInfo.value?.security;
  if (!Array.isArray(security) || security.length === 0) {
    return [];
  }

  const names = [
    ...new Set(
      security.flatMap((item) => {
        return Object.keys(item || {});
      }),
    ),
  ];

  if (names.length === 0) {
    return [];
  }

  return names.map((name) => {
    const scheme = securitySchemeMap.value[name];
    if (!scheme) {
      return {
        label: name,
      };
    }

    if (scheme.type === 'http') {
      const schemeName = scheme.scheme?.toLowerCase();
      if (schemeName === 'bearer') {
        return {
          label: 'Bearer Token',
          description: scheme.description,
          detail: scheme.bearerFormat || 'Header · Authorization',
        };
      }

      return {
        description: scheme.description,
        label: `HTTP ${scheme.scheme?.toUpperCase() || 'AUTH'}`,
        detail: scheme.description,
      };
    }

    if (scheme.type === 'apiKey') {
      return {
        description: scheme.description,
        label: 'API Key',
        detail: `${scheme.in || 'header'} · ${scheme.name || name}`,
      };
    }

    return {
      description: scheme.description,
      label: scheme.type || name,
      detail: scheme.description,
    };
  });
});

const showSecurityPanel = computed(() => {
  const hasAuthMethods = authMethods.value.length > 0;
  const metadata = securityMetadata.value;
  if (!metadata) {
    return hasAuthMethods;
  }
  if (metadata.ignore) {
    return true;
  }

  const hasPermissionGroups = (metadata.permissions || []).some((item: any) => {
    return (
      (Array.isArray(item.values) && item.values.length > 0) ||
      (Array.isArray(item.orValues) && item.orValues.length > 0)
    );
  });
  const hasRoleGroups = (metadata.roles || []).some((item: any) => {
    return Array.isArray(item.values) && item.values.length > 0;
  });
  return hasAuthMethods || hasPermissionGroups || hasRoleGroups;
});

const toSchemaTitle = (schema: any, fallback: string) => {
  return schema?.title || parseSchemaRefName(schema?.$ref) || fallback;
};

const buildSchemaMetadata = (schema: any) => {
  const refName = parseSchemaRefName(schema?.$ref);
  const refSchema = refName ? schemaMap.value[refName] : null;
  return {
    description: refSchema?.description || schema?.description || '',
    refName,
    title: refName || refSchema?.title || schema?.title || '',
  };
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

const resolveRequestBodyVariantValue = (item: any) => {
  return item?.variantKey || item?.title || '';
};

const isMatchedRequestBodyVariant = (item: any, selected: string) => {
  if (!selected || !item) {
    return false;
  }
  return item?.variantKey === selected || item?.title === selected;
};

const pickRequestBodySchema = () => {
  const content = apiInfo.value.requestBody?.content;
  if (!content) {
    return null;
  }

  const entries = Object.entries(content);
  const hit = entries.find(([, body]) =>
    hasRenderableSchema((body as any)?.schema),
  );
  if (hit) {
    const [contentType, body] = hit;
    return { body, contentType, schema: (body as any)?.schema };
  }

  const first = entries[0];
  if (!first) {
    return null;
  }
  const [contentType, body] = first;
  return { body, contentType, schema: (body as any)?.schema ?? null };
};

const requestBody = computed(() => {
  const picked = pickRequestBodySchema();
  const schema = picked?.schema;
  if (!schema) return null;

  if (schema.oneOf) {
    return schema.oneOf
      .map((item: any, index: number) => {
        const resolved = adaptSchemaForView(item, { mode: 'request' });
        if (!resolved || !hasRenderableSchema(resolved)) return null;

        return {
          ...resolved,
          title: toSchemaTitle(
            resolved,
            toSchemaTitle(item, `请求体方案 ${index + 1}`),
          ),
          variantKey: buildRequestBodyVariantKey(item, index),
        };
      })
      .filter(Boolean);
  }

  const resolved = adaptSchemaForView(schema, { mode: 'request' });
  if (!resolved || !hasRenderableSchema(resolved)) return null;

  return {
    ...resolved,
    title: toSchemaTitle(resolved, toSchemaTitle(schema, '请求体')),
  };
});

const requestBodyContentType = computed(() => {
  return pickRequestBodySchema()?.contentType || 'application/json';
});

watch(
  requestBody,
  (newVal) => {
    requestBodyVariantState.value = {};
    if (Array.isArray(newVal) && newVal.length > 0) {
      const hasCurrent = newVal.some((item) =>
        isMatchedRequestBodyVariant(item, requestBodyType.value),
      );
      if (!hasCurrent) {
        requestBodyType.value = resolveRequestBodyVariantValue(newVal[0]);
      }
      return;
    }

    requestBodyType.value = '';
  },
  { immediate: true },
);

watch(requestBodyType, () => {
  requestBodyVariantState.value = {};
});

const handleRequestSchemaVariantChange = (payload: {
  index: number;
  path: string;
}) => {
  requestBodyVariantState.value = {
    ...requestBodyVariantState.value,
    [payload.path]: payload.index,
  };
};
const currentRequestBody = computed(() => {
  if (!requestBody.value) return null;

  if (Array.isArray(requestBody.value)) {
    return (
      requestBody.value.find((item) =>
        isMatchedRequestBodyVariant(item, requestBodyType.value),
      ) ||
      requestBody.value[0] ||
      null
    );
  }

  return requestBody.value;
});

const applyRequestBodyVariantState = (
  schema: any,
  state: Record<string, number>,
) => {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  const pickVariantIndex = (path: string, options: any[]) => {
    const selected = state[path];
    if (!Array.isArray(options) || options.length <= 0) {
      return 0;
    }
    if (
      typeof selected !== 'number' ||
      !Number.isInteger(selected) ||
      selected < 0 ||
      selected >= options.length
    ) {
      return 0;
    }
    return selected;
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

  const visit = (node: any, path: string): any => {
    if (node === null || node === undefined) {
      return null;
    }
    if (typeof node !== 'object') {
      return node;
    }
    if (Array.isArray(node)) {
      return node.map((item, index) => visit(item, `${path}.${index}`));
    }

    let current: any = { ...node };

    if (Array.isArray(current.oneOf) && current.oneOf.length > 0) {
      const index = pickVariantIndex(path, current.oneOf);
      const base = { ...current };
      delete base.oneOf;
      delete base.anyOf;
      delete base.allOf;
      delete base['x-nextdoc4j-allOfMerged'];
      const picked = current.oneOf[index] ?? current.oneOf[0];
      current = mergeComposedSchema(base, picked);
    } else if (Array.isArray(current.anyOf) && current.anyOf.length > 0) {
      const index = pickVariantIndex(path, current.anyOf);
      const base = { ...current };
      delete base.oneOf;
      delete base.anyOf;
      delete base.allOf;
      delete base['x-nextdoc4j-allOfMerged'];
      const picked = current.anyOf[index] ?? current.anyOf[0];
      current = mergeComposedSchema(base, picked);
    } else if (Array.isArray(current.allOf) && current.allOf.length > 0) {
      let mergedAllOf: any = {};
      for (const item of current.allOf) {
        mergedAllOf = mergeComposedSchema(mergedAllOf, visit(item, path));
      }
      const base = { ...current };
      delete base.allOf;
      delete base['x-nextdoc4j-allOfMerged'];
      current = mergeComposedSchema(base, mergedAllOf);
    }

    if (current.properties && typeof current.properties === 'object') {
      const nextProperties: Record<string, any> = {};
      Object.entries(current.properties).forEach(([key, value]) => {
        nextProperties[key] = visit(value, `${path}.${key}`);
      });
      current.properties = nextProperties;
    }

    if (current.items) {
      current.items = visit(current.items, path);
    }

    if (Array.isArray(current.prefixItems)) {
      current.prefixItems = current.prefixItems.map(
        (item: any, index: number) => visit(item, `${path}.${index}`),
      );
    }

    return current;
  };

  return visit(schema, '$');
};

const requestSchemaForView = computed(() => {
  return (
    currentRequestBody.value ||
    (Array.isArray(requestBody.value) ? null : requestBody.value)
  );
});

const requestPreviewSchema = computed(() => {
  const source = requestSchemaForView.value;
  if (!source) {
    return null;
  }
  return applyRequestBodyVariantState(source, requestBodyVariantState.value);
});

const requestBodyExampleDescription = computed(() => {
  const picked = pickRequestBodySchema();
  const candidates = [
    apiInfo.value.requestBody?.description,
    currentRequestBody.value?.description,
    requestPreviewSchema.value?.description,
    (picked?.body as any)?.description,
    picked?.schema?.description,
  ];

  return candidates.map((item) => `${item || ''}`.trim()).find(Boolean) || '';
});

const requestBodyExampleTitle = computed(() => {
  return requestBodyExampleDescription.value || 'Request Body Example';
});

watch(
  routeUiStateKey,
  () => {
    loadCurrentDocument();
  },
  { immediate: true, flush: 'sync' },
);

watch(
  activeRequestSections,
  () => {
    persistDocumentUiState();
  },
  { deep: true },
);

watch(activeResponseCode, () => {
  persistDocumentUiState();
});

const pickContentSchema = (content?: Record<string, any>) => {
  if (!content) return null;

  return (
    content['application/json']?.schema ||
    content['*/*']?.schema ||
    Object.values(content).find((item) => Boolean((item as any)?.schema))
      ?.schema ||
    null
  );
};

const pickContentType = (content?: Record<string, any>) => {
  if (!content) return '';
  return Object.keys(content)[0] || '';
};

const decodeJsonPointerToken = (value: string) => {
  return value.replaceAll('~1', '/').replaceAll('~0', '~');
};

const normalizeExampleValue = (value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }

  return value;
};

const normalizeMatchText = (value?: unknown) => {
  return `${value ?? ''}`.trim().toLowerCase();
};

const splitDescriptionTokens = (value?: string) => {
  const normalized = `${value || ''}`.trim();
  if (!normalized) {
    return [];
  }

  return [
    normalized,
    ...normalized
      .split(/[|/、,，;；]+/u)
      .map((item) => item.trim())
      .filter(Boolean),
  ];
};

const getComponentExampleMap = () => {
  return ((apiStore.openApi as any)?.components?.examples ?? {}) as Record<
    string,
    any
  >;
};

const resolveExampleReference = (ref?: string) => {
  if (!ref) {
    return undefined;
  }

  const segments = ref
    .replace(/^#\/+/u, '')
    .split('/')
    .map((item) => decodeJsonPointerToken(item));
  const explicitKey = segments.length > 2 ? segments.slice(2).join('/') : '';
  const fallbackKey = segments.at(-1) || '';
  const componentExamples = getComponentExampleMap();

  return componentExamples[explicitKey] ?? componentExamples[fallbackKey];
};

const resolveExampleValue = (example: any): unknown => {
  if (example === undefined) {
    return undefined;
  }

  if (example === null) {
    return null;
  }

  if (typeof example !== 'object') {
    return normalizeExampleValue(example);
  }

  if (typeof example.$ref === 'string') {
    return resolveExampleValue(resolveExampleReference(example.$ref));
  }

  if (example.value !== undefined) {
    return normalizeExampleValue(example.value);
  }

  if (example.example !== undefined) {
    return normalizeExampleValue(example.example);
  }

  if (
    example.summary !== undefined ||
    example.description !== undefined ||
    example.externalValue !== undefined
  ) {
    return undefined;
  }

  return normalizeExampleValue(example);
};

const pickContentEntry = (content?: Record<string, any>) => {
  if (!content) {
    return {
      contentType: '',
      value: null,
    };
  }

  const preferredEntries = [
    ['application/json', content['application/json']],
    ['*/*', content['*/*']],
    ...Object.entries(content).filter(
      ([contentType]) =>
        contentType !== 'application/json' && contentType !== '*/*',
    ),
  ].filter(([, value]) => Boolean(value));

  if (preferredEntries.length <= 0) {
    return {
      contentType: '',
      value: null,
    };
  }

  const picked =
    preferredEntries.find(([, value]) => {
      return Boolean(
        (value as any)?.examples ||
          (value as any)?.example ||
          (value as any)?.schema,
      );
    }) || preferredEntries[0];

  return {
    contentType: picked?.[0] || '',
    value: (picked?.[1] as any) ?? null,
  };
};

const resolveExampleScore = (
  exampleKey: string,
  exampleSummary: string,
  exampleDescription: string,
  responseCode: string,
  responseDescription?: string,
) => {
  let score = 0;
  const normalizedCode = normalizeMatchText(responseCode);
  const normalizedKey = normalizeMatchText(exampleKey);
  const normalizedSummary = normalizeMatchText(exampleSummary);
  const normalizedDescription = normalizeMatchText(exampleDescription);

  if (normalizedCode) {
    if (normalizedKey === normalizedCode) {
      score += 100;
    }
    if (
      normalizedKey.startsWith(`${normalizedCode}_`) ||
      normalizedKey.startsWith(`${normalizedCode}.`) ||
      normalizedKey.startsWith(`${normalizedCode}-`)
    ) {
      score += 80;
    }
  }

  const responseDescriptionTokens = splitDescriptionTokens(
    responseDescription,
  ).map((item) => normalizeMatchText(item));

  responseDescriptionTokens.forEach((token) => {
    if (!token) {
      return;
    }

    [normalizedSummary, normalizedDescription].forEach((label) => {
      if (!label) {
        return;
      }

      if (label === token) {
        score += 60;
        return;
      }

      if (label.includes(token) || token.includes(label)) {
        score += 40;
      }
    });
  });

  return score;
};

const resolveResponseExampleFromExamples = (
  examples: Record<string, any>,
  responseCode: string,
  responseDescription?: string,
) => {
  const candidates = Object.entries(examples)
    .map(([key, example], index) => {
      const value = resolveExampleValue(example);
      if (value === undefined) {
        return null;
      }

      const summary = `${example?.summary || ''}`;
      const description = `${example?.description || ''}`;
      return {
        description,
        index,
        key,
        label: summary || description || key,
        score: resolveExampleScore(
          key,
          summary,
          description,
          responseCode,
          responseDescription,
        ),
        value,
      };
    })
    .filter(Boolean) as Array<{
    description: string;
    index: number;
    key: string;
    label: string;
    score: number;
    value: unknown;
  }>;

  if (candidates.length <= 0) {
    return {
      defaultKey: '',
      hasValue: false,
      options: [],
      value: undefined,
    };
  }

  const matched = [...candidates].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.index - b.index;
  })[0];

  return {
    defaultKey: matched?.key || '',
    hasValue: true,
    options: candidates.map((item) => ({
      description: item.description,
      key: item.key,
      label: item.label,
      value: item.value,
    })),
    value: matched?.value,
  };
};

const resolveResponseExampleData = (
  responseCode: string,
  responseDescription: string | undefined,
  contentValue: any,
) => {
  if (contentValue?.examples && typeof contentValue.examples === 'object') {
    const matched = resolveResponseExampleFromExamples(
      contentValue.examples,
      responseCode,
      responseDescription,
    );
    if (matched.hasValue) {
      return matched;
    }
  }

  if (contentValue?.example !== undefined) {
    return {
      defaultKey: '',
      hasValue: true,
      options: [],
      value: resolveExampleValue(contentValue.example),
    };
  }

  return {
    defaultKey: '',
    hasValue: false,
    options: [],
    value: undefined,
  };
};

const responsePanelSources = computed(() => {
  return responseCodes.value.map((code) => {
    const response = apiInfo.value?.responses?.[code];
    const { contentType, value: contentValue } = pickContentEntry(
      response?.content,
    );
    const schema =
      pickContentSchema(response?.content) ||
      contentValue?.schema ||
      response?.schema;
    const resolved =
      schema && hasRenderableSchema(schema)
        ? adaptSchemaForView(schema, { mode: 'response' })
        : null;
    const exampleData = resolveResponseExampleData(
      code,
      response?.description,
      contentValue,
    );

    return {
      code,
      contentType: contentType || pickContentType(response?.content),
      defaultExampleKey: exampleData.defaultKey,
      exampleOptions: exampleData.options as ResponseExampleOption[],
      exampleValue: exampleData.value,
      hasExampleValue: exampleData.hasValue,
      originalSchema: schema || null,
      response,
      schema: resolved && hasRenderableSchema(resolved) ? resolved : null,
    };
  });
});

watch(
  responsePanelSources,
  (panels) => {
    const nextSelection: Record<string, string> = {};

    panels.forEach((panel) => {
      if (panel.exampleOptions.length <= 0) {
        return;
      }

      const currentSelection = responseExampleSelection.value[panel.code];
      nextSelection[panel.code] = panel.exampleOptions.some(
        (item) => item.key === currentSelection,
      )
        ? (currentSelection ?? panel.defaultExampleKey)
        : panel.defaultExampleKey;
    });

    responseExampleSelection.value = nextSelection;
  },
  { immediate: true },
);

const responsePanels = computed(() => {
  return responsePanelSources.value.map((panel) => {
    if (panel.exampleOptions.length <= 0) {
      return panel;
    }

    const selectedKey =
      responseExampleSelection.value[panel.code] || panel.defaultExampleKey;
    const selectedOption =
      panel.exampleOptions.find((item) => item.key === selectedKey) ||
      panel.exampleOptions[0];

    return {
      ...panel,
      exampleValue: selectedOption?.value,
      hasExampleValue: Boolean(selectedOption),
      selectedExampleKey: selectedOption?.key || '',
    };
  });
});

// 当前选中 tab 对应的响应示例面板；选中态失效时回退到首个面板
const activeExamplePanel = computed(() => {
  const panels = responsePanels.value;
  return (
    panels.find((panel) => panel.code === activeExampleCode.value) ||
    panels[0] ||
    null
  );
});

// 响应示例面板变化时，保证选中的 tab 始终指向存在的状态码
watch(
  responsePanels,
  (panels) => {
    if (!panels.some((panel) => panel.code === activeExampleCode.value)) {
      activeExampleCode.value = panels[0]?.code || '';
    }
  },
  { immediate: true },
);

const showExampleAside = computed(() => {
  return Boolean(requestPreviewSchema.value || responsePanels.value.length > 0);
});

/**
 * 更新右侧示例区是否需要退出 sticky 布局。
 *
 * 参数：无。
 * 返回值：无，仅根据当前内容高度更新展示状态。
 */
const updateAsideFlowState = () => {
  const el = asideStackRef.value;
  if (!el) {
    asideShouldFlow.value = false;
    return;
  }

  asideShouldFlow.value = el.scrollHeight > window.innerHeight - 48;
};

/**
 * 在 DOM 更新后重新计算右侧示例区高度。
 *
 * 参数：无。
 * 返回值：无，仅延迟触发右侧示例区布局状态计算。
 */
const scheduleAsideFlowUpdate = () => {
  void nextTick(() => {
    updateAsideFlowState();
  });
};

watch([requestPreviewSchema, responsePanels], scheduleAsideFlowUpdate, {
  deep: true,
  flush: 'post',
});

const hasAnyParameters = computed(() => {
  return (
    parametersInPath.value.length > 0 ||
    parametersInQuery.value.length > 0 ||
    Boolean(requestBody.value)
  );
});

const requestCodeActionSection = computed(() => {
  if (requestBody.value) {
    return 'body';
  }
  if (parametersInPath.value.length > 0) {
    return 'path';
  }
  if (parametersInQuery.value.length > 0) {
    return 'query';
  }
  return '';
});

const requestTypeCode = computed(() => {
  if (!hasAnyParameters.value || !apiInfo.value) {
    return '';
  }

  return renderTypeDefinitions({
    info: apiInfo.value,
    requestBodyType: requestBodyType.value,
    requestBodyVariantState: requestBodyVariantState.value,
    schemaMap: schemaMap.value,
    scope: 'request',
  });
});

const responseTypeCode = computed(() => {
  if (!apiInfo.value) {
    return '';
  }

  const responseOverrides: Array<{
    adaptedSchema: any;
    code: string;
    metadata: {
      description?: string;
      refName?: string;
      title?: string;
    };
    schema: any;
  }> = [];

  for (const panel of responsePanels.value) {
    const previewSchema = getResponsePreviewSchema(panel.code, panel.schema);
    const sourceSchema = panel.originalSchema || panel.schema;

    if (!sourceSchema || !previewSchema) {
      continue;
    }

    responseOverrides.push({
      adaptedSchema: previewSchema,
      code: panel.code,
      metadata: buildSchemaMetadata(sourceSchema),
      schema: sourceSchema,
    });
  }

  if (responseOverrides.length <= 0) {
    return '';
  }

  return renderTypeDefinitions({
    info: apiInfo.value,
    requestBodyType: requestBodyType.value,
    requestBodyVariantState: requestBodyVariantState.value,
    responseOverrides,
    schemaMap: schemaMap.value,
    scope: 'response',
  });
});

const codeDialogTitle = computed(() => {
  return codeDialogScope.value === 'request'
    ? '请求参数 TS 实体'
    : '响应参数 TS 实体';
});

const activeTypeCode = computed(() => {
  return codeDialogScope.value === 'request'
    ? requestTypeCode.value
    : responseTypeCode.value;
});

const codeDialogBodyStyle = computed(() => {
  const lineCount = Math.max(1, activeTypeCode.value.split('\n').length);
  const estimatedHeight = 48 + lineCount * 20;
  const clampedHeight = Math.min(Math.max(estimatedHeight, 132), 560);

  return {
    height: `min(${clampedHeight}px, calc(100vh - 128px))`,
    maxHeight: 'calc(100vh - 128px)',
  };
});

async function handleCopyBaseUrl() {
  if (!baseUrl.value) return;
  const copied = await copyText(baseUrl.value);
  if (copied) {
    ElMessage.success('Base URL 已复制');
    return;
  }
  ElMessage.error('Base URL 复制失败');
}

async function handleCopyPath() {
  if (!apiInfo.value.path) return;
  const copied = await copyText(apiInfo.value.path);
  if (copied) {
    ElMessage.success('Path 已复制');
    return;
  }
  ElMessage.error('Path 复制失败');
}

// 接口详情滚动容器与「回到顶部」按钮状态
const scrollContainerRef = ref<HTMLElement | null>(null);
const showBackTop = ref(false);

const handleDetailScroll = () => {
  const el = scrollContainerRef.value;
  showBackTop.value = Boolean(el) && (el as HTMLElement).scrollTop > 240;
};

const handleBackTop = () => {
  scrollContainerRef.value?.scrollTo({ top: 0, behavior: 'smooth' });
};

onMounted(() => {
  scrollContainerRef.value?.addEventListener('scroll', handleDetailScroll, {
    passive: true,
  });
  asideResizeObserver = new ResizeObserver(scheduleAsideFlowUpdate);
  if (asideStackRef.value) {
    asideResizeObserver.observe(asideStackRef.value);
  }
  window.addEventListener('resize', scheduleAsideFlowUpdate, { passive: true });
  scheduleAsideFlowUpdate();
});

onBeforeUnmount(() => {
  scrollContainerRef.value?.removeEventListener('scroll', handleDetailScroll);
  asideResizeObserver?.disconnect();
  asideResizeObserver = null;
  window.removeEventListener('resize', scheduleAsideFlowUpdate);
});

/**
 * 收集当前接口在原始 OpenAPI 文档中的定义片段（路径对象 + 直接引用的实体），
 * 供 AI 编程工具获取无损的接口契约信息。引用解析仅展开一层，避免循环引用与体积膨胀。
 */
function buildRawOpenApiJson() {
  const openApi = apiStore.openApi;
  const path = apiInfo.value?.path;
  const method = apiInfo.value?.method?.toLowerCase?.();
  if (!openApi || !path || !method) {
    return '';
  }

  const pathItem = openApi.paths?.[path];
  const operation = (pathItem as any)?.[method];
  if (!operation) {
    return '';
  }

  // 收集片段中出现的 schema 引用名，附带对应的实体定义
  const refNames = new Set<string>();
  const collectRefs = (node: unknown) => {
    if (!node || typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item) => collectRefs(item));
      return;
    }
    Object.entries(node as Record<string, unknown>).forEach(([key, value]) => {
      if (key === '$ref' && typeof value === 'string') {
        const name = parseSchemaRefName(value);
        if (name) {
          refNames.add(name);
        }
        return;
      }
      collectRefs(value);
    });
  };
  collectRefs(operation);

  const schemas: Record<string, unknown> = {};
  refNames.forEach((name) => {
    const schema = schemaMap.value[name];
    if (schema) {
      schemas[name] = schema;
      // 展开一层嵌套引用，保证常见的关联实体也能带上
      collectRefs(schema);
    }
  });
  refNames.forEach((name) => {
    if (!schemas[name] && schemaMap.value[name]) {
      schemas[name] = schemaMap.value[name];
    }
  });

  const fragment: Record<string, unknown> = {
    path,
    method: method.toUpperCase(),
    operation,
  };
  if (Object.keys(schemas).length > 0) {
    fragment.components = { schemas };
  }

  try {
    return JSON.stringify(fragment, null, 2);
  } catch {
    return '';
  }
}

/**
 * 复制接口文档信息（定义、参数、TS 实体、响应）给 Cursor 等 AI 编程工具生成代码
 */
async function handleCopyForAi() {
  const toParamLite = (item: any) => ({
    name: item?.name,
    type: item?.schema?.type,
    required: item?.required,
    description: item?.description,
  });

  const prompt = buildApiDocPrompt({
    summary: summaryText.value,
    method: apiInfo.value.method,
    url: `${baseUrl.value || ''}${apiInfo.value.path || ''}`,
    description: apiInfo.value.description,
    tags: displayTags.value,
    authMethods: authMethods.value.map((item) => ({
      detail: item.detail,
      label: item.label,
    })),
    pathParams: parametersInPath.value.map((item) => toParamLite(item)),
    queryParams: parametersInQuery.value.map((item) => toParamLite(item)),
    requestTs: requestTypeCode.value,
    responseTs: responseTypeCode.value,
    responses: responseCodes.value.map((code) => ({
      code,
      description: apiInfo.value?.responses?.[code]?.description,
    })),
    openApiJson: buildRawOpenApiJson(),
  });

  const copied = await copyText(prompt);
  if (copied) {
    ElMessage.success('已复制接口信息，可粘贴给 AI 生成代码');
    return;
  }
  ElMessage.error('复制失败');
}

const openTypeCodeDialog = (scope: CodeDialogScope) => {
  const nextCode =
    scope === 'request' ? requestTypeCode.value : responseTypeCode.value;
  if (!nextCode) {
    ElMessage.warning('当前暂无可生成的 TS 实体');
    return;
  }

  codeDialogScope.value = scope;
  codeDialogVisible.value = true;
};

async function handleCopyGeneratedCode() {
  const copied = await copyText(activeTypeCode.value || '');
  if (copied) {
    ElMessage.success('TS 代码已复制');
    return;
  }
  ElMessage.error('TS 代码复制失败');
}

const handleTest = () => {
  if (props.showTest) {
    return;
  }
  if (apiInfo.value) {
    emits('test', getDebugPayload());
  }
};

const handleResponseExampleSelect = (code: string, value: string) => {
  responseExampleSelection.value = {
    ...responseExampleSelection.value,
    [code]: value,
  };
};

const handleResponseSchemaVariantChange = (
  code: string,
  payload: { index: number; path: string },
) => {
  responseVariantState.value = {
    ...responseVariantState.value,
    [code]: {
      ...responseVariantState.value[code],
      [payload.path]: payload.index,
    },
  };
};

const getResponsePreviewSchema = (code: string, schema: any) => {
  if (!schema) {
    return null;
  }
  return applyRequestBodyVariantState(
    schema,
    responseVariantState.value[code] || {},
  );
};

const getDebugPayload = (): DebugPayload => {
  return {
    info: apiInfo.value,
    requestBodyType: requestBodyType.value,
    requestBodyVariantState: { ...requestBodyVariantState.value },
  };
};

defineExpose({
  apiInfo,
  getDebugPayload,
  requestBodyType,
});
</script>

<template>
  <div
    ref="scrollContainerRef"
    class="document-detail"
    :class="{ 'document-detail--dark': isDark }"
  >
    <div
      class="document-detail__layout"
      :class="{ 'document-detail__layout--single': !showExampleAside }"
    >
      <main class="document-detail__main">
        <header class="hero-panel">
          <div class="hero-panel__top">
            <div class="hero-panel__text">
              <div class="hero-panel__tags">
                <ElTag
                  v-for="tag in displayTags"
                  :key="tag"
                  effect="plain"
                  round
                  class="hero-tag"
                >
                  {{ tag }}
                </ElTag>
              </div>
              <h1 class="hero-panel__title">
                {{ summaryText }}
              </h1>
              <div
                class="hero-panel__description"
                v-html="descriptionText"
              ></div>
            </div>

            <div class="hero-panel__actions">
              <ElTooltip
                content="复制接口文档信息给 claude code 等 AI 编程工具，让 AI 根据接口定义生成高质量的代码"
                placement="top"
                :enterable="false"
              >
                <ElButton
                  class="hero-panel__ai-button"
                  aria-label="复制接口文档信息给 AI 编程工具"
                  @click="handleCopyForAi"
                >
                  <SvgAiCopyIcon class="hero-panel__ai-icon" />
                </ElButton>
              </ElTooltip>
              <ElButton
                class="hero-panel__debug-button"
                :style="methodStyle"
                @click="handleTest"
                :disabled="showTest"
              >
                {{ showTest ? '调试中' : '在线调试' }}
                <ApiTestRunning
                  v-if="showTest"
                  class="ml-1 size-4 animate-spin"
                />
                <ApiTestRun v-else class="ml-1 size-4" />
              </ElButton>
            </div>
          </div>

          <div class="hero-panel__endpoint">
            <span class="endpoint-method" :style="methodStyle">
              {{ apiInfo.method?.toUpperCase() }}
            </span>

            <ElTooltip
              v-if="baseUrl"
              :content="baseUrl"
              placement="top"
              :enterable="false"
              :hide-after="0"
            >
              <button class="endpoint-prefix" @click="handleCopyBaseUrl">
                <SvgApiPrefixIcon class="endpoint-prefix__icon" />
              </button>
            </ElTooltip>

            <button class="endpoint-path" @click="handleCopyPath">
              <PathSegment
                :path="apiInfo.path"
                :param-style="{
                  ...methodStyle,
                  borderColor: methodStyle.color,
                }"
              />
            </button>
          </div>

          <div v-if="showSecurityPanel" class="hero-panel__security">
            <SecurityView
              :auth-methods="authMethods"
              :metadata="securityMetadata"
            />
          </div>
        </header>

        <section
          v-if="parametersInPath.length > 0"
          class="api-section api-section--path"
        >
          <div class="api-section__header">
            <div class="api-section__heading">
              <h2 class="api-section__title">路径参数</h2>
              <span class="api-section__badge">Path</span>
            </div>
            <button
              v-if="requestTypeCode && requestCodeActionSection === 'path'"
              type="button"
              class="section-panel__code-button"
              @click="openTypeCodeDialog('request')"
            >
              TS 代码
            </button>
          </div>

          <div class="api-card">
            <ParameterView
              v-for="item in parametersInPath"
              :key="item.name"
              :parameter="item"
            />
          </div>
        </section>

        <section
          v-if="parametersInQuery.length > 0"
          class="api-section api-section--query"
        >
          <div class="api-section__header">
            <div class="api-section__heading">
              <h2 class="api-section__title">查询参数</h2>
              <span class="api-section__badge">Query</span>
            </div>
            <button
              v-if="requestTypeCode && requestCodeActionSection === 'query'"
              type="button"
              class="section-panel__code-button"
              @click="openTypeCodeDialog('request')"
            >
              TS 代码
            </button>
          </div>

          <div class="api-card">
            <ParameterView
              v-for="item in parametersInQuery"
              :key="item.name"
              :parameter="item"
            />
          </div>
        </section>

        <section v-if="requestBody" class="api-section api-section--body">
          <div class="api-section__header">
            <div class="api-section__heading">
              <h2 class="api-section__title">请求体</h2>
              <span class="api-section__badge">Body</span>
            </div>
            <div class="api-section__meta">
              <span class="api-section__content-type">
                {{ requestBodyContentType }}
              </span>
              <button
                v-if="requestTypeCode && requestCodeActionSection === 'body'"
                type="button"
                class="section-panel__code-button"
                @click="openTypeCodeDialog('request')"
              >
                TS 代码
              </button>
            </div>
          </div>

          <div class="api-card">
            <div v-if="Array.isArray(requestBody)" class="body-type-switch">
              <ElButton
                v-for="item in requestBody"
                :key="item.variantKey || item.title"
                size="small"
                class="body-type-switch__button"
                :class="{
                  'body-type-switch__button--active':
                    isMatchedRequestBodyVariant(item, requestBodyType),
                }"
                @click="requestBodyType = resolveRequestBodyVariantValue(item)"
              >
                {{ item.title }}
              </ElButton>
            </div>

            <div class="schema-layout schema-layout--body">
              <SchemaView
                v-if="requestSchemaForView"
                :key="requestBodyType || '__request_schema__'"
                :data="requestSchemaForView"
                mode="request"
                @variant-change="handleRequestSchemaVariantChange"
              />
            </div>
          </div>
        </section>

        <section class="api-section api-section--response">
          <div class="api-section__header">
            <div class="api-section__heading">
              <h2 class="api-section__title">响应参数</h2>
              <span class="api-section__badge">Response</span>
            </div>
            <button
              v-if="responseTypeCode"
              type="button"
              class="section-panel__code-button"
              @click="openTypeCodeDialog('response')"
            >
              TS 代码
            </button>
          </div>

          <div v-if="responsePanels.length > 0" class="response-stack">
            <div
              v-for="panel in responsePanels"
              :key="panel.code"
              class="response-card"
              :class="{
                'response-card--open': activeResponseCode === panel.code,
              }"
            >
              <button
                type="button"
                class="response-card__summary"
                :aria-expanded="activeResponseCode === panel.code"
                @click="
                  activeResponseCode =
                    activeResponseCode === panel.code ? '' : panel.code
                "
              >
                <div class="response-collapse__status">
                  <span
                    class="response-code"
                    :class="{
                      'response-code--error':
                        `${panel.code}`.startsWith('4') ||
                        `${panel.code}`.startsWith('5'),
                      'response-code--success': `${panel.code}`.startsWith('2'),
                    }"
                  >
                    {{ panel.code }}
                  </span>
                  <span class="response-desc">
                    {{ panel.response?.description || '响应结果' }}
                  </span>
                </div>
                <span v-if="panel.contentType" class="response-content-type">
                  {{ panel.contentType }}
                </span>
              </button>

              <Transition name="response-expand">
                <div
                  v-show="activeResponseCode === panel.code"
                  class="response-content"
                >
                  <div class="schema-layout schema-layout--response">
                    <SchemaView
                      v-if="panel.schema"
                      :data="panel.schema"
                      mode="response"
                      @variant-change="
                        handleResponseSchemaVariantChange(panel.code, $event)
                      "
                    />
                    <div v-else class="empty-hint">暂无可展示的响应结构</div>
                  </div>
                </div>
              </Transition>
            </div>
          </div>
          <div v-else class="empty-hint">暂无可展示的响应结构</div>
        </section>
      </main>

      <aside v-if="showExampleAside" class="document-detail__aside">
        <div
          ref="asideStackRef"
          class="document-detail__aside-stack"
          :class="{
            'document-detail__aside-stack--flow': asideShouldFlow,
          }"
        >
          <section
            v-if="requestPreviewSchema"
            class="example-card example-card--request"
          >
            <div class="example-card__header">
              <div class="example-card__meta">
                <div class="example-card__title">
                  {{ requestBodyExampleTitle }}
                </div>
                <span
                  v-if="!requestBodyExampleDescription"
                  class="example-card__content-type"
                >
                  {{ requestBodyContentType }}
                </span>
              </div>
            </div>

            <div class="example-card__body">
              <JsonViewer
                class="json-panel app-json-schema-viewer"
                :schema="requestPreviewSchema"
                mode="request"
                :enable-chunked-render="true"
                :initial-render-count="60"
                :render-chunk-size="60"
              />
            </div>
          </section>

          <section
            v-if="activeExamplePanel"
            class="example-card example-card--response"
          >
            <div class="example-card__tabs" role="tablist">
              <button
                v-for="panel in responsePanels"
                :key="`tab-${panel.code}`"
                type="button"
                role="tab"
                class="example-card__tab"
                :class="{
                  'example-card__tab--active': activeExampleCode === panel.code,
                  'example-card__tab--error':
                    `${panel.code}`.startsWith('4') ||
                    `${panel.code}`.startsWith('5'),
                  'example-card__tab--success': `${panel.code}`.startsWith('2'),
                }"
                :aria-selected="activeExampleCode === panel.code"
                @click="activeExampleCode = panel.code"
              >
                {{ panel.code }}
              </button>
            </div>

            <div class="example-card__body">
              <ElSelect
                v-if="activeExamplePanel.exampleOptions.length > 1"
                :model-value="responseExampleSelection[activeExamplePanel.code]"
                size="small"
                class="response-example-select"
                popper-class="response-example-select__popper"
                placeholder="选择示例"
                @update:model-value="
                  handleResponseExampleSelect(activeExamplePanel.code, $event)
                "
              >
                <ElOption
                  v-for="item in activeExamplePanel.exampleOptions"
                  :key="item.key"
                  :label="item.label"
                  :value="item.key"
                />
              </ElSelect>

              <JsonViewer
                v-if="
                  activeExamplePanel.schema ||
                  activeExamplePanel.hasExampleValue
                "
                :key="`example-json-${activeExamplePanel.code}`"
                class="json-panel app-json-schema-viewer"
                :schema="
                  getResponsePreviewSchema(
                    activeExamplePanel.code,
                    activeExamplePanel.schema,
                  )
                "
                :value="
                  activeExamplePanel.hasExampleValue
                    ? activeExamplePanel.exampleValue
                    : undefined
                "
                mode="response"
                :enable-chunked-render="true"
                :initial-render-count="60"
                :render-chunk-size="60"
              />
              <div v-else class="example-card__empty">暂无可展示的响应示例</div>
            </div>
          </section>
        </div>
      </aside>
    </div>

    <!-- 右下角「回到顶部」按钮：随详情滚动容器悬浮 -->
    <div class="document-detail__backtop">
      <transition name="fade">
        <button
          v-show="showBackTop"
          type="button"
          class="document-backtop-button"
          aria-label="回到顶部"
          @click="handleBackTop"
        >
          <SvgDoubleArrowUpIcon class="document-backtop-button__icon" />
        </button>
      </transition>
    </div>

    <ElDialog
      v-model="codeDialogVisible"
      align-center
      append-to-body
      destroy-on-close
      class="type-code-dialog"
      modal-class="type-code-dialog-overlay"
      width="min(860px, calc(100vw - 32px))"
    >
      <template #header>
        <div class="type-code-dialog__header">
          <div class="type-code-dialog__title">{{ codeDialogTitle }}</div>
        </div>
      </template>

      <div class="type-code-dialog__body" :style="codeDialogBodyStyle">
        <MarkdownCodeBlock
          class="type-code-dialog__viewer"
          :code="activeTypeCode"
          :dark="isDark"
          language="typescript"
        >
          <template #toolbar>
            <ElTooltip content="复制代码" placement="top">
              <ElButton
                text
                class="type-code-dialog__copy-button"
                @click="handleCopyGeneratedCode"
              >
                <SvgCopyIcon class="size-4" />
              </ElButton>
            </ElTooltip>
          </template>
        </MarkdownCodeBlock>
      </div>
    </ElDialog>
  </div>
</template>

<style scoped lang="scss">
.document-detail {
  --doc-chip-radius: var(--radius);
  --doc-radius-xs: calc(var(--radius) * 0.56);
  --doc-radius-sm: calc(var(--radius) * 0.72);
  --doc-radius-md: calc(var(--radius) * 0.94);
  --doc-radius-lg: calc(var(--radius) * 1.18);
  --doc-page-bg: #f8fafc;
  --doc-panel-bg: #fff;
  --doc-panel-border: #e2e8f0;
  --doc-row-border: #f1f5f9;
  --doc-muted-bg: #f1f5f9;
  --doc-text-muted: #64748b;
  --doc-example-bg: #fff;
  --doc-example-header-bg: #f8fafc;
  --doc-example-border: #e2e8f0;
  --doc-example-title: #475569;
  --doc-example-chip-bg: #f1f5f9;
  --el-border-radius-base: calc(var(--radius) * 0.75);
  --el-border-radius-small: calc(var(--radius) * 0.62);

  height: 100%;
  overflow-y: auto;
  scrollbar-width: none;
  background: var(--doc-page-bg);

  &::-webkit-scrollbar {
    display: none;
  }
}

.document-detail--dark {
  --doc-page-bg: var(--el-bg-color);
  --doc-panel-bg: color-mix(in srgb, var(--el-bg-color) 92%, #fff 8%);
  --doc-panel-border: color-mix(
    in srgb,
    var(--el-text-color-primary) 22%,
    transparent
  );
  --doc-row-border: color-mix(
    in srgb,
    var(--el-text-color-primary) 14%,
    transparent
  );
  --doc-muted-bg: color-mix(
    in srgb,
    var(--el-bg-color) 86%,
    var(--el-fill-color-light) 14%
  );
  --doc-text-muted: var(--el-text-color-secondary);
  --doc-example-bg: #0d1117;
  --doc-example-header-bg: #161b22;
  --doc-example-border: #30363d;
  --doc-example-title: #94a3b8;
  --doc-example-chip-bg: #1f2937;
}

.document-detail__layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 420px);
  gap: 40px;
  max-width: 1280px;
  min-height: 100%;
  padding: 40px 24px 48px;
  margin: 0 auto;
}

.document-detail__layout--single {
  grid-template-columns: minmax(0, 1fr);
}

.document-detail__main,
.document-detail__aside-stack {
  display: flex;
  flex-direction: column;
  gap: 32px;
  min-width: 0;
}

.document-detail__aside {
  min-width: 0;
}

.document-detail__aside-stack {
  position: sticky;
  top: 40px;
  align-self: start;
  overflow: visible;
}

.document-detail__aside-stack--flow {
  position: static;
  overflow: visible;
}

.hero-panel {
  display: grid;
  gap: 24px;
}

.hero-panel__top,
.hero-panel__endpoint,
.api-section__header,
.api-section__heading,
.api-section__meta,
.response-card__summary,
.response-collapse__status,
.example-card__header,
.example-card__meta,
.example-card__status-line {
  display: flex;
  align-items: center;
  min-width: 0;
}

.hero-panel__top,
.api-section__header,
.response-card__summary,
.example-card__header {
  justify-content: space-between;
}

.hero-panel__top {
  gap: 20px;
  align-items: flex-start;
}

.hero-panel__text {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.hero-panel__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.hero-tag {
  max-width: 100%;
  color: var(--doc-text-muted);
  background: var(--doc-panel-bg);
  border-color: var(--doc-panel-border);
}

.hero-panel__actions {
  display: inline-flex;
  flex: none;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: flex-end;
}

.hero-panel__ai-button {
  --el-button-bg-color: transparent;
  --el-button-border-color: transparent;
  --el-button-hover-border-color: transparent;
  --el-button-active-border-color: transparent;

  width: 36px;
  height: 36px;
  padding: 0;
  color: var(--doc-text-muted);
  background: transparent;
  border: none;
}

.hero-panel__ai-button:hover,
.hero-panel__ai-button:focus-visible {
  color: var(--el-color-primary);
  background: var(--doc-muted-bg);
}

.hero-panel__ai-icon {
  width: 18px;
  height: 18px;
}

.hero-panel__debug-button {
  flex: none;
  min-width: 112px;
  height: 40px;
  padding: 0 18px;
  font-weight: 700;
  border: none;
  box-shadow: 0 8px 18px
    color-mix(in srgb, var(--el-color-primary) 16%, transparent);
}

.hero-panel__title {
  margin: 0;
  font-size: 30px;
  font-weight: 800;
  line-height: 1.2;
  color: var(--el-text-color-primary);
  letter-spacing: 0;
}

.hero-panel__description {
  max-width: 760px;
  font-size: 15px;
  line-height: 1.7;
  color: var(--doc-text-muted);
}

.hero-panel__description :deep(p) {
  margin: 0;
}

.hero-panel__endpoint {
  gap: 10px;
  min-height: 56px;
  padding: 10px;
  background: var(--doc-panel-bg);
  border: 1px solid var(--doc-panel-border);
  border-radius: var(--doc-radius-lg);
  box-shadow: 0 8px 18px rgb(15 23 42 / 5%);
}

.endpoint-method {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 70px;
  height: 34px;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0;
  border-radius: var(--doc-chip-radius);
}

.endpoint-prefix,
.endpoint-path {
  display: inline-flex;
  align-items: center;
  background: transparent;
  border: none;
}

.endpoint-prefix {
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  color: var(--doc-text-muted);
  cursor: pointer;
  border-radius: var(--doc-chip-radius);
  transition:
    color 0.16s ease,
    background-color 0.16s ease;
}

.endpoint-prefix__icon {
  width: 14px;
  height: 14px;
}

.endpoint-path {
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  overflow-x: auto;
  font-family: 'JetBrains Mono', 'Fira Code', SFMono-Regular, monospace;
  font-size: 15px;
  color: var(--el-text-color-primary);
  cursor: pointer;
  scrollbar-width: none;
  border-radius: var(--doc-chip-radius);
  transition:
    color 0.16s ease,
    background-color 0.16s ease;
}

.endpoint-path::-webkit-scrollbar {
  display: none;
}

.endpoint-prefix:hover,
.endpoint-path:hover {
  color: var(--el-color-primary);
  background: color-mix(
    in srgb,
    var(--el-color-primary-light-9) 72%,
    transparent
  );
}

.hero-panel__security {
  padding: 12px;
  background: var(--doc-muted-bg);
  border: 1px solid var(--doc-panel-border);
  border-radius: var(--doc-radius-sm);
}

.api-section {
  display: grid;
  gap: 14px;
  min-width: 0;
}

.api-section__header {
  gap: 16px;
}

.api-section__heading {
  flex-wrap: wrap;
  gap: 12px;
}

.api-section__title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  line-height: 1.3;
  color: var(--el-text-color-primary);
}

.api-section__badge {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 1px 10px;
  font-size: 11px;
  font-weight: 800;
  color: var(--doc-text-muted);
  text-transform: uppercase;
  background: var(--doc-muted-bg);
  border: 1px solid var(--doc-panel-border);
  border-radius: var(--doc-chip-radius);
}

.api-section__meta {
  flex: none;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: flex-end;
}

.api-section__content-type,
.response-content-type,
.example-card__content-type {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: 'JetBrains Mono', 'Fira Code', SFMono-Regular, monospace;
  font-size: 12px;
  font-weight: 600;
  color: var(--doc-text-muted);
  white-space: nowrap;
}

.section-panel__code-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 66px;
  height: 30px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--doc-text-muted);
  cursor: pointer;
  background: var(--doc-panel-bg);
  border: 1px solid var(--doc-panel-border);
  border-radius: var(--doc-chip-radius);
  transition:
    color 0.16s ease,
    border-color 0.16s ease,
    background-color 0.16s ease;
}

.section-panel__code-button:hover {
  color: var(--el-color-primary);
  background: color-mix(
    in srgb,
    var(--el-color-primary-light-9) 76%,
    var(--doc-panel-bg) 24%
  );
  border-color: color-mix(
    in srgb,
    var(--el-color-primary-light-7) 82%,
    transparent
  );
}

.api-card,
.response-card {
  min-width: 0;
  overflow: hidden;
  background: var(--doc-panel-bg);
  border: 1px solid var(--doc-panel-border);
  border-radius: var(--doc-radius-lg);
  box-shadow: 0 8px 18px rgb(15 23 42 / 4%);
}

.body-type-switch {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 16px;
  background: var(--doc-muted-bg);
  border-bottom: 1px solid var(--doc-row-border);
}

.body-type-switch__button {
  min-height: 28px;
  padding: 0 10px;
  font-size: 12px;
  color: var(--doc-text-muted);
  background: var(--doc-panel-bg);
  border: 1px solid var(--doc-panel-border);
  border-radius: var(--doc-chip-radius);
}

.body-type-switch__button:hover {
  color: var(--el-text-color-primary);
  border-color: color-mix(in srgb, var(--el-color-primary) 32%, transparent);
}

.body-type-switch__button--active {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary-light-7);
}

.schema-layout {
  min-width: 0;
  padding: 6px 16px 8px;
}

.schema-layout--body,
.schema-layout--response {
  background: var(--doc-panel-bg);
}

.response-stack {
  display: grid;
  gap: 12px;
}

.response-card__summary {
  gap: 12px;
  width: 100%;
  padding: 14px 16px;
  color: inherit;
  cursor: pointer;
  list-style: none;
  background: transparent;
  border: none;
}

.response-card__summary::-webkit-details-marker {
  display: none;
}

.response-card__summary::after {
  flex: none;
  width: 8px;
  height: 8px;
  content: '';
  border-right: 1.5px solid var(--doc-text-muted);
  border-bottom: 1.5px solid var(--doc-text-muted);
  transform: rotate(45deg);
  transition: transform 0.16s ease;
}

.response-card--open > .response-card__summary::after {
  transform: rotate(225deg);
}

.response-collapse__status {
  flex: 1 1 auto;
  gap: 8px;
}

.response-code {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 48px;
  height: 24px;
  padding: 0 8px;
  font-family: 'JetBrains Mono', 'Fira Code', SFMono-Regular, monospace;
  font-size: 12px;
  font-weight: 800;
  line-height: 1;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border: 1px solid var(--el-color-primary-light-7);
  border-radius: var(--doc-chip-radius);
}

.response-code--success {
  color: #059669;
  background: #ecfdf5;
  border-color: #a7f3d0;
}

.response-code--error {
  color: #e11d48;
  background: #fff1f2;
  border-color: #fecdd3;
}

.document-detail--dark .response-code--success {
  color: #34d399;
  background: rgb(16 185 129 / 12%);
  border-color: rgb(16 185 129 / 32%);
}

.document-detail--dark .response-code--error {
  color: #fb7185;
  background: rgb(244 63 94 / 12%);
  border-color: rgb(244 63 94 / 32%);
}

.response-desc {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
  font-weight: 700;
  color: var(--el-text-color-primary);
  white-space: nowrap;
}

.response-content-type {
  flex: none;
  max-width: 42%;
  padding: 2px 7px;
  color: var(--doc-example-title);
  background: var(--doc-example-chip-bg);
  border: 1px solid var(--doc-example-border);
  border-radius: var(--doc-chip-radius);
}

.response-content {
  width: 100%;
  border-top: 1px solid var(--doc-row-border);
}

.response-expand-enter-active,
.response-expand-leave-active {
  overflow: hidden;
  transition:
    max-height 0.2s ease,
    opacity 0.16s ease;
}

.response-expand-enter-from,
.response-expand-leave-to {
  max-height: 0;
  opacity: 0;
}

.response-expand-enter-to,
.response-expand-leave-from {
  max-height: 2400px;
  opacity: 1;
}

.empty-hint {
  display: flex;
  align-items: center;
  min-height: 44px;
  padding: 0 12px;
  font-size: 13px;
  color: var(--doc-text-muted);
  background: var(--doc-muted-bg);
  border-radius: var(--doc-radius-xs);
}

.example-card {
  min-width: 0;
  overflow: hidden;
  background: var(--doc-example-bg);
  border: 1px solid var(--doc-example-border);
  border-radius: var(--doc-radius-lg);
  box-shadow: 0 12px 26px rgb(15 23 42 / 7%);
}

.example-card__header {
  gap: 12px;
  min-height: 44px;
  padding: 10px 12px;
  background: var(--doc-example-header-bg);
  border-bottom: 1px solid var(--doc-example-border);
}

/* 响应示例状态码 tab 切换栏 */
.example-card__tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 12px;
  background: var(--doc-example-header-bg);
  border-bottom: 1px solid var(--doc-example-border);
}

.example-card__tab {
  padding: 3px 10px;
  font-family: 'JetBrains Mono', 'Fira Code', SFMono-Regular, monospace;
  font-size: 12px;
  font-weight: 700;
  color: var(--doc-text-muted);
  cursor: pointer;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--doc-chip-radius);
  transition:
    color 0.15s ease,
    background 0.15s ease,
    border-color 0.15s ease;
}

.example-card__tab:hover {
  background: var(--doc-example-chip-bg);
}

.example-card__tab--active {
  background: var(--doc-example-chip-bg);
  border-color: var(--doc-example-border);
}

.example-card__tab--active.example-card__tab--success {
  color: #059669;
  border-color: #a7f3d0;
}

.example-card__tab--active.example-card__tab--error {
  color: #e11d48;
  border-color: #fecdd3;
}

.document-detail--dark .example-card__tab--active.example-card__tab--success {
  color: #34d399;
  border-color: rgb(16 185 129 / 32%);
}

.document-detail--dark .example-card__tab--active.example-card__tab--error {
  color: #fb7185;
  border-color: rgb(244 63 94 / 32%);
}

.example-card__meta {
  flex: 1;
  flex-wrap: wrap;
  gap: 8px 10px;
}

.example-card__title {
  font-family: 'JetBrains Mono', 'Fira Code', SFMono-Regular, monospace;
  font-size: 12px;
  font-weight: 700;
  color: var(--doc-example-title);
}

.example-card__status-line {
  flex-wrap: wrap;
  gap: 8px;
}

.example-card__content-type {
  max-width: 160px;
  padding: 2px 7px;
  color: var(--doc-example-title);
  background: var(--doc-example-chip-bg);
  border: 1px solid var(--doc-example-border);
  border-radius: var(--doc-chip-radius);
}

.example-card__body {
  display: grid;
  gap: 10px;
  min-width: 0;
  padding: 12px;
  background: var(--doc-example-bg);
}

.example-card__empty {
  min-height: 40px;
  padding: 10px;
  font-size: 12px;
  color: var(--doc-text-muted);
  background: var(--doc-muted-bg);
  border: 1px solid var(--doc-example-border);
  border-radius: var(--doc-radius-sm);
}

.json-panel {
  width: 100%;
  min-width: 0;
  min-height: 120px;
  max-height: none;
  overflow: auto;
  overscroll-behavior: contain auto;
  background: var(--doc-example-bg);
  border: none;
  border-radius: 0;
}

.json-panel.app-json-schema-viewer {
  border: none;
  border-radius: 0;
}

.response-example-select {
  width: 100%;
}

.response-example-select :deep(.el-select__wrapper) {
  min-height: 30px;
  padding: 0 10px;
  background: var(--doc-example-bg);
  border-radius: var(--doc-chip-radius);
  box-shadow: inset 0 0 0 1px var(--doc-example-border);
}

.response-example-select:hover :deep(.el-select__wrapper),
.response-example-select :deep(.el-select__wrapper.is-focused) {
  box-shadow: inset 0 0 0 1px var(--el-color-primary-light-5);
}

.response-example-select :deep(.el-select__selected-item),
.response-example-select :deep(.el-select__placeholder) {
  font-size: 12px;
  color: var(--doc-example-title);
}

.response-example-select :deep(.el-select__selected-item) {
  color: var(--el-text-color-primary);
}

:deep(.response-example-select__popper .el-select-dropdown__item) {
  font-size: 12px;
}

.document-detail__backtop {
  position: sticky;
  bottom: 0;
  z-index: 6;
  height: 0;
  pointer-events: none;
}

.document-backtop-button {
  position: absolute;
  right: 12px;
  bottom: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  color: var(--el-color-primary);
  pointer-events: auto;
  cursor: pointer;
  background: color-mix(in srgb, var(--el-bg-color) 90%, transparent);
  border: 1px solid color-mix(in srgb, var(--el-color-primary) 28%, transparent);
  border-radius: var(--doc-radius-md);
  box-shadow: 0 10px 24px
    color-mix(in srgb, var(--el-text-color-primary) 12%, transparent);
  backdrop-filter: blur(8px);
  transition:
    color 0.16s ease,
    border-color 0.16s ease,
    transform 0.16s ease;
}

.document-backtop-button:hover {
  border-color: color-mix(in srgb, var(--el-color-primary) 50%, transparent);
  transform: translateY(-2px);
}

.document-backtop-button__icon {
  width: 20px;
  height: 20px;
}

:global(.type-code-dialog-overlay) {
  overflow: hidden;
}

:global(.type-code-dialog-overlay .el-overlay-dialog) {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  overflow: hidden;
}

:deep(.type-code-dialog) {
  border-radius: calc(var(--radius) * 1.08);
}

:deep(.type-code-dialog .el-dialog) {
  display: flex;
  flex-direction: column;
  width: min(860px, calc(100vw - 32px));
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 32px);
  margin: 0 auto;
  overflow: hidden;
}

:deep(.type-code-dialog .el-dialog__header) {
  flex: none;
  padding: 18px 20px 0;
  margin: 0;
}

:deep(.type-code-dialog .el-dialog__body) {
  padding: 12px 20px 20px;
  overflow: hidden;
}

.type-code-dialog__header {
  display: flex;
  align-items: center;
  min-width: 0;
}

.type-code-dialog__title {
  font-size: 15px;
  font-weight: 800;
  color: var(--el-text-color-primary);
}

.type-code-dialog__copy-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  min-width: 32px;
  height: 32px;
  padding: 0;
  color: var(--el-text-color-secondary);
  background: color-mix(in srgb, var(--el-bg-color) 94%, transparent);
  border: 1px solid color-mix(in srgb, var(--el-border-color) 82%, transparent);
  border-radius: 10px;
  box-shadow: 0 10px 24px rgb(15 23 42 / 10%);
  backdrop-filter: blur(10px);
}

.type-code-dialog__copy-button:hover {
  color: var(--el-color-primary);
  background: color-mix(
    in srgb,
    var(--el-color-primary-light-9) 86%,
    var(--el-bg-color) 14%
  );
}

.type-code-dialog__body {
  position: relative;
  overflow: hidden;
}

.type-code-dialog__viewer {
  width: 100%;
  min-width: 0;
  height: 100%;
  min-height: 0;
}

.type-code-dialog__body :deep(.markdown-code-block),
.type-code-dialog__body :deep(.markdown-code-block__scroller) {
  height: 100%;
}

@media (max-width: 1180px) {
  .document-detail__layout {
    grid-template-columns: minmax(0, 1fr);
    gap: 24px;
    padding: 18px 20px 32px;
  }

  .document-detail__aside-stack {
    position: static;
    max-height: none;
    padding-right: 0;
    overflow: visible;
  }

  .json-panel {
    max-height: none;
  }
}

@media (max-width: 768px) {
  .document-detail__layout {
    gap: 18px;
    padding: 24px 14px 32px;
  }

  .hero-panel__title {
    font-size: 22px;
  }

  .hero-panel__top,
  .api-section__header,
  .response-card__summary,
  .example-card__header {
    flex-direction: column;
    align-items: stretch;
  }

  .hero-panel__tags,
  .hero-panel__actions,
  .api-section__heading,
  .api-section__meta,
  .response-collapse__status,
  .example-card__meta {
    justify-content: flex-start;
  }

  .hero-panel__endpoint {
    align-items: stretch;
  }

  .endpoint-path {
    width: 100%;
  }

  .response-card__summary,
  .response-collapse__status,
  .example-card__header,
  .example-card__meta {
    gap: 8px;
    align-items: flex-start;
  }

  .response-content-type {
    max-width: 100%;
  }
}
</style>
