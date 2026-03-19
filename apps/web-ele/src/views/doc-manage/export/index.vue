<script setup lang="ts">
import type { OpenAPISpec, SwaggerConfig } from '#/typings/openApi';

import { computed, onBeforeUnmount, ref, watch } from 'vue';

import { preferences } from '@vben/preferences';

import {
  ElAlert,
  ElButton,
  ElCard,
  ElCheckbox,
  ElCheckboxGroup,
  ElCol,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElEmpty,
  ElForm,
  ElFormItem,
  ElInput,
  ElMessage,
  ElOption,
  ElRadio,
  ElRadioGroup,
  ElRow,
  ElSelect,
  ElSkeleton,
  ElSpace,
} from 'element-plus';
import MarkdownIt from 'markdown-it';
import { storeToRefs } from 'pinia';

import JsonView from '#/components/json-view.vue';
import { useApiStore } from '#/store';
import { useAggregationStore } from '#/store/aggregation';

defineOptions({ name: 'DocManageExport' });

type ExportFormat = 'doc' | 'html' | 'markdown' | 'openapi.json' | 'pdf';
type PreviewFormat = 'html' | 'markdown' | 'openapi';
type ScopeMode = 'all' | 'groups' | 'operations';

interface GroupDocItem {
  code: string;
  name: string;
  openApi?: OpenAPISpec;
  url?: string;
}

interface OperationItem {
  description?: string;
  groupCode: string;
  key: string;
  method: string;
  operationId?: string;
  path: string;
  raw: any;
  summary?: string;
  tags?: string[];
}

const HTTP_METHODS = new Set(['delete', 'get', 'patch', 'post', 'put']);
const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: true,
  typographer: true,
});

const apiStore = useApiStore();
const aggregationStore = useAggregationStore();
const { currentService, isAggregation, services } =
  storeToRefs(aggregationStore);

const loading = ref(false);
const previewLoading = ref(false);
const themeSwitching = ref(false);

const selectedServiceUrl = ref('');
const scopeMode = ref<ScopeMode>('all');
const selectedGroups = ref<string[]>([]);
const selectedOperations = ref<string[]>([]);
const operationKeyword = ref('');
const operationMethod = ref('all');

type ExportDocOption = 'brand' | 'info' | 'otherDocs';
const exportDocOptions = ref<ExportDocOption[]>([]);
const includeInfo = computed(() => exportDocOptions.value.includes('info'));
const includeBrand = computed(() => exportDocOptions.value.includes('brand'));
const includeMarkdownDocs = computed(() =>
  exportDocOptions.value.includes('otherDocs'),
);

const previewFormat = ref<PreviewFormat>('markdown');
const exportFormat = ref<ExportFormat>('doc');
const previewHtml = ref('');
const previewOpenApi = ref<any>(null);
const hasPreviewGenerated = ref(false);

const currentOpenApi = ref<null | OpenAPISpec>(null);
const currentSwaggerConfig = ref<null | SwaggerConfig>(null);
const groupDocs = ref<GroupDocItem[]>([]);
const operations = ref<OperationItem[]>([]);
let themeSwitchTimer: null | ReturnType<typeof window.setTimeout> = null;

const serviceOptions = computed(() => {
  return services.value.map((service) => ({
    disabled: !!service.disabled,
    label: service.name,
    value: service.url,
  }));
});

const filteredOperations = computed(() => {
  const keyword = operationKeyword.value.trim().toLowerCase();
  return operations.value.filter((item) => {
    const passMethod =
      operationMethod.value === 'all' || item.method === operationMethod.value;
    const passKeyword =
      !keyword ||
      item.path.toLowerCase().includes(keyword) ||
      (item.summary || '').toLowerCase().includes(keyword) ||
      (item.description || '').toLowerCase().includes(keyword) ||
      (item.operationId || '').toLowerCase().includes(keyword) ||
      (item.tags || []).join(' ').toLowerCase().includes(keyword);
    return passMethod && passKeyword;
  });
});

const selectedOperationItems = computed(() => {
  const selectedKeys = new Set(selectedOperations.value);
  return operations.value.filter((item) => selectedKeys.has(item.key));
});

const selectedGroupItems = computed(() => {
  const selectedSet = new Set(selectedGroups.value);
  return groupDocs.value.filter((item) => selectedSet.has(item.code));
});

const summaryText = computed(() => {
  const base = currentOpenApi.value;
  if (!base) return '暂无可导出文档数据';

  const totalOps = operations.value.length;
  const totalGroups = currentSwaggerConfig.value?.urls?.length || 0;
  if (scopeMode.value === 'all') {
    return `当前将导出全部接口，共 ${totalOps} 个，分组 ${totalGroups} 个`;
  }
  if (scopeMode.value === 'groups') {
    return `当前已选择分组 ${selectedGroupItems.value.length} 个`;
  }
  return `当前已选择接口 ${selectedOperationItems.value.length} 个`;
});

const isPreviewEmpty = computed(() => {
  if (previewFormat.value === 'openapi') {
    return !previewOpenApi.value;
  }
  return !previewHtml.value;
});

const previewFormatTextMap: Record<PreviewFormat, string> = {
  markdown: 'Markdown 预览',
  html: 'HTML 预览',
  openapi: 'OpenAPI JSON',
};
const exportFormatTextMap: Record<ExportFormat, string> = {
  doc: 'Word(.doc)',
  pdf: 'PDF',
  markdown: 'Markdown',
  html: 'HTML',
  'openapi.json': 'OpenAPI JSON',
};

function parseGroupCode(url: string) {
  const segments = url.split('/');
  return segments[segments.length - 1] || 'default';
}

function getOperationKey(
  groupCode: string,
  method: string,
  path: string,
  operationId?: string,
) {
  return `${groupCode}::${method}::${path}::${operationId || ''}`;
}

function cloneOpenApi(data: any) {
  return structuredClone(data);
}

function collectOperationsFromPaths(
  paths: Record<string, any>,
  groupCode: string,
): OperationItem[] {
  const result: OperationItem[] = [];

  Object.entries(paths || {}).forEach(([path, methodConfig]) => {
    Object.entries(methodConfig || {}).forEach(([method, rawData]) => {
      const raw = rawData as any;
      const methodName = method.toLowerCase();
      if (!HTTP_METHODS.has(methodName)) {
        return;
      }
      result.push({
        key: getOperationKey(groupCode, methodName, path, raw?.operationId),
        groupCode,
        method: methodName,
        path,
        summary: raw?.summary,
        description: raw?.description,
        operationId: raw?.operationId,
        tags: raw?.tags ?? [],
        raw,
      });
    });
  });

  return result;
}

function mergeComponents(docs: OpenAPISpec[]) {
  const schemas: Record<string, any> = {};
  const securitySchemes: Record<string, any> = {};

  docs.forEach((doc) => {
    Object.assign(schemas, doc.components?.schemas ?? {});
    Object.assign(securitySchemes, doc.components?.securitySchemes ?? {});
  });

  return {
    schemas,
    ...(Object.keys(securitySchemes).length > 0 ? { securitySchemes } : {}),
  };
}

function getEnumDescription(schema?: any) {
  if (!schema) return '';
  const extended = schema['x-nextdoc4j-enum'];
  if (extended?.items?.length) {
    return extended.items
      .map(
        (item: any) =>
          `${item.value}${item.description ? `(${item.description})` : ''}`,
      )
      .join(', ');
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum.join(', ');
  }
  return '';
}

function formatSecurityText(raw: any) {
  const security = raw?.['x-nextdoc4j-security'];
  if (!security) {
    return '无';
  }
  if (security.ignore) {
    return '忽略权限校验';
  }

  const roleText = (security.roles || [])
    .map((item: any) => item.values?.join(item.mode === 'OR' ? ' | ' : ' & '))
    .filter(Boolean)
    .join(' | ');
  const permissionText = (security.permissions || [])
    .map((item: any) => item.values?.join(item.mode === 'OR' ? ' | ' : ' & '))
    .filter(Boolean)
    .join(' | ');

  const lines = [];
  if (roleText) lines.push(`角色：${roleText}`);
  if (permissionText) lines.push(`权限：${permissionText}`);
  return lines.length > 0 ? lines.join('；') : '无';
}

function toLogoDataUrl(logo?: string) {
  if (!logo) return '';
  if (logo.startsWith('data:image/')) {
    return logo;
  }
  if (logo.startsWith('http://') || logo.startsWith('https://')) {
    return logo;
  }
  // 兼容后端直接给纯 base64 的场景，默认按 png 渲染
  return `data:image/png;base64,${logo}`;
}

function parseSchemaRef(ref?: string) {
  if (!ref) return '';
  return ref.replace('#/components/schemas/', '');
}

function resolveSchemaRef(
  schema: any,
  doc: OpenAPISpec,
  seen = new Set<string>(),
): any {
  if (!schema) return null;
  if (!schema.$ref) return schema;

  const refName = parseSchemaRef(schema.$ref);
  if (!refName || seen.has(refName)) {
    return {
      description: schema.description || '',
      title: refName || schema.$ref,
      type: 'object',
    };
  }

  const source = doc.components?.schemas?.[refName];
  if (!source) {
    return {
      description: schema.description || '',
      title: refName,
      type: 'object',
    };
  }

  const nextSeen = new Set(seen);
  nextSeen.add(refName);
  const resolved = resolveSchemaRef(source, doc, nextSeen);
  return {
    ...resolved,
    description: schema.description || resolved?.description || '',
    title: resolved?.title || refName,
  };
}

function mergeAllOf(schema: any, doc: OpenAPISpec, seen = new Set<string>()) {
  const merged: any = {
    description: schema?.description || '',
    properties: {},
    required: [] as string[],
    type: 'object',
  };

  (schema?.allOf || []).forEach((item: any) => {
    const current = normalizeSchema(item, doc, seen);
    Object.assign(merged.properties, current?.properties || {});
    merged.required.push(...(current?.required || []));
  });

  merged.required = [...new Set(merged.required)];
  return merged;
}

function normalizeSchema(
  schema: any,
  doc: OpenAPISpec,
  seen = new Set<string>(),
): any {
  if (!schema) return null;
  const resolvedRef = resolveSchemaRef(schema, doc, seen);
  if (!resolvedRef) return null;

  if (resolvedRef.allOf?.length) {
    return mergeAllOf(resolvedRef, doc, seen);
  }

  if (resolvedRef.oneOf?.length) {
    return normalizeSchema(resolvedRef.oneOf[0], doc, seen);
  }

  return resolvedRef;
}

function schemaTypeText(schema: any, doc: OpenAPISpec): string {
  if (!schema) return '-';
  if (schema.$ref) {
    return parseSchemaRef(schema.$ref) || 'object';
  }
  if (schema.type === 'array') {
    const item = normalizeSchema(schema.items, doc);
    return `array<${schemaTypeText(item, doc)}>`;
  }
  if (schema.type) return schema.type;
  if (schema.properties) return 'object';
  return '-';
}

type SchemaFieldRow = {
  description: string;
  enumText: string;
  name: string;
  required: boolean;
  type: string;
};

type SchemaFieldGroup = {
  description: string;
  rows: SchemaFieldRow[];
  title: string;
};

function collectSchemaFields(
  schema: any,
  doc: OpenAPISpec,
  parentPath = '',
): SchemaFieldRow[] {
  const normalized = normalizeSchema(schema, doc);
  if (!normalized) return [];

  const rows: SchemaFieldRow[] = [];

  if (normalized.type === 'array') {
    const itemSchema = normalizeSchema(normalized.items, doc);
    const arrayPath = parentPath ? `${parentPath}[]` : '[]';
    rows.push({
      name: arrayPath,
      type: schemaTypeText(itemSchema, doc),
      required: true,
      enumText: getEnumDescription(itemSchema) || '-',
      description: itemSchema?.description || '',
    });

    if (itemSchema?.type === 'object' || itemSchema?.properties) {
      rows.push(...collectSchemaFields(itemSchema, doc, arrayPath));
    }
    return rows;
  }

  if (normalized.type === 'object' || normalized.properties) {
    const requiredSet = new Set<string>(normalized.required || []);
    Object.entries(normalized.properties || {}).forEach(([key, raw]) => {
      const field = normalizeSchema(raw, doc);
      const path = parentPath ? `${parentPath}.${key}` : key;
      rows.push({
        name: path,
        type: schemaTypeText(field, doc),
        required: requiredSet.has(key),
        enumText: getEnumDescription(field) || '-',
        description: field?.description || '',
      });

      if (field?.type === 'object' || field?.properties) {
        rows.push(...collectSchemaFields(field, doc, path));
      } else if (field?.type === 'array') {
        rows.push(...collectSchemaFields(field, doc, path));
      }
    });
    return rows;
  }

  rows.push({
    name: parentPath || '(root)',
    type: schemaTypeText(normalized, doc),
    required: true,
    enumText: getEnumDescription(normalized) || '-',
    description: normalized.description || '',
  });

  return rows;
}

function extractSchemaVariants(
  schema: any,
  doc: OpenAPISpec,
  seen = new Set<string>(),
): any[] {
  const resolved = resolveSchemaRef(schema, doc, seen);
  if (!resolved) {
    return [];
  }

  if (resolved.oneOf?.length) {
    return resolved.oneOf.flatMap((item: any) =>
      extractSchemaVariants(item, doc, new Set(seen)),
    );
  }

  if (resolved.anyOf?.length) {
    return resolved.anyOf.flatMap((item: any) =>
      extractSchemaVariants(item, doc, new Set(seen)),
    );
  }

  return [resolved];
}

function buildSchemaFieldGroups(
  schema: any,
  doc: OpenAPISpec,
): SchemaFieldGroup[] {
  const variants = extractSchemaVariants(schema, doc);
  if (variants.length <= 0) {
    return [];
  }

  if (variants.length === 1) {
    return [
      {
        title: '',
        description: variants[0]?.description || '',
        rows: collectSchemaFields(variants[0], doc),
      },
    ];
  }

  return variants.map((variant, index) => {
    const normalized = normalizeSchema(variant, doc);
    const refTitle = variant?.$ref ? parseSchemaRef(variant.$ref) : '';
    return {
      title:
        normalized?.title || variant?.title || refTitle || `方案 ${index + 1}`,
      description: normalized?.description || variant?.description || '',
      rows: collectSchemaFields(normalized || variant, doc),
    };
  });
}

function toDisplayFieldName(path: string) {
  if (!path || path === '(root)' || path === '[]') {
    return 'value';
  }
  const isArray = path.endsWith('[]');
  const plain = path.replaceAll('[]', '');
  const segments = plain.split('.').filter(Boolean);
  const depth = Math.max(segments.length - 1, 0);
  const name = segments.at(-1) || 'value';
  return `${'&nbsp;&nbsp;'.repeat(depth)}${name}${isArray ? '[]' : ''}`;
}

function loadGroupDocsForSingleFromCache(config: SwaggerConfig) {
  const groupedApiData = apiStore.apiData || {};
  const groupCodes = Object.keys(groupedApiData).filter(
    (code) => code !== 'all',
  );
  const nameMap = new Map(
    (config.urls || []).map((item) => [
      parseGroupCode(item.url),
      item.name?.trim(),
    ]),
  );

  groupDocs.value = groupCodes.map((code) => ({
    code,
    name: nameMap.get(code) || code,
    url: (config.urls || []).find((item) => parseGroupCode(item.url) === code)
      ?.url,
  }));
}

async function loadGroupDocsForAggregation(
  serviceUrl: string,
  config: SwaggerConfig,
) {
  const urls = config.urls || [];
  const docs: GroupDocItem[] = [];
  const service = services.value.find((item) => item.url === serviceUrl);

  if (!service) {
    groupDocs.value = [];
    return;
  }

  const servicePrefix = service.url.replace('/v3/api-docs', '');
  for (const item of urls) {
    const code = parseGroupCode(item.url);
    if (code === 'all') continue;

    const fullUrl = `${servicePrefix}${item.url}`;
    const openApi = await aggregationStore.getServiceGroupDoc(service, fullUrl);
    docs.push({
      code,
      name: item.name?.trim() || code,
      openApi,
      url: fullUrl,
    });
  }

  groupDocs.value = docs;
}

function rebuildOperations(useCachedGrouping = false) {
  const map = new Map<string, OperationItem>();

  if (useCachedGrouping) {
    Object.entries(apiStore.apiData || {}).forEach(([groupCode, tagGroup]) => {
      if (groupCode === 'all') return;
      Object.values(tagGroup || {}).forEach((items) => {
        (items || []).forEach((api: any) => {
          const methodName = (api.method || '').toLowerCase();
          if (!HTTP_METHODS.has(methodName)) return;
          const source =
            currentOpenApi.value?.paths?.[api.path]?.[methodName] || api;
          map.set(
            getOperationKey(
              groupCode,
              methodName,
              api.path,
              source?.operationId,
            ),
            {
              key: getOperationKey(
                groupCode,
                methodName,
                api.path,
                source?.operationId,
              ),
              groupCode,
              method: methodName,
              path: api.path,
              summary: source?.summary,
              description: source?.description,
              operationId: source?.operationId,
              tags: source?.tags ?? api?.tags ?? [],
              raw: source,
            },
          );
        });
      });
    });
  }

  if (!useCachedGrouping || map.size <= 0) {
    collectOperationsFromPaths(
      currentOpenApi.value?.paths || {},
      'all',
    ).forEach((item) => {
      map.set(item.key, item);
    });
  }

  groupDocs.value.forEach((group) => {
    collectOperationsFromPaths(group.openApi?.paths || {}, group.code).forEach(
      (item) => {
        map.set(item.key, item);
      },
    );
  });

  operations.value = [...map.values()].sort((a, b) => {
    return `${a.groupCode}${a.path}${a.method}`.localeCompare(
      `${b.groupCode}${b.path}${b.method}`,
      'zh-CN',
    );
  });

  selectedGroups.value = [];
  selectedOperations.value = [];
}

async function loadDocContext() {
  loading.value = true;
  resetPreviewState();
  try {
    if (isAggregation.value) {
      const serviceUrl = selectedServiceUrl.value || currentService.value?.url;
      if (!serviceUrl) {
        currentOpenApi.value = null;
        currentSwaggerConfig.value = null;
        groupDocs.value = [];
        operations.value = [];
        return;
      }

      selectedServiceUrl.value = serviceUrl;
      const service = services.value.find((item) => item.url === serviceUrl);
      if (!service) {
        ElMessage.warning('未找到可用服务');
        return;
      }

      const serviceData = await aggregationStore.getServiceData(service);
      currentOpenApi.value = serviceData.openApi;
      currentSwaggerConfig.value = serviceData.config;
      await loadGroupDocsForAggregation(serviceUrl, serviceData.config);
      rebuildOperations();
      return;
    }

    const openApi = apiStore.openApi;
    const swaggerConfig = apiStore.swaggerConfig;
    if (!openApi || !swaggerConfig) {
      currentOpenApi.value = null;
      currentSwaggerConfig.value = null;
      groupDocs.value = [];
      operations.value = [];
      ElMessage.warning('未命中文档缓存，请先进入“接口文档”页面后再导出');
      return;
    }

    currentOpenApi.value = openApi;
    currentSwaggerConfig.value = swaggerConfig;
    loadGroupDocsForSingleFromCache(swaggerConfig);

    const hasCachedGrouping = Object.keys(apiStore.apiData || {}).some(
      (key) => key !== 'all',
    );
    rebuildOperations(hasCachedGrouping);
  } catch (error: any) {
    console.error(error);
    ElMessage.error(error?.message || '加载文档数据失败');
  } finally {
    loading.value = false;
  }
}

function buildSelectedOperations() {
  if (scopeMode.value === 'all') {
    return operations.value;
  }
  if (scopeMode.value === 'groups') {
    const selected = new Set(selectedGroups.value);
    return operations.value.filter((item) => selected.has(item.groupCode));
  }
  const selected = new Set(selectedOperations.value);
  return operations.value.filter((item) => selected.has(item.key));
}

function buildSubsetOpenApi(selectedOpsInput?: OperationItem[]) {
  if (!currentOpenApi.value) {
    return null;
  }

  const selectedOps = selectedOpsInput ?? buildSelectedOperations();
  if (selectedOps.length <= 0) {
    return null;
  }

  const selectedPaths: Record<string, Record<string, any>> = {};
  selectedOps.forEach((item) => {
    if (!selectedPaths[item.path]) {
      selectedPaths[item.path] = {};
    }
    selectedPaths[item.path]![item.method] = cloneOpenApi(item.raw);
  });

  const docsForComponents = [
    currentOpenApi.value,
    ...groupDocs.value
      .map((item) => item.openApi)
      .filter((doc): doc is OpenAPISpec => !!doc),
  ];

  const baseInfo = currentOpenApi.value.info;
  const info = includeInfo.value
    ? cloneOpenApi(baseInfo)
    : {
        title: baseInfo?.title || 'API 文档',
        version: baseInfo?.version || '1.0.0',
      };

  const xNextDoc = cloneOpenApi(currentOpenApi.value['x-nextdoc4j'] || {});
  if (!includeBrand.value) {
    delete xNextDoc.brand;
  }
  if (!includeMarkdownDocs.value) {
    delete xNextDoc.markdown;
  }

  const subset: any = {
    openapi: currentOpenApi.value.openapi,
    info,
    servers: cloneOpenApi(currentOpenApi.value.servers || []),
    paths: selectedPaths,
    components: mergeComponents(docsForComponents),
  };

  if (currentOpenApi.value.security) {
    subset.security = cloneOpenApi(currentOpenApi.value.security);
  }
  if (Object.keys(xNextDoc).length > 0) {
    subset['x-nextdoc4j'] = xNextDoc;
  }
  if (currentOpenApi.value['x-nextdoc4j-aggregation']) {
    subset['x-nextdoc4j-aggregation'] = cloneOpenApi(
      currentOpenApi.value['x-nextdoc4j-aggregation'],
    );
  }

  return subset as OpenAPISpec;
}

function appendSchemaRows(lines: string[], rows: SchemaFieldRow[]) {
  if (rows.length <= 0) {
    lines.push('- 暂无字段', '');
    return;
  }

  lines.push(
    '| 字段 | 类型 | 必填 | 枚举 | 说明 |',
    '| --- | --- | --- | --- | --- |',
  );
  rows.forEach((row) => {
    lines.push(
      `| ${toDisplayFieldName(row.name)} | ${row.type || '-'} | ${row.required ? '是' : '否'} | ${row.enumText || '-'} | ${row.description || '-'} |`,
    );
  });
  lines.push('');
}

function appendSchemaFieldGroups(lines: string[], groups: SchemaFieldGroup[]) {
  if (groups.length <= 0) {
    appendSchemaRows(lines, []);
    return;
  }

  if (groups.length === 1) {
    appendSchemaRows(lines, groups[0]?.rows || []);
    return;
  }

  groups.forEach((group, index) => {
    lines.push(
      `##### 结构方案 ${index + 1}${group.title ? `：${group.title}` : ''}`,
      '',
    );
    if (group.description) {
      lines.push(`- 说明: ${group.description}`, '');
    }
    appendSchemaRows(lines, group.rows || []);
  });
}

function getGroupTitle(groupCode: string) {
  if (!groupCode || groupCode === 'all') {
    return '所有接口';
  }
  return (
    groupDocs.value.find((item) => item.code === groupCode)?.name || groupCode
  );
}

function buildMarkdownDocument(doc: OpenAPISpec, selectedOps: OperationItem[]) {
  const lines: string[] = [];
  const info = doc.info;
  const extension: any = doc['x-nextdoc4j'] || {};

  lines.push(`# ${info?.title || 'API 文档'}`, '', '## 接口清单', '');

  const ops = (
    selectedOps.length > 0
      ? selectedOps
      : collectOperationsFromPaths(doc.paths || {}, 'all')
  )
    .filter((item) => !!doc.paths?.[item.path]?.[item.method])
    .sort((a, b) => {
      return `${a.groupCode}::${a.path}::${a.method}`.localeCompare(
        `${b.groupCode}::${b.path}::${b.method}`,
        'zh-CN',
      );
    });

  let currentGroup = '';
  ops.forEach((op, index) => {
    const groupCode = op.groupCode || 'all';
    if (groupCode !== currentGroup) {
      currentGroup = groupCode;
      lines.push(`## 分组：${getGroupTitle(groupCode)}`, '');
    }

    const raw = doc.paths?.[op.path]?.[op.method];
    if (!raw) return;

    if (index > 0) {
      lines.push('---', '');
    }

    lines.push(
      `<div style="padding:10px 12px;border:1px solid #dcdfe6;border-left:4px solid #409eff;border-radius:6px;"><strong>${op.method.toUpperCase()} ${op.path}</strong></div>`,
      '',
      `- 摘要: ${raw.summary || '-'}`,
    );
    if (raw.description) {
      lines.push(`- 描述: ${raw.description}`);
    }
    lines.push(`- 操作ID: ${raw.operationId || '-'}`);
    if (raw.tags?.length) {
      lines.push(`- 标签: ${raw.tags.join(', ')}`);
    }
    lines.push(`- 权限: ${formatSecurityText(raw)}`, '');

    const params = raw.parameters || [];
    if (params.length > 0) {
      lines.push(
        '#### 请求参数',
        '',
        '| 参数位置 | 参数名 | 类型 | 必填 | 枚举 | 说明 |',
        '| --- | --- | --- | --- | --- | --- |',
      );
      params.forEach((param: any) => {
        const normalizedSchema = normalizeSchema(param.schema, doc);
        lines.push(
          `| ${param.in || '-'} | ${param.name || '-'} | ${schemaTypeText(normalizedSchema, doc)} | ${param.required ? '是' : '否'} | ${getEnumDescription(normalizedSchema) || '-'} | ${param.description || normalizedSchema?.description || '-'} |`,
        );
      });
      lines.push('');
    }

    if (raw.requestBody?.content) {
      Object.entries(raw.requestBody.content).forEach(([contentType, body]) => {
        lines.push(
          `<div style="display:flex;justify-content:space-between;align-items:center;"><strong>请求体参数</strong><span>Content-Type: ${contentType}</span></div>`,
          '',
        );
        const groups = buildSchemaFieldGroups((body as any)?.schema, doc);
        appendSchemaFieldGroups(lines, groups);
      });
    }

    if (raw.responses) {
      Object.entries(raw.responses).forEach(
        ([code, response]: [string, any]) => {
          if (!response?.content) {
            lines.push(
              `- 响应 ${code}（${response?.description || '-'}）：无响应体`,
              '',
            );
            return;
          }
          Object.entries(response.content).forEach(
            ([contentType, content]: [string, any]) => {
              lines.push(
                `<div style="display:flex;justify-content:space-between;align-items:center;"><strong>响应参数（${code} - ${response?.description || '-'}）</strong><span>Content-Type: ${contentType}</span></div>`,
                '',
              );
              const groups = buildSchemaFieldGroups(content?.schema, doc);
              appendSchemaFieldGroups(lines, groups);
            },
          );
        },
      );
    }
  });

  if (includeInfo.value) {
    lines.push('## OpenAPI Info', '');
    if (info?.description) {
      lines.push(info.description, '');
    }
    lines.push(`- OpenAPI: ${doc.openapi}`, `- 版本: ${info?.version || '-'}`);
    if (info?.contact?.name) {
      lines.push(`- 联系人: ${info.contact.name}`);
    }
    lines.push('');
  }

  if (includeBrand.value && extension?.brand) {
    const logoDataUrl = toLogoDataUrl(extension.brand.logo);
    lines.push('## 品牌信息', '', `- 标题: ${extension.brand.title || '-'}`);
    if (logoDataUrl) {
      lines.push(`![Logo](${logoDataUrl})`, '');
    }
    if (extension.brand.footerText) {
      lines.push(`- Footer: ${extension.brand.footerText}`);
    }
    lines.push('');
  }

  if (includeMarkdownDocs.value && Array.isArray(extension?.markdown)) {
    extension.markdown.forEach((item: any) => {
      lines.push(
        `## 扩展文档 - ${item.displayName || item.filename}`,
        '',
        item.content || '',
        '',
      );
    });
  }

  return lines.join('\n');
}

function buildExportHtml(markdownContent: string, title: string) {
  const htmlBody = md.render(markdownContent);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    body { font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; max-width: 980px; margin: 0 auto; padding: 24px; line-height: 1.7; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; }
    th, td { border: 1px solid #dcdfe6; padding: 8px; text-align: left; vertical-align: top; }
    h1, h2, h3 { margin-top: 24px; }
    code { background: #f2f3f5; padding: 2px 4px; border-radius: 4px; }
  </style>
</head>
<body>${htmlBody}</body>
</html>`;
}

function downloadFile(content: BlobPart, fileName: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function resetPreviewState() {
  previewHtml.value = '';
  previewOpenApi.value = null;
  hasPreviewGenerated.value = false;
}

async function generatePreview(silentOrEvent?: boolean | Event) {
  const silent = typeof silentOrEvent === 'boolean' ? silentOrEvent : false;
  const selectedOps = buildSelectedOperations();
  const subset = buildSubsetOpenApi(selectedOps);
  if (!subset) {
    resetPreviewState();
    if (!silent) {
      ElMessage.warning('请先选择导出范围');
    }
    return;
  }

  previewLoading.value = true;
  try {
    if (previewFormat.value === 'openapi') {
      previewOpenApi.value = subset;
      previewHtml.value = '';
      hasPreviewGenerated.value = true;
      return;
    }

    const markdownContent = buildMarkdownDocument(subset, selectedOps);
    previewHtml.value = md.render(markdownContent);
    previewOpenApi.value = null;
    hasPreviewGenerated.value = true;
  } finally {
    previewLoading.value = false;
  }
}

function exportDocument() {
  const selectedOps = buildSelectedOperations();
  const subset = buildSubsetOpenApi(selectedOps);
  if (!subset) {
    ElMessage.warning('请先选择导出范围');
    return;
  }

  const title = subset.info?.title || 'api-doc';
  const markdownContent = buildMarkdownDocument(subset, selectedOps);
  const htmlContent = buildExportHtml(markdownContent, title);

  switch (exportFormat.value) {
    case 'doc': {
      downloadFile(htmlContent, `${title}.doc`, 'application/msword');
      break;
    }
    case 'html': {
      downloadFile(htmlContent, `${title}.html`, 'text/html;charset=utf-8');
      break;
    }
    case 'markdown': {
      downloadFile(
        markdownContent,
        `${title}.md`,
        'text/markdown;charset=utf-8',
      );
      break;
    }
    case 'openapi.json': {
      downloadFile(
        JSON.stringify(subset, null, 2),
        `${title}.openapi.json`,
        'application/json;charset=utf-8',
      );
      break;
    }
    case 'pdf': {
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        ElMessage.warning('浏览器拦截了弹窗，请允许后重试');
        return;
      }
      printWindow.document.open();
      printWindow.document.write(htmlContent);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
      ElMessage.success('已打开打印窗口，请选择“另存为 PDF”');
      break;
    }
  }
}

async function handlePreviewCommand(command: PreviewFormat) {
  previewFormat.value = command;
  await generatePreview(true);
}

function handleExportCommand(command: ExportFormat) {
  exportFormat.value = command;
  exportDocument();
}

function toggleThemeSwitchingState() {
  themeSwitching.value = true;
  if (themeSwitchTimer) {
    window.clearTimeout(themeSwitchTimer);
  }
  themeSwitchTimer = window.setTimeout(() => {
    themeSwitching.value = false;
    themeSwitchTimer = null;
  }, 220);
}

watch(
  () => isAggregation.value,
  async (value) => {
    selectedServiceUrl.value = value ? currentService.value?.url || '' : '';
    await loadDocContext();
  },
  { immediate: true },
);

watch(
  () => currentService.value?.url,
  (serviceUrl) => {
    if (isAggregation.value && !selectedServiceUrl.value) {
      selectedServiceUrl.value = serviceUrl || '';
    }
  },
);

watch(selectedServiceUrl, async () => {
  if (isAggregation.value) {
    await loadDocContext();
  }
});

watch(
  () => preferences.theme.mode,
  () => {
    toggleThemeSwitchingState();
  },
);

onBeforeUnmount(() => {
  if (themeSwitchTimer) {
    window.clearTimeout(themeSwitchTimer);
    themeSwitchTimer = null;
  }
});
</script>

<template>
  <div
    class="doc-export-page h-full overflow-auto p-5"
    :class="[{ 'theme-switching': themeSwitching }]"
  >
    <ElRow :gutter="16">
      <ElCol :span="10">
        <ElCard shadow="never" class="mb-4">
          <template #header>
            <span class="font-medium">导出范围选择</span>
          </template>

          <ElSkeleton v-if="loading" :rows="6" animated />
          <template v-else>
            <ElForm label-width="90px">
              <ElFormItem v-if="isAggregation" label="目标服务">
                <ElSelect v-model="selectedServiceUrl" style="width: 100%">
                  <ElOption
                    v-for="service in serviceOptions"
                    :key="service.value"
                    :label="service.label"
                    :value="service.value"
                    :disabled="service.disabled"
                  />
                </ElSelect>
              </ElFormItem>

              <ElFormItem label="导出范围">
                <ElRadioGroup v-model="scopeMode">
                  <ElRadio value="all">全部文档</ElRadio>
                  <ElRadio value="groups">分组文档</ElRadio>
                  <ElRadio value="operations">指定接口</ElRadio>
                </ElRadioGroup>
              </ElFormItem>
            </ElForm>

            <ElAlert class="mb-3" type="info" :closable="false">
              <template #default>{{ summaryText }}</template>
            </ElAlert>

            <div
              v-if="scopeMode === 'groups'"
              class="max-h-[360px] overflow-auto"
            >
              <ElCheckboxGroup v-model="selectedGroups">
                <div class="flex flex-col gap-2">
                  <ElCheckbox
                    v-for="item in groupDocs"
                    :key="item.code"
                    :value="item.code"
                  >
                    {{ item.name }}（{{ item.code }}）
                  </ElCheckbox>
                </div>
              </ElCheckboxGroup>
            </div>

            <template v-if="scopeMode === 'operations'">
              <div class="mb-2 flex gap-2">
                <ElInput
                  v-model.trim="operationKeyword"
                  placeholder="搜索 path / summary / operationId"
                  clearable
                />
                <ElSelect v-model="operationMethod" style="width: 120px">
                  <ElOption label="全部方法" value="all" />
                  <ElOption label="GET" value="get" />
                  <ElOption label="POST" value="post" />
                  <ElOption label="PUT" value="put" />
                  <ElOption label="PATCH" value="patch" />
                  <ElOption label="DELETE" value="delete" />
                </ElSelect>
              </div>
              <div class="max-h-[360px] overflow-auto rounded border p-3">
                <ElCheckboxGroup v-model="selectedOperations">
                  <div class="flex flex-col gap-2">
                    <ElCheckbox
                      v-for="item in filteredOperations"
                      :key="item.key"
                      :value="item.key"
                    >
                      [{{ item.method.toUpperCase() }}] {{ item.path }}
                      <span class="text-[var(--el-text-color-secondary)]">
                        {{ item.summary ? ` - ${item.summary}` : '' }}
                      </span>
                    </ElCheckbox>
                  </div>
                </ElCheckboxGroup>
              </div>
            </template>
          </template>
        </ElCard>

        <ElCard shadow="never">
          <template #header>
            <span class="font-medium">导出其他</span>
          </template>

          <ElForm label-width="100px">
            <ElFormItem label="附加内容">
              <ElCheckboxGroup v-model="exportDocOptions">
                <ElCheckbox value="info">Info</ElCheckbox>
                <ElCheckbox value="brand">品牌信息</ElCheckbox>
                <ElCheckbox value="otherDocs">其他文档</ElCheckbox>
              </ElCheckboxGroup>
            </ElFormItem>
          </ElForm>
        </ElCard>
      </ElCol>

      <ElCol :span="14">
        <ElCard shadow="never" class="doc-preview-card h-full">
          <template #header>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <span class="font-medium">文档预览</span>
              <ElSpace wrap>
                <ElDropdown trigger="click" @command="handlePreviewCommand">
                  <ElButton type="primary" :loading="previewLoading">
                    预览：{{ previewFormatTextMap[previewFormat] }}
                  </ElButton>
                  <template #dropdown>
                    <ElDropdownMenu>
                      <ElDropdownItem command="markdown">
                        Markdown 预览
                      </ElDropdownItem>
                      <ElDropdownItem command="html">HTML 预览</ElDropdownItem>
                      <ElDropdownItem command="openapi">
                        OpenAPI JSON
                      </ElDropdownItem>
                    </ElDropdownMenu>
                  </template>
                </ElDropdown>

                <ElDropdown trigger="click" @command="handleExportCommand">
                  <ElButton type="success">
                    导出：{{ exportFormatTextMap[exportFormat] }}
                  </ElButton>
                  <template #dropdown>
                    <ElDropdownMenu>
                      <ElDropdownItem command="doc">Word(.doc)</ElDropdownItem>
                      <ElDropdownItem command="pdf">PDF</ElDropdownItem>
                      <ElDropdownItem command="markdown">
                        Markdown
                      </ElDropdownItem>
                      <ElDropdownItem command="html">HTML</ElDropdownItem>
                      <ElDropdownItem command="openapi.json">
                        OpenAPI JSON
                      </ElDropdownItem>
                    </ElDropdownMenu>
                  </template>
                </ElDropdown>
              </ElSpace>
            </div>
          </template>

          <ElSkeleton v-if="previewLoading" :rows="8" animated />
          <template v-else>
            <ElEmpty
              v-if="isPreviewEmpty"
              description="点击右上角“预览”下拉选择格式后查看内容"
            />
            <div
              v-else-if="previewFormat === 'openapi'"
              class="doc-preview-json max-h-[440px] overflow-auto"
            >
              <JsonView
                :data="previewOpenApi"
                language="json"
                :image-render="true"
                :loading="previewLoading"
                class="response-body max-h-[calc(100vh-280px)] overflow-auto"
              />
            </div>
            <div
              v-else
              class="doc-preview-html max-h-[calc(100vh-280px)] overflow-auto [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2"
              v-html="previewHtml"
            ></div>
          </template>
        </ElCard>
      </ElCol>
    </ElRow>
  </div>
</template>

<style scoped lang="scss">
.doc-export-page {
  :deep(.doc-preview-card .el-card__body),
  :deep(.doc-preview-html),
  :deep(.doc-preview-json) {
    contain: layout paint;
  }
}

.doc-export-page.theme-switching {
  :deep(*) {
    transition-duration: 0s !important;
    animation-duration: 0s !important;
    animation-delay: 0s !important;
  }
}
</style>
