<script setup lang="ts">
import type { ApiInfo, SecuritySchemeObject } from '#/typings/openApi';
import type { SecurityMetadata } from '#/utils/securityexpand';

import { computed, onBeforeMount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import { ApiTestRun, ApiTestRunning, SvgApiPrefixIcon } from '@vben/icons';
import { usePreferences } from '@vben/preferences';

import { useClipboard } from '@vueuse/core';
import {
  ElButton,
  ElCollapse,
  ElCollapseItem,
  ElMessage,
  ElOption,
  ElSelect,
  ElTag,
  ElTooltip,
} from 'element-plus';

import JsonViewer from '#/components/json-viewer/index.vue';
import SchemaView from '#/components/schema-view.vue';
import { getMethodStyle } from '#/constants/methods';
import { useApiStore } from '#/store';
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

defineOptions({
  name: 'DocumentView',
});

const props = defineProps<{
  showTest: boolean;
}>();

const emits = defineEmits<{
  test: [data: DebugPayload];
}>();

const { isDark } = usePreferences();
const route = useRoute();
const apiStore = useApiStore();

const baseUrl = ref('');
const apiInfo = ref({} as ApiInfo);
const activeResponseCode = ref('');
const requestBodyType = ref('');
const requestBodyVariantState = ref<Record<string, number>>({});
const requestExampleOpen = ref(false);
const responseExampleOpen = ref<Record<string, boolean>>({});
const responseExampleSelection = ref<Record<string, string>>({});
const responseVariantState = ref<Record<string, Record<string, number>>>({});

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

const securitySchemeMap = computed<Record<string, SecuritySchemeObject>>(() => {
  return apiStore.openApi?.components?.securitySchemes || {};
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
    return { contentType, schema: (body as any)?.schema };
  }

  const first = entries[0];
  if (!first) {
    return null;
  }
  const [contentType, body] = first;
  return { contentType, schema: (body as any)?.schema ?? null };
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

const responseCodes = computed(() => {
  return Object.keys(apiInfo.value?.responses || {});
});

watch(
  responseCodes,
  (codes) => {
    const nextCode = codes.includes('200') ? '200' : codes[0] || '';
    activeResponseCode.value = nextCode;
    responseExampleOpen.value = Object.fromEntries(
      codes.map((code) => [code, false]),
    );
    responseExampleSelection.value = {};
    responseVariantState.value = {};
  },
  { immediate: true },
);

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

const hasAnyParameters = computed(() => {
  return (
    parametersInPath.value.length > 0 ||
    parametersInQuery.value.length > 0 ||
    Boolean(requestBody.value)
  );
});

const { copy: copyToClipboard } = useClipboard();

async function handleCopyBaseUrl() {
  if (!baseUrl.value) return;
  await copyToClipboard(baseUrl.value);
  ElMessage.success('Base URL 已复制');
}

async function handleCopyPath() {
  if (!apiInfo.value.path) return;
  await copyToClipboard(apiInfo.value.path);
  ElMessage.success('Path 已复制');
}

const handleTest = () => {
  if (props.showTest) {
    return;
  }
  if (apiInfo.value) {
    emits('test', getDebugPayload());
  }
};

const toggleResponseExample = (code: string) => {
  responseExampleOpen.value[code] = !responseExampleOpen.value[code];
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
  }

  baseUrl.value = apiStore.openApi?.servers?.[0]?.url || '';
});

defineExpose({
  apiInfo,
  getDebugPayload,
  requestBodyType,
});
</script>

<template>
  <div class="document-detail" :class="{ 'document-detail--dark': isDark }">
    <div class="document-detail__stack">
      <section class="panel hero-panel">
        <div class="hero-panel__top">
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

          <ElButton
            class="hero-panel__debug-button"
            :style="methodStyle"
            @click="handleTest"
            :disabled="showTest"
          >
            {{ showTest ? '调试中' : '在线调试' }}
            <ApiTestRunning v-if="showTest" class="ml-1 size-4 animate-spin" />
            <ApiTestRun v-else class="ml-1 size-4" />
          </ElButton>
        </div>

        <div class="hero-panel__body">
          <h1 class="hero-panel__title">
            {{ summaryText }}
          </h1>
          <div class="hero-panel__description" v-html="descriptionText"></div>

          <div class="hero-panel__endpoint">
            <span class="endpoint-method" :style="methodStyle">
              {{ apiInfo.method?.toUpperCase() }}
            </span>

            <ElTooltip v-if="baseUrl" :content="baseUrl" placement="top">
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
        </div>

        <div v-if="showSecurityPanel" class="hero-panel__security">
          <SecurityView
            :auth-methods="authMethods"
            :metadata="securityMetadata"
          />
        </div>
      </section>

      <section v-if="hasAnyParameters" class="panel section-panel">
        <div class="section-panel__header">
          <div class="section-panel__title">请求参数</div>
        </div>

        <div class="section-panel__stack">
          <article v-if="parametersInPath.length > 0" class="sub-panel">
            <div class="sub-panel__header">
              <div class="sub-panel__title-wrap">
                <div class="sub-panel__title">Path 参数</div>
                <span class="sub-panel__count">{{
                  parametersInPath.length
                }}</span>
              </div>
            </div>

            <ParameterView
              v-for="item in parametersInPath"
              :key="item.name"
              :parameter="item"
            />
          </article>

          <article v-if="parametersInQuery.length > 0" class="sub-panel">
            <div class="sub-panel__header">
              <div class="sub-panel__title-wrap">
                <div class="sub-panel__title">Query 参数</div>
                <span class="sub-panel__count">{{
                  parametersInQuery.length
                }}</span>
              </div>
            </div>

            <ParameterView
              v-for="item in parametersInQuery"
              :key="item.name"
              :parameter="item"
            />
          </article>

          <article v-if="requestBody" class="sub-panel">
            <div class="sub-panel__header sub-panel__header--wrap">
              <div class="sub-panel__title-wrap">
                <div class="sub-panel__title">Body 参数</div>
                <span class="sub-panel__count">{{
                  requestBodyContentType
                }}</span>
              </div>

              <div class="sub-panel__actions">
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
                    @click="
                      requestBodyType = resolveRequestBodyVariantValue(item)
                    "
                  >
                    {{ item.title }}
                  </ElButton>
                </div>

                <ElButton
                  size="small"
                  class="example-toggle-button"
                  :class="{
                    'example-toggle-button--active': requestExampleOpen,
                  }"
                  @click="requestExampleOpen = !requestExampleOpen"
                >
                  {{ requestExampleOpen ? '收起示例' : 'JSON 示例' }}
                </ElButton>
              </div>
            </div>

            <div
              class="schema-layout"
              :class="{ 'schema-layout--open': requestExampleOpen }"
            >
              <div class="schema-layout__main">
                <SchemaView
                  v-if="requestSchemaForView"
                  :key="requestBodyType || '__request_schema__'"
                  :data="requestSchemaForView"
                  mode="request"
                  @variant-change="handleRequestSchemaVariantChange"
                />
              </div>

              <div
                v-if="requestExampleOpen && requestPreviewSchema"
                class="schema-layout__aside"
              >
                <JsonViewer
                  class="json-panel app-json-schema-viewer"
                  :schema="requestPreviewSchema"
                  mode="request"
                />
              </div>
            </div>
          </article>
        </div>
      </section>

      <section class="panel section-panel">
        <div class="section-panel__header">
          <div class="section-panel__title">响应参数</div>
        </div>

        <ElCollapse
          v-if="responsePanels.length > 0"
          v-model="activeResponseCode"
          accordion
          class="response-collapse"
        >
          <ElCollapseItem
            v-for="panel in responsePanels"
            :key="panel.code"
            :name="panel.code"
            class="response-collapse__item"
          >
            <template #title>
              <div class="response-collapse__title">
                <div class="response-collapse__status">
                  <span class="response-code">{{ panel.code }}</span>
                  <span class="response-desc">
                    {{ panel.response?.description || '响应结果' }}
                  </span>
                </div>
                <span v-if="panel.contentType" class="response-content-type">
                  {{ panel.contentType }}
                </span>
              </div>
            </template>

            <div class="response-content">
              <div class="response-content__toolbar">
                <div
                  v-if="
                    responseExampleOpen[panel.code] &&
                    panel.exampleOptions.length > 1
                  "
                  class="response-content__actions"
                >
                  <ElSelect
                    :model-value="responseExampleSelection[panel.code]"
                    size="small"
                    class="response-example-select"
                    popper-class="response-example-select__popper"
                    placeholder="选择示例"
                    @update:model-value="
                      handleResponseExampleSelect(panel.code, $event)
                    "
                  >
                    <ElOption
                      v-for="item in panel.exampleOptions"
                      :key="item.key"
                      :label="item.label"
                      :value="item.key"
                    />
                  </ElSelect>
                </div>

                <ElButton
                  size="small"
                  class="example-toggle-button"
                  :class="{
                    'example-toggle-button--active':
                      responseExampleOpen[panel.code],
                  }"
                  @click.stop="toggleResponseExample(panel.code)"
                >
                  {{
                    responseExampleOpen[panel.code] ? '收起示例' : 'JSON 示例'
                  }}
                </ElButton>
              </div>

              <div
                class="schema-layout"
                :class="{
                  'schema-layout--open': responseExampleOpen[panel.code],
                }"
              >
                <div class="schema-layout__main">
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

                <div
                  v-if="
                    responseExampleOpen[panel.code] &&
                    (panel.schema || panel.hasExampleValue)
                  "
                  class="schema-layout__aside"
                >
                  <JsonViewer
                    class="json-panel app-json-schema-viewer"
                    :schema="getResponsePreviewSchema(panel.code, panel.schema)"
                    :value="
                      panel.hasExampleValue ? panel.exampleValue : undefined
                    "
                    mode="response"
                  />
                </div>
              </div>
            </div>
          </ElCollapseItem>
        </ElCollapse>
        <div v-else class="empty-hint">暂无可展示的响应结构</div>
      </section>
    </div>
  </div>
</template>

<style scoped lang="scss">
.document-detail {
  --doc-chip-radius: calc(var(--radius) * 0.62);
  --doc-radius-xs: calc(var(--radius) * 0.56);
  --doc-radius-sm: calc(var(--radius) * 0.72);
  --doc-radius-md: calc(var(--radius) * 0.94);
  --doc-radius-lg: calc(var(--radius) * 1.18);
  --el-border-radius-base: calc(var(--radius) * 0.75);
  --el-border-radius-small: calc(var(--radius) * 0.62);
  --doc-panel-bg: var(--el-bg-color);
  --doc-soft-bg: color-mix(
    in srgb,
    var(--el-bg-color) 86%,
    var(--el-fill-color-light) 14%
  );
  --doc-soft-bg-alt: color-mix(
    in srgb,
    var(--el-bg-color) 82%,
    var(--el-fill-color-light) 18%
  );
  --doc-soft-bg-strong: color-mix(
    in srgb,
    var(--el-bg-color) 78%,
    var(--el-fill-color-light) 22%
  );
  --doc-section-outer-bg: color-mix(
    in srgb,
    var(--el-bg-color) 74%,
    var(--el-fill-color-light) 26%
  );
  --doc-section-inner-bg: #fff;
  --doc-panel-border: color-mix(
    in srgb,
    var(--el-text-color-primary) 12%,
    transparent
  );
  --doc-sub-panel-border: color-mix(
    in srgb,
    var(--el-text-color-primary) 14%,
    transparent
  );

  height: 100%;
  padding-right: 2px;
  overflow-y: auto;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-thumb {
    background: color-mix(
      in srgb,
      var(--el-text-color-primary) 10%,
      transparent
    );
    border-radius: var(--doc-chip-radius);
  }
}

.document-detail--dark {
  --doc-panel-bg: color-mix(
    in srgb,
    var(--el-bg-color) 90%,
    var(--el-fill-color-light) 10%
  );
  --doc-soft-bg: color-mix(
    in srgb,
    var(--el-bg-color) 86%,
    var(--el-fill-color-light) 14%
  );
  --doc-soft-bg-alt: color-mix(
    in srgb,
    var(--el-bg-color) 82%,
    var(--el-fill-color-light) 18%
  );
  --doc-soft-bg-strong: color-mix(
    in srgb,
    var(--el-bg-color) 78%,
    var(--el-fill-color-light) 22%
  );
  --doc-section-outer-bg: color-mix(
    in srgb,
    var(--el-bg-color) 76%,
    var(--el-fill-color-light) 24%
  );
  --doc-section-inner-bg: color-mix(
    in srgb,
    var(--el-bg-color) 95%,
    var(--el-fill-color-light) 5%
  );
  --doc-panel-border: color-mix(
    in srgb,
    var(--el-text-color-primary) 22%,
    transparent
  );
  --doc-sub-panel-border: color-mix(
    in srgb,
    var(--el-text-color-primary) 20%,
    transparent
  );
}

.document-detail__stack {
  display: grid;
  gap: 14px;
}

.panel {
  position: relative;
  overflow: hidden;
  background: var(--doc-panel-bg);
  border: 1px solid var(--doc-panel-border);
  border-radius: var(--doc-radius-lg);
  box-shadow: 0 8px 18px
    color-mix(in srgb, var(--el-text-color-primary) 4%, transparent);
}

.hero-panel,
.section-panel {
  padding: 16px;
}

.section-panel {
  background: var(--doc-section-outer-bg);
}

.hero-panel__top,
.hero-panel__endpoint,
.section-panel__header,
.sub-panel__header,
.response-content__toolbar,
.sub-panel__title-wrap {
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
}

.hero-panel__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.hero-tag {
  color: var(--el-text-color-secondary);
  background: color-mix(
    in srgb,
    var(--el-bg-color) 82%,
    var(--el-fill-color-light) 18%
  );
  border: 1px solid var(--el-border-color-light);
}

.hero-panel__body {
  display: grid;
  gap: 10px;
  margin-top: 12px;
}

.hero-panel__security {
  padding: 10px 12px;
  margin-top: 12px;
  background: var(--doc-soft-bg-strong);
  border: 1px solid var(--doc-sub-panel-border);
  border-radius: var(--doc-radius-sm);
}

.hero-panel__title {
  font-size: 24px;
  font-weight: 800;
  line-height: 1.16;
  color: var(--el-text-color-primary);
}

.hero-panel__description {
  font-size: 13px;
  line-height: 1.7;
  color: var(--el-text-color-regular);
}

.hero-panel__description :deep(p) {
  margin: 0;
}

.hero-panel__debug-button {
  flex: none;
  min-width: 108px;
  height: 36px;
  padding: 0 14px;
  font-weight: 700;
  border: none;
}

.hero-panel__endpoint {
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-start;
  padding: 10px;
  margin-top: 2px;
  background: var(--doc-soft-bg-alt);
  border: 1px solid var(--doc-sub-panel-border);
  border-radius: var(--doc-radius-sm);
}

.endpoint-method {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 72px;
  height: 32px;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 800;
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
  width: auto;
  height: auto;
  padding: 0;
  color: color-mix(in srgb, var(--el-color-primary) 88%, #fff 12%);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 0;
  box-shadow: none;
  transition: all 0.2s ease;
}

.endpoint-prefix__icon {
  width: 19px;
  height: 19px;
  opacity: 0.9;
}

.endpoint-path {
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  cursor: pointer;
  background: color-mix(
    in srgb,
    var(--el-bg-color) 84%,
    var(--el-fill-color-light) 16%
  );
  border-radius: var(--doc-radius-xs);
  transition: all 0.2s ease;
}

.endpoint-prefix:hover,
.endpoint-path:hover {
  background: color-mix(
    in srgb,
    var(--el-bg-color) 72%,
    var(--el-color-primary-light-9) 28%
  );
}

.endpoint-prefix:hover {
  color: var(--el-color-primary);
  background: transparent;
  transform: scale(1.04);
}

.section-panel__header {
  margin-bottom: 10px;
}

.section-panel__title,
.sub-panel__title {
  font-size: 15px;
  font-weight: 800;
  line-height: 1.2;
  color: var(--el-text-color-primary);
}

.section-panel__stack {
  display: grid;
  gap: 12px;
}

.sub-panel {
  min-width: 0;
  padding: 12px;
  background: var(--doc-section-inner-bg);
  border: 1px solid var(--doc-sub-panel-border);
  border-radius: var(--doc-radius-sm);
}

.sub-panel__header {
  margin-bottom: 6px;
}

.sub-panel__header--wrap {
  flex-wrap: wrap;
}

.sub-panel__count {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 10px;
  font-size: 11px;
  font-weight: 700;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--doc-chip-radius);
}

.sub-panel__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: flex-end;
}

.body-type-switch {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}

.body-type-switch__button {
  min-height: 30px;
  padding: 0 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  background: color-mix(
    in srgb,
    var(--doc-panel-bg) 90%,
    var(--el-fill-color-light) 10%
  );
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--doc-chip-radius);
  transition: all 0.2s ease;
}

.body-type-switch__button:hover {
  color: var(--el-text-color-primary);
  border-color: color-mix(in srgb, var(--el-color-primary) 35%, transparent);
}

.body-type-switch__button--active {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary-light-7);
}

.example-toggle-button {
  min-width: 88px;
  height: 30px;
  padding: 0 12px;
  color: var(--el-color-primary);
  background: color-mix(
    in srgb,
    var(--doc-panel-bg) 88%,
    var(--el-color-primary-light-9) 12%
  );
  border: 1px solid color-mix(in srgb, var(--el-color-primary) 28%, transparent);
  border-radius: var(--doc-chip-radius);
  box-shadow: inset 0 0 0 1px
    color-mix(in srgb, var(--el-color-primary) 8%, transparent);
  transition: all 0.2s ease;
}

.example-toggle-button:hover {
  color: var(--el-color-primary);
  background: color-mix(
    in srgb,
    var(--doc-panel-bg) 74%,
    var(--el-color-primary-light-9) 26%
  );
  border-color: color-mix(in srgb, var(--el-color-primary) 42%, transparent);
}

.example-toggle-button--active {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary-light-7);
}

.schema-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
  transition: grid-template-columns 0.24s ease;
}

.schema-layout--open {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}

.schema-layout__main {
  min-width: 0;
}

.schema-layout__aside {
  min-width: 0;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 0;
}

.json-panel {
  background: var(--doc-section-inner-bg);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--doc-radius-xs);
}

.json-panel :deep(.theme-light),
.json-panel :deep(.theme-dark) {
  padding: 10px;
  background: transparent;
  border: none;
}

.json-panel :deep(.json-node) {
  margin: 0;
}

.json-panel :deep(.node-header),
.json-panel :deep(.node-primitive) {
  min-height: 20px;
  font-size: 12px;
}

.response-collapse {
  --el-collapse-border-color: transparent;

  :deep(.el-collapse-item__wrap) {
    background: transparent;
    border-bottom: none;
  }

  :deep(.el-collapse-item__header) {
    height: auto;
    padding: 0;
    background: transparent;
    border-bottom: none;
  }

  :deep(.el-collapse-item__content) {
    padding-bottom: 0;
  }

  :deep(.el-collapse-item__arrow) {
    margin: 0 0 0 8px;
    font-size: 12px;
  }
}

.response-collapse__item {
  padding: 2px 10px;
  margin-bottom: 6px;
  background: var(--doc-section-inner-bg);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--doc-radius-sm);
}

.response-collapse__item:last-child {
  margin-bottom: 0;
}

.response-collapse__title {
  display: flex;
  flex: 1;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
}

.response-collapse__status {
  display: flex;
  gap: 6px;
  align-items: center;
  min-width: 0;
}

.response-code {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 42px;
  height: 24px;
  padding: 0 8px;
  font-family: 'JetBrains Mono', 'Fira Code', SFMono-Regular, monospace;
  font-size: 12px;
  font-weight: 800;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border: 1px solid var(--el-color-primary-light-7);
  border-radius: var(--doc-chip-radius);
}

.response-desc {
  font-size: 12px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.response-content-type {
  flex: none;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}

.response-content {
  margin-top: 1px;
}

.response-content__toolbar {
  justify-content: flex-end;
  margin-bottom: 1px;
}

.response-content__actions {
  display: inline-flex;
  flex: 1;
  justify-content: flex-end;
  min-width: 0;
}

.response-example-select {
  width: min(240px, 100%);
  min-width: 168px;
}

.response-example-select :deep(.el-select__wrapper) {
  min-height: 30px;
  padding: 0 10px;
  background: color-mix(
    in srgb,
    var(--doc-panel-bg) 90%,
    var(--el-fill-color-light) 10%
  );
  border-radius: var(--doc-chip-radius);
  box-shadow: inset 0 0 0 1px var(--el-border-color-lighter);
  transition: all 0.2s ease;
}

.response-example-select:hover :deep(.el-select__wrapper),
.response-example-select :deep(.el-select__wrapper.is-focused) {
  box-shadow: inset 0 0 0 1px
    color-mix(in srgb, var(--el-color-primary) 35%, transparent);
}

.response-example-select :deep(.el-select__selected-item),
.response-example-select :deep(.el-select__placeholder) {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.response-example-select :deep(.el-select__selected-item) {
  color: var(--el-text-color-primary);
}

:deep(.response-example-select__popper .el-select-dropdown__item) {
  font-size: 12px;
}

.empty-hint {
  display: inline-flex;
  align-items: center;
  min-height: 40px;
  padding: 0 12px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  background: var(--doc-section-inner-bg);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--doc-radius-xs);
}

@media (max-width: 768px) {
  .hero-panel,
  .section-panel {
    padding: 14px;
  }

  .hero-panel__title {
    font-size: 22px;
  }

  .hero-panel__top,
  .sub-panel__header,
  .response-content__toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .hero-panel__tags,
  .sub-panel__actions,
  .sub-panel__title-wrap,
  .response-content__actions {
    justify-content: flex-start;
  }

  .response-example-select {
    width: 100%;
  }

  .schema-layout--open {
    grid-template-columns: minmax(0, 1fr);
  }

  .response-collapse__title {
    gap: 8px;
    align-items: flex-start;
  }

  .response-collapse__status {
    flex-direction: column;
    align-items: flex-start;
  }

  .response-content-type {
    max-width: 100%;
  }
}
</style>
