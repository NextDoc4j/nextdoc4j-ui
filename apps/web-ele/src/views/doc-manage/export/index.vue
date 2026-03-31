<script setup lang="ts">
import type { Component } from 'vue';

import type { ServiceItem } from '#/store/aggregation';
import type { OpenAPISpec, SwaggerConfig } from '#/typings/openApi';

import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
} from 'vue';

import {
  SvgDocExportHtmlIcon,
  SvgDocExportMarkdownIcon,
  SvgDocExportOpenapiIcon,
  SvgDocExportPdfIcon,
  SvgDocExportWordIcon,
  SvgDoubleArrowDownIcon,
  SvgDoubleArrowUpIcon,
} from '@vben/icons';

import {
  Document as DocxDocument,
  HeadingLevel as DocxHeadingLevel,
  Packer as DocxPacker,
  Paragraph as DocxParagraph,
  Table as DocxTable,
  TableCell as DocxTableCell,
  TableRow as DocxTableRow,
  TextRun as DocxTextRun,
  WidthType as DocxWidthType,
} from 'docx';
import {
  ElAlert,
  ElButton,
  ElCard,
  ElCheckbox,
  ElCheckboxGroup,
  ElCol,
  ElDialog,
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
} from 'element-plus';
import MarkdownIt from 'markdown-it';
import { storeToRefs } from 'pinia';

import { useApiStore } from '#/store';
import { useAggregationStore } from '#/store/aggregation';

defineOptions({ name: 'DocManageExport' });

type ExportFormat = 'docx' | 'html' | 'markdown' | 'openapi.json' | 'pdf';
type ScopeMode = 'all' | 'custom';

interface GroupDocItem {
  code: string;
  name: string;
  openApi?: OpenAPISpec;
  url?: string;
}

interface OperationItem {
  description?: string;
  groupCode: string;
  groupName?: string;
  key: string;
  method: string;
  operationId?: string;
  path: string;
  raw: any;
  searchText: string;
  serviceName?: string;
  serviceUrl?: string;
  summary?: string;
  tags?: string[];
}

interface GroupedOperationItem {
  code: string;
  name: string;
  operations: OperationItem[];
}

interface AggregationGroupTreeNode {
  code: string;
  key: string;
  name: string;
  operations: OperationItem[];
}

interface AggregationServiceTreeNode {
  allOperations: OperationItem[];
  groups: AggregationGroupTreeNode[];
  hasGroupLevel: boolean;
  key: string;
  operations: OperationItem[];
  serviceName: string;
  serviceUrl: string;
}

interface ServiceExportDocItem {
  groups: GroupDocItem[];
  openApi: OpenAPISpec;
  service: ServiceItem;
}

interface ExportFormatOption {
  description: string;
  format: ExportFormat;
  icon: Component;
  title: string;
}

const HTTP_METHODS = new Set(['delete', 'get', 'patch', 'post', 'put']);
const PREVIEW_AUTO_DELAY = 120;
const PREVIEW_AUTO_DELAY_LARGE = 260;
const PREVIEW_MAX_OPERATION_COUNT = 200;
const PREVIEW_VIRTUAL_BLOCK_CHUNK_SIZE = 24;
const PREVIEW_VIRTUAL_BLOCK_MIN_COUNT = 24;
const PREVIEW_CHUNK_PREFETCH_COUNT = 1;
const PREVIEW_CHUNK_ROOT_MARGIN = '1100px 0px';
const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: true,
  typographer: true,
});

const apiStore = useApiStore();
const aggregationStore = useAggregationStore();
const { isAggregation, services } = storeToRefs(aggregationStore);

const loading = ref(false);
const previewLoading = ref(false);
const exportDialogVisible = ref(false);
const exportSubmitting = ref(false);

const scopeMode = ref<ScopeMode>('all');
const selectedOperations = shallowRef<string[]>([]);
const operationKeyword = ref('');
const operationMethod = ref('all');
const expandedGroups = ref<Record<string, boolean>>({});

type ExportDocOption = 'brand' | 'info' | 'otherDocs';
const exportDocOptions = ref<ExportDocOption[]>([]);
const includeInfo = computed(() => exportDocOptions.value.includes('info'));
const includeBrand = computed(() => exportDocOptions.value.includes('brand'));
const includeMarkdownDocs = computed(() =>
  exportDocOptions.value.includes('otherDocs'),
);

const exportFormat = ref<ExportFormat>('docx');
const previewHtml = ref('');
const previewChunks = shallowRef<string[]>([]);
const previewChunkPlaceholderHeights = shallowRef<number[]>([]);
const previewLoadedChunkIndexes = shallowRef<Set<number>>(new Set());
const previewVisibleChunkIndexes = shallowRef<Set<number>>(new Set());
const previewScrollRef = ref<HTMLElement | null>(null);
const previewChunkElements = shallowRef<(HTMLElement | null)[]>([]);

const currentOpenApi = shallowRef<null | OpenAPISpec>(null);
const currentSwaggerConfig = shallowRef<null | SwaggerConfig>(null);
const groupDocs = shallowRef<GroupDocItem[]>([]);
const operations = shallowRef<OperationItem[]>([]);
const aggregationGatewayOpenApi = shallowRef<null | OpenAPISpec>(null);
const aggregationServiceDocs = shallowRef<ServiceExportDocItem[]>([]);
let previewAutoTimer: null | number = null;
let previewGenerationToken = 0;
let previewChunkObserver: IntersectionObserver | null = null;
let previewChunkMeasureFrame: null | number = null;

const filteredOperations = computed(() => {
  const keyword = operationKeyword.value.trim().toLowerCase();
  const method = operationMethod.value;
  if (!keyword && method === 'all') {
    return operations.value;
  }
  return operations.value.filter((item) => {
    const passMethod = method === 'all' || item.method === method;
    const passKeyword = !keyword || item.searchText.includes(keyword);
    return passMethod && passKeyword;
  });
});

const groupedFilteredOperations = computed<GroupedOperationItem[]>(() => {
  if (isAggregation.value) {
    return [];
  }
  const map = new Map<string, GroupedOperationItem>();
  filteredOperations.value.forEach((item) => {
    if (!map.has(item.groupCode)) {
      map.set(item.groupCode, {
        code: item.groupCode,
        name: item.groupName || getGroupTitle(item.groupCode),
        operations: [],
      });
    }
    map.get(item.groupCode)!.operations.push(item);
  });

  return [...map.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'zh-CN'),
  );
});

const aggregationServiceTree = computed<AggregationServiceTreeNode[]>(() => {
  if (!isAggregation.value) {
    return [];
  }

  const serviceMap = new Map<
    string,
    {
      groupMap: Map<string, AggregationGroupTreeNode>;
      serviceName: string;
      serviceUrl: string;
    }
  >();

  filteredOperations.value.forEach((item) => {
    const serviceUrl = item.serviceUrl || '__aggregation__';
    const serviceName = item.serviceName || '微服务';
    if (!serviceMap.has(serviceUrl)) {
      serviceMap.set(serviceUrl, {
        serviceUrl,
        serviceName,
        groupMap: new Map(),
      });
    }

    const target = serviceMap.get(serviceUrl)!;
    const groupCode = item.groupCode || 'all';
    if (!target.groupMap.has(groupCode)) {
      target.groupMap.set(groupCode, {
        code: groupCode,
        key: getGroupNodeKey(serviceUrl, groupCode),
        name: item.groupName || getGroupTitle(groupCode, serviceUrl),
        operations: [],
      });
    }
    target.groupMap.get(groupCode)!.operations.push(item);
  });

  return [...serviceMap.values()]
    .map((serviceNode) => {
      const groups = [...serviceNode.groupMap.values()].sort((a, b) =>
        a.name.localeCompare(b.name, 'zh-CN'),
      );
      const nonAllGroups = groups.filter((group) => group.code !== 'all');
      const hasGroupLevel = nonAllGroups.length > 0;
      const directOperations = hasGroupLevel
        ? []
        : (serviceNode.groupMap.get('all')?.operations || []).sort((a, b) =>
            `${a.path}::${a.method}`.localeCompare(`${b.path}::${b.method}`),
          );
      const allOperations = hasGroupLevel
        ? nonAllGroups
            .flatMap((group) => group.operations)
            .sort((a, b) =>
              `${a.path}::${a.method}`.localeCompare(`${b.path}::${b.method}`),
            )
        : directOperations;

      return {
        allOperations,
        serviceUrl: serviceNode.serviceUrl,
        serviceName: serviceNode.serviceName,
        hasGroupLevel,
        groups: hasGroupLevel ? nonAllGroups : [],
        key: getServiceNodeKey(serviceNode.serviceUrl),
        operations: directOperations,
      };
    })
    .sort((a, b) => a.serviceName.localeCompare(b.serviceName, 'zh-CN'));
});

const selectedOperationItems = computed(() => {
  const selectedKeys = new Set(selectedOperations.value);
  return operations.value.filter((item) => selectedKeys.has(item.key));
});

const selectedOperationSet = computed(() => new Set(selectedOperations.value));
const selectedCountByNodeKey = computed(() => {
  const counts = new Map<string, number>();
  const selected = selectedOperationSet.value;
  if (selected.size <= 0) {
    return counts;
  }

  filteredOperations.value.forEach((item) => {
    if (!selected.has(item.key)) {
      return;
    }

    if (isAggregation.value) {
      const serviceKey = getServiceNodeKey(
        item.serviceUrl || '__aggregation__',
      );
      counts.set(serviceKey, (counts.get(serviceKey) || 0) + 1);

      const groupKey = getGroupNodeKey(
        item.serviceUrl || '__aggregation__',
        item.groupCode || 'all',
      );
      counts.set(groupKey, (counts.get(groupKey) || 0) + 1);
      return;
    }

    const groupKey = item.groupCode || 'all';
    counts.set(groupKey, (counts.get(groupKey) || 0) + 1);
  });

  return counts;
});
const previewSelectionState = computed(() => {
  const total =
    scopeMode.value === 'all'
      ? operations.value.length
      : selectedOperationItems.value.length;
  const limited = total > PREVIEW_MAX_OPERATION_COUNT;
  return {
    limited,
    previewCount: limited ? PREVIEW_MAX_OPERATION_COUNT : total,
    total,
  };
});
const previewNoticeText = computed(() => {
  if (!previewSelectionState.value.limited) {
    return '';
  }
  return `当前已选择 ${previewSelectionState.value.total} 个接口，为保证页面流畅，仅预览前 ${PREVIEW_MAX_OPERATION_COUNT} 个接口，导出仍会包含全部已选接口。`;
});
const activeExportOption = computed<ExportFormatOption>(() => {
  return (
    exportFormatOptions.find((item) => item.format === exportFormat.value) ||
    exportFormatOptions[0]!
  );
});

const summaryText = computed(() => {
  const base = currentOpenApi.value;
  if (!base) return '暂无可导出文档数据';

  const totalOps = operations.value.length;
  const totalGroups = isAggregation.value
    ? new Set(
        operations.value.map((item) => item.serviceUrl || '__aggregation__'),
      ).size
    : new Set(operations.value.map((item) => item.groupCode)).size;
  if (scopeMode.value === 'all') {
    return isAggregation.value
      ? `当前将导出全部接口，共 ${totalOps} 个，微服务 ${totalGroups} 个`
      : `当前将导出全部接口，共 ${totalOps} 个，分组 ${totalGroups} 个`;
  }
  return isAggregation.value
    ? `当前已选择接口 ${selectedOperationItems.value.length} 个（可按微服务/分组勾选部分接口）`
    : `当前已选择接口 ${selectedOperationItems.value.length} 个（可按分组勾选部分接口）`;
});

const isPreviewEmpty = computed(
  () => !previewHtml.value && previewChunks.value.length <= 0,
);
const exportFormatTextMap: Record<ExportFormat, string> = {
  docx: 'Word(.docx)',
  pdf: 'PDF',
  markdown: 'Markdown',
  html: 'HTML',
  'openapi.json': 'OpenAPI JSON',
};
const exportFormatOptions: ExportFormatOption[] = [
  {
    format: 'docx',
    title: 'Word 文档',
    description: '适合发送、归档和继续编辑，保留清晰的章节结构。',
    icon: SvgDocExportWordIcon,
  },
  {
    format: 'pdf',
    title: 'PDF',
    description: '适合打印和正式交付，导出后可直接另存为 PDF。',
    icon: SvgDocExportPdfIcon,
  },
  {
    format: 'markdown',
    title: 'Markdown',
    description: '适合纳入代码仓库、继续改写或二次加工。',
    icon: SvgDocExportMarkdownIcon,
  },
  {
    format: 'html',
    title: 'HTML',
    description: '适合浏览器查看与网页分发，结构完整、打开直接可读。',
    icon: SvgDocExportHtmlIcon,
  },
  {
    format: 'openapi.json',
    title: 'OpenAPI JSON',
    description: '适合导入其他工具链，继续测试、生成 SDK 或同步文档。',
    icon: SvgDocExportOpenapiIcon,
  },
];

function parseGroupCode(url: string) {
  const segments = url.split('/');
  return segments[segments.length - 1] || 'default';
}

function getOperationKey(
  serviceUrl: string,
  groupCode: string,
  method: string,
  path: string,
  operationId?: string,
) {
  return `${serviceUrl}::${groupCode}::${method}::${path}::${operationId || ''}`;
}

function buildOperationSearchText(item: {
  description?: string;
  groupName?: string;
  operationId?: string;
  path: string;
  serviceName?: string;
  summary?: string;
  tags?: string[];
}) {
  return [
    item.serviceName,
    item.groupName,
    item.path,
    item.summary,
    item.description,
    item.operationId,
    (item.tags || []).join(' '),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function getServiceNodeKey(serviceUrl: string) {
  return `service::${serviceUrl}`;
}

function getGroupNodeKey(serviceUrl: string, groupCode: string) {
  return `${getServiceNodeKey(serviceUrl)}::group::${groupCode}`;
}

function isPlainObject(value: unknown): value is Record<string, any> {
  if (Object.prototype.toString.call(value) !== '[object Object]') {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

function sanitizeCloneValue(value: any, seen = new WeakMap<object, any>()) {
  if (value === null) return null;

  const valueType = typeof value;
  if (
    valueType === 'boolean' ||
    valueType === 'number' ||
    valueType === 'string'
  ) {
    return value;
  }
  if (valueType === 'bigint') {
    return Number(value);
  }
  if (
    valueType === 'function' ||
    valueType === 'symbol' ||
    valueType === 'undefined'
  ) {
    return undefined;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return seen.get(value);
    }
    const arrayResult: any[] = [];
    seen.set(value, arrayResult);
    value.forEach((item) => {
      const normalized = sanitizeCloneValue(item, seen);
      arrayResult.push(normalized === undefined ? null : normalized);
    });
    return arrayResult;
  }

  if (value instanceof Date) {
    return new Date(value);
  }
  if (value instanceof RegExp) {
    return new RegExp(value.source, value.flags);
  }

  if (!value || valueType !== 'object') {
    return undefined;
  }

  if (seen.has(value)) {
    return seen.get(value);
  }

  if (!isPlainObject(value)) {
    try {
      return structuredClone(value);
    } catch {
      return undefined;
    }
  }

  const objectResult: Record<string, any> = {};
  seen.set(value, objectResult);
  Object.entries(value).forEach(([key, nestedValue]) => {
    const normalized = sanitizeCloneValue(nestedValue, seen);
    if (normalized !== undefined) {
      objectResult[key] = normalized;
    }
  });
  return objectResult;
}

function cloneOpenApi(data: any) {
  try {
    return structuredClone(data);
  } catch {
    return sanitizeCloneValue(data);
  }
}

function collectOperationsFromPaths(
  paths: Record<string, any>,
  options:
    | string
    | {
        groupCode: string;
        groupName?: string;
        serviceName?: string;
        serviceUrl?: string;
      },
): OperationItem[] {
  const normalizedOptions =
    typeof options === 'string' ? { groupCode: options } : options;
  const serviceUrl = normalizedOptions.serviceUrl || '__single__';
  const serviceName = normalizedOptions.serviceName || '当前文档';
  const groupCode = normalizedOptions.groupCode;
  const groupName = normalizedOptions.groupName || groupCode;
  const result: OperationItem[] = [];

  Object.entries(paths || {}).forEach(([path, methodConfig]) => {
    Object.entries(methodConfig || {}).forEach(([method, rawData]) => {
      const raw = rawData as any;
      const methodName = method.toLowerCase();
      if (!HTTP_METHODS.has(methodName)) {
        return;
      }
      result.push({
        key: getOperationKey(
          serviceUrl,
          groupCode,
          methodName,
          path,
          raw?.operationId,
        ),
        groupCode,
        groupName,
        method: methodName,
        path,
        serviceName,
        serviceUrl,
        summary: raw?.summary,
        description: raw?.description,
        operationId: raw?.operationId,
        searchText: buildOperationSearchText({
          groupName,
          path,
          serviceName,
          summary: raw?.summary,
          description: raw?.description,
          operationId: raw?.operationId,
          tags: raw?.tags ?? [],
        }),
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

function collectSchemaRefsFromValue(value: any, refs: Set<string>) {
  if (!value) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectSchemaRefsFromValue(item, refs));
    return;
  }
  if (typeof value !== 'object') {
    return;
  }

  const currentRef = (value as any).$ref;
  if (
    typeof currentRef === 'string' &&
    currentRef.startsWith('#/components/schemas/')
  ) {
    const refName = parseSchemaRef(currentRef);
    if (refName) {
      refs.add(refName);
    }
  }

  Object.values(value).forEach((child) => {
    collectSchemaRefsFromValue(child, refs);
  });
}

function collectDependentSchemaRefs(
  schemaName: string,
  allSchemas: Record<string, any>,
  result: Set<string>,
  visiting = new Set<string>(),
) {
  if (!schemaName || result.has(schemaName) || visiting.has(schemaName)) {
    return;
  }
  result.add(schemaName);

  const source = allSchemas[schemaName];
  if (!source) {
    return;
  }

  const nextVisiting = new Set(visiting);
  nextVisiting.add(schemaName);

  const childRefs = new Set<string>();
  collectSchemaRefsFromValue(source, childRefs);
  childRefs.forEach((childSchemaName) => {
    collectDependentSchemaRefs(
      childSchemaName,
      allSchemas,
      result,
      nextVisiting,
    );
  });
}

function filterComponentsBySelectedPaths(
  selectedPaths: Record<string, Record<string, any>>,
  components: any,
) {
  const allSchemas = components?.schemas || {};
  const referencedSchemaNames = new Set<string>();
  collectSchemaRefsFromValue(selectedPaths, referencedSchemaNames);

  const relatedSchemaNames = new Set<string>();
  referencedSchemaNames.forEach((schemaName) => {
    collectDependentSchemaRefs(schemaName, allSchemas, relatedSchemaNames);
  });

  const filteredSchemas: Record<string, any> = {};
  relatedSchemaNames.forEach((schemaName) => {
    const schema = allSchemas[schemaName];
    if (schema) {
      filteredSchemas[schemaName] = schema;
    }
  });

  return {
    ...(Object.keys(filteredSchemas).length > 0
      ? { schemas: filteredSchemas }
      : {}),
    ...(Object.keys(components?.securitySchemes || {}).length > 0
      ? { securitySchemes: components.securitySchemes }
      : {}),
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

function formatExampleValue(value: any) {
  if (value === undefined || value === null || value === '') {
    return '-';
  }
  if (
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return `${value}`;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return `${value}`;
  }
}

function toMarkdownCell(value: any) {
  const text = `${value ?? ''}`.trim();
  if (!text) {
    return '-';
  }
  return text.replaceAll('|', String.raw`\|`).replaceAll('\n', '<br/>');
}

function mergeDescriptionWithEnum(description: string, schema?: any) {
  const base = `${description || ''}`.trim();
  const enumText = getEnumDescription(schema);
  if (base && enumText) {
    return `${base}<br/>可选值: ${enumText}`;
  }
  if (enumText) {
    return `可选值: ${enumText}`;
  }
  return base || '-';
}

function normalizeSecurityMetadata(raw: any) {
  const security = raw?.['x-nextdoc4j-security'];
  if (!security) {
    return null;
  }
  if (security.ignore) {
    return {
      ignore: true,
      permissions: [] as string[],
      roles: [] as string[],
    };
  }

  const roleParts: string[] = [];
  const permissionParts: string[] = [];
  const getJoiner = (mode: any) =>
    `${mode}`.toUpperCase() === 'AND' ? ' & ' : ' | ';
  const appendValues = (target: string[], values: any, mode: any = 'OR') => {
    if (!Array.isArray(values)) {
      return;
    }
    const normalized = values
      .map((item) => `${item ?? ''}`.trim())
      .filter(Boolean);
    if (normalized.length <= 0) {
      return;
    }
    target.push(normalized.join(getJoiner(mode)));
  };

  (security.roles || []).forEach((item: any) => {
    appendValues(roleParts, item?.values, item?.mode);
  });

  (security.permissions || []).forEach((item: any) => {
    const type = `${item?.type || ''}`.toLowerCase();
    if (type === 'role') {
      appendValues(roleParts, item?.values, item?.mode);
    } else {
      appendValues(permissionParts, item?.values, item?.mode);
    }

    const orType = `${item?.orType || ''}`.toLowerCase();
    if (orType === 'role') {
      appendValues(roleParts, item?.orValues, 'OR');
    } else if (orType === 'permission') {
      appendValues(permissionParts, item?.orValues, 'OR');
    }
  });

  return {
    ignore: false,
    permissions: [...new Set(permissionParts)],
    roles: [...new Set(roleParts)],
  };
}

function resolveOperationSecurity(raw: any) {
  if (Array.isArray(raw?.security)) {
    return raw.security;
  }
  return [];
}

function hasSecuritySchemes(requirements: any[]) {
  return requirements.some((requirement) =>
    Object.keys(requirement || {})
      .map((key) => `${key || ''}`.trim())
      .some(Boolean),
  );
}

type SecuritySchemeRow = {
  description: string;
  in: string;
  parameterName: string;
  scheme: string;
  schemeName: string;
  type: string;
};

function buildSecuritySchemeRows(
  requirements: any[],
  doc: OpenAPISpec,
): SecuritySchemeRow[] {
  const schemeNameSet = new Set<string>();

  requirements.forEach((requirement) => {
    Object.keys(requirement || {}).forEach((schemeName) => {
      const normalizedSchemeName = `${schemeName || ''}`.trim();
      if (normalizedSchemeName) {
        schemeNameSet.add(normalizedSchemeName);
      }
    });
  });

  return [...schemeNameSet.values()].map((schemeName) => {
    const scheme = (doc.components?.securitySchemes?.[schemeName] ||
      {}) as Record<string, any>;
    const normalizedScheme = `${scheme?.scheme || '-'}`.trim();
    const schemeText =
      normalizedScheme === '-' || !normalizedScheme
        ? '-'
        : `${normalizedScheme.slice(0, 1).toUpperCase()}${normalizedScheme.slice(1)}`;

    return {
      schemeName,
      type: scheme?.type || '-',
      in: scheme?.in || '-',
      parameterName: scheme?.name || '-',
      scheme: schemeText,
      description: scheme?.description || '-',
    };
  });
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

const SCHEMA_REF_MARKER = '__docExportSchemaRefName';

function appendSchemaSeen(schema: any, seen: Set<string>) {
  const refName =
    schema?.[SCHEMA_REF_MARKER] ||
    (schema?.$ref ? parseSchemaRef(schema.$ref) : '');
  if (!refName || seen.has(refName)) {
    return seen;
  }

  const nextSeen = new Set(seen);
  nextSeen.add(refName);
  return nextSeen;
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
      [SCHEMA_REF_MARKER]: refName,
      description: schema.description || '',
      title: refName || schema.$ref,
      type: 'object',
    };
  }

  const source = doc.components?.schemas?.[refName];
  if (!source) {
    return {
      [SCHEMA_REF_MARKER]: refName,
      description: schema.description || '',
      title: refName,
      type: 'object',
    };
  }

  const nextSeen = new Set(seen);
  nextSeen.add(refName);
  const resolved = resolveSchemaRef(source, doc, nextSeen);
  return {
    ...schema,
    ...resolved,
    [SCHEMA_REF_MARKER]: refName,
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
  const nextSeen = appendSchemaSeen(schema, seen);
  const resolvedRef = resolveSchemaRef(schema, doc, seen);
  if (!resolvedRef) return null;

  if (resolvedRef.allOf?.length) {
    return mergeAllOf(resolvedRef, doc, nextSeen);
  }

  if (resolvedRef.oneOf?.length) {
    return normalizeSchema(resolvedRef.oneOf[0], doc, nextSeen);
  }

  if (resolvedRef.anyOf?.length) {
    return normalizeSchema(resolvedRef.anyOf[0], doc, nextSeen);
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
  example: string;
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
  seen = new Set<string>(),
): SchemaFieldRow[] {
  const normalized = normalizeSchema(schema, doc, seen);
  if (!normalized) return [];

  const nextSeen = appendSchemaSeen(schema, seen);
  const rows: SchemaFieldRow[] = [];

  if (normalized.type === 'array') {
    const itemSchema = normalizeSchema(normalized.items, doc, nextSeen);
    const arrayPath = parentPath ? `${parentPath}[]` : '[]';
    rows.push({
      name: arrayPath,
      type: schemaTypeText(itemSchema, doc),
      required: true,
      description: mergeDescriptionWithEnum(
        itemSchema?.description || '',
        itemSchema,
      ),
      example: formatExampleValue(itemSchema?.example),
    });

    if (itemSchema?.type === 'object' || itemSchema?.properties) {
      rows.push(
        ...collectSchemaFields(
          normalized.items || itemSchema,
          doc,
          arrayPath,
          nextSeen,
        ),
      );
    }
    return rows;
  }

  if (normalized.type === 'object' || normalized.properties) {
    const requiredSet = new Set<string>(normalized.required || []);
    Object.entries(normalized.properties || {}).forEach(([key, raw]) => {
      const field = normalizeSchema(raw, doc, nextSeen);
      const path = parentPath ? `${parentPath}.${key}` : key;
      rows.push({
        name: path,
        type: schemaTypeText(field, doc),
        required: requiredSet.has(key),
        description: mergeDescriptionWithEnum(field?.description || '', field),
        example: formatExampleValue(field?.example),
      });

      if (field?.type === 'object' || field?.properties) {
        rows.push(...collectSchemaFields(raw || field, doc, path, nextSeen));
      } else if (field?.type === 'array') {
        rows.push(...collectSchemaFields(raw || field, doc, path, nextSeen));
      }
    });
    return rows;
  }

  rows.push({
    name: parentPath || '(root)',
    type: schemaTypeText(normalized, doc),
    required: true,
    description: mergeDescriptionWithEnum(
      normalized.description || '',
      normalized,
    ),
    example: formatExampleValue(normalized?.example),
  });

  return rows;
}

function extractSchemaVariants(
  schema: any,
  doc: OpenAPISpec,
  seen = new Set<string>(),
): any[] {
  const nextSeen = appendSchemaSeen(schema, seen);
  const resolved = resolveSchemaRef(schema, doc, seen);
  if (!resolved) {
    return [];
  }

  if (resolved.oneOf?.length) {
    return resolved.oneOf.flatMap((item: any) =>
      extractSchemaVariants(item, doc, new Set(nextSeen)),
    );
  }

  if (resolved.anyOf?.length) {
    return resolved.anyOf.flatMap((item: any) =>
      extractSchemaVariants(item, doc, new Set(nextSeen)),
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

async function loadGroupDocsForService(
  service: ServiceItem,
  config: SwaggerConfig,
) {
  const urls = config.urls || [];
  const docs: GroupDocItem[] = [];

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

  return docs;
}

function rebuildOperations(useCachedGrouping = false) {
  const map = new Map<string, OperationItem>();

  if (isAggregation.value) {
    aggregationServiceDocs.value.forEach((serviceDoc) => {
      const hasGroups = serviceDoc.groups.length > 0;
      if (hasGroups) {
        serviceDoc.groups.forEach((group) => {
          collectOperationsFromPaths(group.openApi?.paths || {}, {
            groupCode: group.code,
            groupName: group.name,
            serviceUrl: serviceDoc.service.url,
            serviceName: serviceDoc.service.name,
          }).forEach((item) => {
            map.set(item.key, item);
          });
        });
        return;
      }

      collectOperationsFromPaths(serviceDoc.openApi?.paths || {}, {
        groupCode: 'all',
        groupName: '所有接口',
        serviceUrl: serviceDoc.service.url,
        serviceName: serviceDoc.service.name,
      }).forEach((item) => {
        map.set(item.key, item);
      });
    });

    operations.value = [...map.values()].sort((a, b) => {
      return `${a.serviceName || ''}::${a.groupName || ''}::${a.path}::${a.method}`.localeCompare(
        `${b.serviceName || ''}::${b.groupName || ''}::${b.path}::${b.method}`,
        'zh-CN',
      );
    });

    selectedOperations.value = [];
    expandedGroups.value = {};
    return;
  }

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
              '__single__',
              groupCode,
              methodName,
              api.path,
              source?.operationId,
            ),
            {
              key: getOperationKey(
                '__single__',
                groupCode,
                methodName,
                api.path,
                source?.operationId,
              ),
              groupCode,
              groupName: getGroupTitle(groupCode),
              method: methodName,
              path: api.path,
              serviceName: currentOpenApi.value?.info?.title || '当前文档',
              serviceUrl: '__single__',
              summary: source?.summary,
              description: source?.description,
              operationId: source?.operationId,
              searchText: buildOperationSearchText({
                groupName: getGroupTitle(groupCode),
                path: api.path,
                serviceName: currentOpenApi.value?.info?.title || '当前文档',
                summary: source?.summary,
                description: source?.description,
                operationId: source?.operationId,
                tags: source?.tags ?? api?.tags ?? [],
              }),
              tags: source?.tags ?? api?.tags ?? [],
              raw: source,
            },
          );
        });
      });
    });
  }

  if (!useCachedGrouping || map.size <= 0) {
    collectOperationsFromPaths(currentOpenApi.value?.paths || {}, {
      groupCode: 'all',
      groupName: '所有接口',
      serviceUrl: '__single__',
      serviceName: currentOpenApi.value?.info?.title || '当前文档',
    }).forEach((item) => {
      map.set(item.key, item);
    });
  }

  groupDocs.value.forEach((group) => {
    collectOperationsFromPaths(group.openApi?.paths || {}, {
      groupCode: group.code,
      groupName: group.name,
      serviceUrl: '__single__',
      serviceName: currentOpenApi.value?.info?.title || '当前文档',
    }).forEach((item) => {
      map.set(item.key, item);
    });
  });

  operations.value = [...map.values()].sort((a, b) => {
    return `${a.groupCode}${a.path}${a.method}`.localeCompare(
      `${b.groupCode}${b.path}${b.method}`,
      'zh-CN',
    );
  });

  selectedOperations.value = [];
  expandedGroups.value = {};
}

async function loadDocContext() {
  loading.value = true;
  previewGenerationToken += 1;
  resetPreviewState();
  try {
    aggregationServiceDocs.value = [];
    aggregationGatewayOpenApi.value = null;

    if (isAggregation.value) {
      const availableServices = services.value.filter((item) => !item.disabled);
      if (availableServices.length <= 0) {
        currentOpenApi.value = null;
        currentSwaggerConfig.value = null;
        groupDocs.value = [];
        operations.value = [];
        ElMessage.warning('未找到可用微服务，请检查网关聚合配置');
        return;
      }

      const mainConfig = await aggregationStore.getMainConfig();
      aggregationGatewayOpenApi.value = mainConfig.openApi;
      currentSwaggerConfig.value = mainConfig.config;

      const serviceResults = await Promise.allSettled(
        availableServices.map(async (service) => {
          const serviceData = await aggregationStore.getServiceData(service);
          const groups = await loadGroupDocsForService(
            service,
            serviceData.config,
          );
          return {
            service,
            openApi: serviceData.openApi,
            groups,
          } satisfies ServiceExportDocItem;
        }),
      );

      const successResults = serviceResults.filter(
        (item): item is PromiseFulfilledResult<ServiceExportDocItem> =>
          item.status === 'fulfilled',
      );
      const failedCount = serviceResults.length - successResults.length;

      aggregationServiceDocs.value = successResults
        .filter(
          (item) => !item.value.service.disabled && !!item.value.openApi?.paths,
        )
        .map((item) => item.value);

      if (aggregationServiceDocs.value.length <= 0) {
        currentOpenApi.value = null;
        groupDocs.value = [];
        operations.value = [];
        ElMessage.warning('未能加载任何微服务文档数据');
        return;
      }

      currentOpenApi.value = aggregationGatewayOpenApi.value;
      groupDocs.value = [];
      rebuildOperations();
      if (failedCount > 0) {
        ElMessage.warning(
          `有 ${failedCount} 个微服务文档加载失败，已按可用微服务继续导出`,
        );
      }
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
    scheduleAutoPreview();
  }
}

function buildSelectedOperations() {
  if (scopeMode.value === 'all') {
    return operations.value;
  }
  const selected = new Set(selectedOperations.value);
  return operations.value.filter((item) => selected.has(item.key));
}

function buildSubsetOpenApi(selectedOpsInput?: OperationItem[]) {
  const selectedOps = selectedOpsInput ?? buildSelectedOperations();
  if (selectedOps.length <= 0) {
    return null;
  }

  const baseDoc = isAggregation.value
    ? aggregationGatewayOpenApi.value
    : currentOpenApi.value;
  if (!baseDoc) {
    return null;
  }

  const selectedPaths: Record<string, Record<string, any>> = {};
  selectedOps.forEach((item) => {
    if (!selectedPaths[item.path]) {
      selectedPaths[item.path] = {};
    }
    selectedPaths[item.path]![item.method] = cloneOpenApi(item.raw);
  });

  const docsForComponents: OpenAPISpec[] = [baseDoc];
  if (isAggregation.value) {
    const selectedServices = new Set(
      selectedOps.map((item) => item.serviceUrl).filter(Boolean),
    );
    aggregationServiceDocs.value.forEach((item) => {
      if (!selectedServices.has(item.service.url)) {
        return;
      }
      docsForComponents.push(item.openApi);
      item.groups.forEach((group) => {
        if (group.openApi) {
          docsForComponents.push(group.openApi);
        }
      });
    });
  } else {
    groupDocs.value.forEach((item) => {
      if (item.openApi) {
        docsForComponents.push(item.openApi);
      }
    });
  }

  const uniqueDocsForComponents = [...new Set(docsForComponents)];
  const baseInfo = baseDoc.info;
  const info = includeInfo.value
    ? cloneOpenApi(baseInfo)
    : {
        title: baseInfo?.title || 'API 文档',
        version: baseInfo?.version || '1.0.0',
      };

  const xNextDoc = cloneOpenApi(baseDoc['x-nextdoc4j'] || {});
  if (!includeBrand.value) {
    delete xNextDoc.brand;
  }
  if (!includeMarkdownDocs.value) {
    delete xNextDoc.markdown;
  }

  const mergedComponents = mergeComponents(uniqueDocsForComponents);
  const filteredComponents = filterComponentsBySelectedPaths(
    selectedPaths,
    mergedComponents,
  );

  const subset: any = {
    openapi: baseDoc.openapi,
    info,
    servers: cloneOpenApi(baseDoc.servers || []),
    paths: selectedPaths,
    components: filteredComponents,
  };

  if (baseDoc.security) {
    subset.security = cloneOpenApi(baseDoc.security);
  }
  if (Object.keys(xNextDoc).length > 0) {
    subset['x-nextdoc4j'] = xNextDoc;
  }
  if (baseDoc['x-nextdoc4j-aggregation']) {
    subset['x-nextdoc4j-aggregation'] = cloneOpenApi(
      baseDoc['x-nextdoc4j-aggregation'],
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
    '| 字段 | 类型 | 必填 | 说明 | 示例值 |',
    '| --- | --- | --- | --- | --- |',
  );
  rows.forEach((row) => {
    lines.push(
      `| ${toMarkdownCell(toDisplayFieldName(row.name))} | ${toMarkdownCell(row.type || '-')} | ${row.required ? '是' : '否'} | ${toMarkdownCell(row.description || '-')} | ${toMarkdownCell(row.example || '-')} |`,
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

type ParameterRow = {
  description: string;
  example: string;
  name: string;
  required: boolean;
  type: string;
};

const PARAM_LOCATION_TEXT: Record<string, string> = {
  cookie: 'Cookie 参数',
  header: '请求头参数',
  path: '路径参数',
  query: '查询参数',
};

function appendParameterRows(lines: string[], rows: ParameterRow[]) {
  if (rows.length <= 0) {
    lines.push('- 暂无参数', '');
    return;
  }

  lines.push(
    '| 字段 | 类型 | 必填 | 说明 | 示例值 |',
    '| --- | --- | --- | --- | --- |',
  );
  rows.forEach((row) => {
    lines.push(
      `| ${toMarkdownCell(row.name)} | ${toMarkdownCell(row.type || '-')} | ${row.required ? '是' : '否'} | ${toMarkdownCell(row.description || '-')} | ${toMarkdownCell(row.example || '-')} |`,
    );
  });
  lines.push('');
}

function buildParameterRowsFromParameters(params: any[], doc: OpenAPISpec) {
  return params.map((param) => {
    const normalizedSchema = normalizeSchema(param?.schema, doc);
    const location = `${param?.in || ''}`.trim().toLowerCase();
    const locationText =
      PARAM_LOCATION_TEXT[location] ||
      (location ? `${location.toUpperCase()} 参数` : '参数');
    const baseName = `${param?.name || '-'}`.trim() || '-';
    return {
      name: `${baseName}（${locationText}）`,
      type: schemaTypeText(normalizedSchema, doc),
      required: location === 'path' ? true : Boolean(param?.required ?? false),
      description: mergeDescriptionWithEnum(
        param?.description || normalizedSchema?.description || '',
        normalizedSchema,
      ),
      example: formatExampleValue(
        param?.example ??
          normalizedSchema?.example ??
          normalizedSchema?.default,
      ),
    };
  });
}

function appendOpenApiSecurity(lines: string[], raw: any, doc: OpenAPISpec) {
  const requirements = resolveOperationSecurity(raw);
  if (!Array.isArray(requirements) || requirements.length <= 0) {
    return;
  }

  if (!hasSecuritySchemes(requirements)) {
    return;
  }

  const schemeRows = buildSecuritySchemeRows(requirements, doc);
  if (schemeRows.length <= 0) {
    return;
  }

  lines.push(
    '##### 鉴权方式',
    '',
    '| 方案 | 类型 | in | 参数名 | scheme | 描述 |',
    '| --- | --- | --- | --- | --- | --- |',
  );
  schemeRows.forEach((row) => {
    lines.push(
      `| ${toMarkdownCell(row.schemeName)} | ${toMarkdownCell(row.type)} | ${toMarkdownCell(row.in)} | ${toMarkdownCell(row.parameterName)} | ${toMarkdownCell(row.scheme)} | ${toMarkdownCell(row.description)} |`,
    );
  });
  lines.push('');
}

function appendSecurityMetadata(lines: string[], raw: any) {
  const metadata = normalizeSecurityMetadata(raw);
  if (!metadata) {
    return;
  }

  if (metadata.ignore) {
    lines.push(
      '##### 鉴权码',
      '',
      '| 项 | 内容 |',
      '| --- | --- |',
      '| 鉴权码 | 忽略权限校验 |',
      '',
    );
    return;
  }

  const permissionText = metadata.permissions
    .map((item) => `${item || ''}`.trim())
    .filter(Boolean)
    .join(' | ');
  const roleText = metadata.roles
    .map((item) => `${item || ''}`.trim())
    .filter(Boolean)
    .join(' | ');

  const rows: string[] = [];
  if (permissionText) {
    rows.push(`| 权限 | ${toMarkdownCell(permissionText)} |`);
  }
  if (roleText) {
    rows.push(`| 角色 | ${toMarkdownCell(roleText)} |`);
  }
  if (rows.length <= 0) {
    return;
  }

  lines.push('##### 鉴权码', '', '| 项 | 内容 |', '| --- | --- |', ...rows, '');
}

function getGroupTitle(groupCode: string, serviceUrl?: string) {
  if (!groupCode || groupCode === 'all') {
    return '所有接口';
  }

  if (isAggregation.value) {
    if (serviceUrl) {
      const serviceDoc = aggregationServiceDocs.value.find(
        (item) => item.service.url === serviceUrl,
      );
      const groupName = serviceDoc?.groups.find(
        (item) => item.code === groupCode,
      )?.name;
      if (groupName) {
        return groupName;
      }
    }

    for (const serviceDoc of aggregationServiceDocs.value) {
      const groupName = serviceDoc.groups.find(
        (item) => item.code === groupCode,
      )?.name;
      if (groupName) {
        return groupName;
      }
    }
    return groupCode;
  }

  return (
    groupDocs.value.find((item) => item.code === groupCode)?.name || groupCode
  );
}

function isGroupExpanded(groupCode: string) {
  return Boolean(expandedGroups.value[groupCode]);
}

function toggleGroupExpanded(groupCode: string) {
  expandedGroups.value[groupCode] = !isGroupExpanded(groupCode);
}

function getCheckedCountInGroup(items: OperationItem[]) {
  const selected = selectedOperationSet.value;
  return items.filter((item) => selected.has(item.key)).length;
}

function getCheckedCountInGroupByNode(nodeKey: string, items: OperationItem[]) {
  return (
    selectedCountByNodeKey.value.get(nodeKey) ?? getCheckedCountInGroup(items)
  );
}

function isGroupChecked(items: OperationItem[], nodeKey?: string) {
  const checkedCount = nodeKey
    ? getCheckedCountInGroupByNode(nodeKey, items)
    : getCheckedCountInGroup(items);
  return items.length > 0 && checkedCount === items.length;
}

function isGroupIndeterminate(items: OperationItem[], nodeKey?: string) {
  const checkedCount = nodeKey
    ? getCheckedCountInGroupByNode(nodeKey, items)
    : getCheckedCountInGroup(items);
  return checkedCount > 0 && checkedCount < items.length;
}

function getPreviewOperations(selectedOps: OperationItem[]) {
  if (selectedOps.length <= PREVIEW_MAX_OPERATION_COUNT) {
    return selectedOps;
  }
  return selectedOps.slice(0, PREVIEW_MAX_OPERATION_COUNT);
}

function waitForNextFrame() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function toggleGroupSelection(items: OperationItem[], checked: boolean) {
  const selected = new Set(selectedOperations.value);
  items.forEach((item) => {
    if (checked) {
      selected.add(item.key);
    } else {
      selected.delete(item.key);
    }
  });
  selectedOperations.value = [...selected];
}

function isOperationChecked(operationKey: string) {
  return selectedOperationSet.value.has(operationKey);
}

function toggleOperationSelection(operationKey: string, checked: boolean) {
  const selected = new Set(selectedOperations.value);
  if (checked) {
    selected.add(operationKey);
  } else {
    selected.delete(operationKey);
  }
  selectedOperations.value = [...selected];
}

function getOperationDisplayTitle(item: OperationItem) {
  const description = item.summary || item.description;
  if (!description) {
    return `[${item.method.toUpperCase()}] ${item.path}`;
  }
  return `[${item.method.toUpperCase()}] ${item.path} - ${description}`;
}

function buildMarkdownDocument(doc: OpenAPISpec, selectedOps: OperationItem[]) {
  const lines: string[] = [];
  const info = doc.info;
  const extension: any = doc['x-nextdoc4j'] || {};

  lines.push(`# ${info?.title || 'API 文档'}`, '');

  const ops = (
    selectedOps.length > 0
      ? selectedOps
      : collectOperationsFromPaths(doc.paths || {}, {
          groupCode: 'all',
          groupName: '所有接口',
          serviceName: info?.title || '当前文档',
          serviceUrl: '__single__',
        })
  ).sort((a, b) => {
    const aTag = `${a.tags?.[0] || '默认标签'}`;
    const bTag = `${b.tags?.[0] || '默认标签'}`;
    return `${a.serviceName || ''}::${a.groupCode}::${aTag}::${a.path}::${a.method}`.localeCompare(
      `${b.serviceName || ''}::${b.groupCode}::${bTag}::${b.path}::${b.method}`,
      'zh-CN',
    );
  });

  const getTagTitle = (op: OperationItem) => {
    const tag = (op.tags || []).find((item) => `${item || ''}`.trim());
    return tag ? `${tag}` : '默认标签';
  };

  const appendOperationContent = (
    raw: any,
    op: OperationItem,
    index: number,
  ) => {
    if (index > 0) {
      lines.push('---', '');
    }

    const summary = raw.summary || op.summary || '-';
    const description = raw.description || op.description || '暂无描述';
    const operationTitle =
      summary === '-' ? `${op.method.toUpperCase()} ${op.path}` : `${summary}`;

    lines.push(
      `#### ${operationTitle}`,
      '',
      `<div style="padding:10px 12px;border:1px solid #dcdfe6;border-left:4px solid #409eff;border-radius:6px;"><strong>${op.method.toUpperCase()} ${op.path}</strong></div>`,
      '',
      `- ${description}`,
      '',
    );
    appendOpenApiSecurity(lines, raw, doc);
    appendSecurityMetadata(lines, raw);

    const params = raw.parameters || [];
    if (params.length > 0) {
      lines.push('##### 请求参数', '');
      appendParameterRows(lines, buildParameterRowsFromParameters(params, doc));
    }

    if (raw.requestBody?.content) {
      Object.entries(raw.requestBody.content).forEach(([contentType, body]) => {
        lines.push(`##### 请求体参数（${contentType}）`, '');
        const groups = buildSchemaFieldGroups((body as any)?.schema, doc);
        appendSchemaFieldGroups(lines, groups);
      });
    }

    if (raw.responses) {
      Object.entries(raw.responses).forEach(
        ([code, response]: [string, any]) => {
          if (!response?.content) {
            lines.push(
              `##### 响应参数（${code}）`,
              '',
              `- ${response?.description || '-'}：无响应体`,
              '',
            );
            return;
          }
          Object.entries(response.content).forEach(
            ([contentType, content]: [string, any]) => {
              const responseDescription = response?.description
                ? ` - ${response.description}`
                : '';
              lines.push(
                `##### 响应参数（${code}${responseDescription} / ${contentType}）`,
                '',
              );
              const groups = buildSchemaFieldGroups(content?.schema, doc);
              appendSchemaFieldGroups(lines, groups);
            },
          );
        },
      );
    }
  };

  let currentGroupKey = '';
  let currentTagKey = '';

  ops.forEach((op, index) => {
    const raw = op.raw || doc.paths?.[op.path]?.[op.method];
    if (!raw) return;

    const groupCode = op.groupCode || 'all';
    const groupTitle = getGroupTitle(groupCode, op.serviceUrl);
    const tagTitle = getTagTitle(op);
    const groupKey = isAggregation.value
      ? `${op.serviceUrl || ''}::${groupCode}`
      : `${groupCode}`;
    const groupHeading = isAggregation.value
      ? `${groupTitle}（${op.serviceName || '微服务'}）`
      : groupTitle;
    const tagKey = `${groupKey}::${tagTitle}`;

    if (groupKey !== currentGroupKey) {
      currentGroupKey = groupKey;
      currentTagKey = '';
      lines.push(`## ${groupHeading}`, '');
    }

    if (tagKey !== currentTagKey) {
      currentTagKey = tagKey;
      lines.push(`### ${tagTitle}`, '');
    }

    appendOperationContent(raw, op, index);
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

function buildPreviewContent(markdownContent: string) {
  const rendered = md.render(markdownContent);
  if (typeof window === 'undefined') {
    return {
      html: rendered,
      chunks: [] as string[],
      placeholderHeights: [] as number[],
    };
  }
  const template = document.createElement('template');
  template.innerHTML = rendered;
  const topLevelBlocks = [...template.content.children];
  if (topLevelBlocks.length <= PREVIEW_VIRTUAL_BLOCK_MIN_COUNT) {
    return {
      html: rendered,
      chunks: [],
      placeholderHeights: [],
    };
  }

  const chunks: string[] = [];
  const placeholderHeights: number[] = [];
  const appendChunk = (nodes: Element[]) => {
    if (nodes.length <= 0) {
      return;
    }
    const container = document.createElement('section');
    nodes.forEach((node) => {
      container.append(node);
    });
    chunks.push(container.innerHTML);
    placeholderHeights.push(Math.max(560, nodes.length * 56));
  };

  const semanticChunks: Element[][] = [];
  let currentChunk: Element[] = [];
  let chunkHasOperationHeading = false;

  topLevelBlocks.forEach((block) => {
    const isOperationHeading = block.tagName === 'H4';
    if (isOperationHeading && chunkHasOperationHeading) {
      semanticChunks.push(currentChunk);
      currentChunk = [];
      chunkHasOperationHeading = false;
    }
    currentChunk.push(block);
    if (isOperationHeading) {
      chunkHasOperationHeading = true;
    }
  });

  if (currentChunk.length > 0) {
    semanticChunks.push(currentChunk);
  }

  if (semanticChunks.length <= 1) {
    for (
      let index = 0;
      index < topLevelBlocks.length;
      index += PREVIEW_VIRTUAL_BLOCK_CHUNK_SIZE
    ) {
      appendChunk(
        topLevelBlocks.slice(index, index + PREVIEW_VIRTUAL_BLOCK_CHUNK_SIZE),
      );
    }
  } else {
    semanticChunks.forEach((chunkNodes) => {
      appendChunk(chunkNodes);
    });
  }

  return {
    html: '',
    chunks,
    placeholderHeights,
  };
}

function decodeHtmlEntities(text: string) {
  return text
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

function stripHtmlTags(text: string) {
  return decodeHtmlEntities(text)
    .replaceAll(/<br\s*\/?>/gi, '\n')
    .replaceAll(/<\/p>/gi, ' ')
    .replaceAll(/<[^>]+>/g, '');
}

function parseMarkdownTableCells(line: string) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => stripHtmlTags(cell).trim());
}

function isMarkdownTableHeaderLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
    return false;
  }
  const cells = parseMarkdownTableCells(trimmed);
  return cells.length > 1;
}

function isMarkdownTableSeparatorLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
    return false;
  }
  const cells = parseMarkdownTableCells(trimmed);
  return (
    cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))
  );
}

function isMarkdownTableRowLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
    return false;
  }
  if (isMarkdownTableSeparatorLine(trimmed)) {
    return false;
  }
  const cells = parseMarkdownTableCells(trimmed);
  return cells.length > 1;
}

function buildDocxTableFromRows(headerCells: string[], bodyRows: string[][]) {
  const columnCount = Math.max(
    headerCells.length,
    ...bodyRows.map((row) => row.length),
  );

  const buildRowCells = (cells: string[], header = false) =>
    Array.from({ length: columnCount }, (_, index) => {
      const text = cells[index] || '-';
      return new DocxTableCell({
        children: [
          new DocxParagraph({
            children: [
              new DocxTextRun({
                bold: header,
                text,
              }),
            ],
          }),
        ],
      });
    });

  return new DocxTable({
    rows: [
      new DocxTableRow({
        children: buildRowCells(headerCells, true),
        tableHeader: true,
      }),
      ...bodyRows.map(
        (row) =>
          new DocxTableRow({
            children: buildRowCells(row),
          }),
      ),
    ],
    width: {
      size: 100,
      type: DocxWidthType.PERCENTAGE,
    },
  });
}

function buildDocxChildrenFromMarkdown(markdownContent: string) {
  const lines = markdownContent.split('\n').map((rawLine) => rawLine.trimEnd());
  const children: Array<DocxParagraph | DocxTable> = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] || '';

    if (
      isMarkdownTableHeaderLine(line) &&
      index + 1 < lines.length &&
      isMarkdownTableSeparatorLine(lines[index + 1] || '')
    ) {
      const headerCells = parseMarkdownTableCells(line);
      const bodyRows: string[][] = [];
      let rowIndex = index + 2;
      while (rowIndex < lines.length) {
        const rowLine = lines[rowIndex];
        if (!rowLine || !isMarkdownTableRowLine(rowLine)) {
          break;
        }
        bodyRows.push(parseMarkdownTableCells(rowLine));
        rowIndex++;
      }
      children.push(buildDocxTableFromRows(headerCells, bodyRows));
      index = rowIndex - 1;
      continue;
    }

    const normalized = stripHtmlTags(line).trim();
    if (!normalized) {
      children.push(new DocxParagraph({ text: '' }));
      continue;
    }

    if (normalized === '---') {
      children.push(new DocxParagraph({ text: '────────────────────────' }));
      continue;
    }

    if (normalized.startsWith('# ')) {
      children.push(
        new DocxParagraph({
          text: normalized.slice(2).trim(),
          heading: DocxHeadingLevel.HEADING_1,
        }),
      );
      continue;
    }

    if (normalized.startsWith('## ')) {
      children.push(
        new DocxParagraph({
          text: normalized.slice(3).trim(),
          heading: DocxHeadingLevel.HEADING_2,
        }),
      );
      continue;
    }

    if (normalized.startsWith('### ')) {
      children.push(
        new DocxParagraph({
          text: normalized.slice(4).trim(),
          heading: DocxHeadingLevel.HEADING_3,
        }),
      );
      continue;
    }

    if (normalized.startsWith('#### ')) {
      children.push(
        new DocxParagraph({
          text: normalized.slice(5).trim(),
          heading: DocxHeadingLevel.HEADING_4,
        }),
      );
      continue;
    }

    if (normalized.startsWith('##### ')) {
      children.push(
        new DocxParagraph({
          text: normalized.slice(6).trim(),
          heading: DocxHeadingLevel.HEADING_5,
        }),
      );
      continue;
    }

    if (normalized.startsWith('- ')) {
      children.push(
        new DocxParagraph({
          text: normalized.slice(2).trim(),
          bullet: { level: 0 },
        }),
      );
      continue;
    }

    children.push(new DocxParagraph({ text: normalized }));
  }

  return children;
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

function resetPreviewChunkObserver() {
  if (previewChunkObserver) {
    previewChunkObserver.disconnect();
    previewChunkObserver = null;
  }
  previewVisibleChunkIndexes.value = new Set();
}

function resetPreviewChunkMeasureFrame() {
  if (previewChunkMeasureFrame) {
    window.cancelAnimationFrame(previewChunkMeasureFrame);
    previewChunkMeasureFrame = null;
  }
}

function isSameNumberSet(a: Set<number>, b: Set<number>) {
  if (a.size !== b.size) {
    return false;
  }
  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }
  return true;
}

function initPreviewLoadedChunkIndexes(totalChunkCount: number) {
  const loaded = new Set<number>();
  const initialCount = Math.min(
    totalChunkCount,
    PREVIEW_CHUNK_PREFETCH_COUNT * 2 + 1,
  );
  for (let index = 0; index < initialCount; index += 1) {
    loaded.add(index);
  }
  previewLoadedChunkIndexes.value = loaded;
}

function updatePreviewLoadedChunkIndexesByVisible() {
  if (previewChunks.value.length <= 0) {
    previewLoadedChunkIndexes.value = new Set();
    return;
  }

  const nextLoaded = new Set<number>();
  if (previewVisibleChunkIndexes.value.size <= 0) {
    initPreviewLoadedChunkIndexes(previewChunks.value.length);
    return;
  }

  previewVisibleChunkIndexes.value.forEach((chunkIndex) => {
    const startIndex = Math.max(0, chunkIndex - PREVIEW_CHUNK_PREFETCH_COUNT);
    const endIndex = Math.min(
      previewChunks.value.length - 1,
      chunkIndex + PREVIEW_CHUNK_PREFETCH_COUNT,
    );
    for (let index = startIndex; index <= endIndex; index += 1) {
      nextLoaded.add(index);
    }
  });

  if (!isSameNumberSet(nextLoaded, previewLoadedChunkIndexes.value)) {
    previewLoadedChunkIndexes.value = nextLoaded;
  }
}

function syncPreviewChunkPlaceholderHeights() {
  const nextHeights = [...previewChunkPlaceholderHeights.value];
  let changed = false;
  previewLoadedChunkIndexes.value.forEach((index) => {
    const element = previewChunkElements.value[index];
    if (!element) {
      return;
    }
    const height = Math.ceil(element.getBoundingClientRect().height);
    if (height <= 0) {
      return;
    }
    const currentHeight = nextHeights[index] || 0;
    if (Math.abs(currentHeight - height) > 12) {
      nextHeights[index] = height;
      changed = true;
    }
  });
  if (changed) {
    previewChunkPlaceholderHeights.value = nextHeights;
  }
}

function scheduleSyncPreviewChunkPlaceholderHeights() {
  if (previewChunkMeasureFrame) {
    return;
  }
  previewChunkMeasureFrame = window.requestAnimationFrame(() => {
    previewChunkMeasureFrame = null;
    syncPreviewChunkPlaceholderHeights();
  });
}

function isPreviewChunkLoaded(index: number) {
  return previewLoadedChunkIndexes.value.has(index);
}

function setPreviewChunkRef(element: Element | null, index: number) {
  previewChunkElements.value[index] = (element as HTMLElement) || null;
}

function setupPreviewChunkObserver() {
  resetPreviewChunkObserver();

  if (previewChunks.value.length <= 0) {
    return;
  }

  const root = previewScrollRef.value;
  if (!root || typeof window === 'undefined') {
    previewLoadedChunkIndexes.value = new Set(
      previewChunks.value.map((_, index) => index),
    );
    return;
  }

  if (window.IntersectionObserver === undefined) {
    previewLoadedChunkIndexes.value = new Set(
      previewChunks.value.map((_, index) => index),
    );
    return;
  }

  const observer = new window.IntersectionObserver(
    (entries) => {
      const nextVisible = new Set(previewVisibleChunkIndexes.value);
      let visibleChanged = false;
      entries.forEach((entry) => {
        const chunkIndex = Number.parseInt(
          (entry.target as HTMLElement).dataset.previewChunkIndex || '-1',
          10,
        );
        if (chunkIndex < 0 || chunkIndex >= previewChunks.value.length) {
          return;
        }
        if (entry.isIntersecting) {
          if (!nextVisible.has(chunkIndex)) {
            nextVisible.add(chunkIndex);
            visibleChanged = true;
          }
        } else if (nextVisible.delete(chunkIndex)) {
          visibleChanged = true;
        }
      });
      if (!visibleChanged) {
        return;
      }
      previewVisibleChunkIndexes.value = nextVisible;
      updatePreviewLoadedChunkIndexesByVisible();
      void nextTick().then(() => {
        scheduleSyncPreviewChunkPlaceholderHeights();
      });
    },
    {
      root,
      rootMargin: PREVIEW_CHUNK_ROOT_MARGIN,
      threshold: 0,
    },
  );

  previewChunkObserver = observer;
  previewChunkElements.value.forEach((element) => {
    if (element) {
      observer.observe(element);
    }
  });
}

function resetPreviewState() {
  resetPreviewChunkObserver();
  resetPreviewChunkMeasureFrame();
  previewLoading.value = false;
  previewHtml.value = '';
  previewChunks.value = [];
  previewChunkPlaceholderHeights.value = [];
  previewLoadedChunkIndexes.value = new Set();
  previewVisibleChunkIndexes.value = new Set();
  previewChunkElements.value = [];
}

async function generatePreview(silentOrEvent?: boolean | Event) {
  const silent = typeof silentOrEvent === 'boolean' ? silentOrEvent : false;
  const selectedOps = buildSelectedOperations();
  if (selectedOps.length <= 0) {
    resetPreviewState();
    if (!silent) {
      ElMessage.warning('请先选择导出范围');
    }
    return;
  }

  const previewOps = getPreviewOperations(selectedOps);
  const currentToken = ++previewGenerationToken;
  previewLoading.value = true;
  await waitForNextFrame();
  if (currentToken !== previewGenerationToken) {
    return;
  }

  const subset = buildSubsetOpenApi(previewOps);
  if (!subset) {
    resetPreviewState();
    if (!silent) {
      ElMessage.warning('请先选择导出范围');
    }
    return;
  }

  try {
    const markdownContent = buildMarkdownDocument(subset, previewOps);
    if (currentToken !== previewGenerationToken) {
      return;
    }
    const previewContent = buildPreviewContent(markdownContent);
    previewHtml.value = previewContent.html;
    previewChunks.value = previewContent.chunks;
    previewChunkPlaceholderHeights.value = previewContent.placeholderHeights;
    previewChunkElements.value = Array.from(
      { length: previewContent.chunks.length },
      () => null,
    );
    if (previewContent.chunks.length > 0) {
      initPreviewLoadedChunkIndexes(previewContent.chunks.length);
    } else {
      previewLoadedChunkIndexes.value = new Set();
      resetPreviewChunkObserver();
    }
  } finally {
    if (currentToken === previewGenerationToken) {
      previewLoading.value = false;
      if (previewChunks.value.length > 0) {
        await nextTick();
        if (currentToken === previewGenerationToken) {
          setupPreviewChunkObserver();
          scheduleSyncPreviewChunkPlaceholderHeights();
        }
      }
    }
  }
}

async function exportDocument() {
  const selectedOps = buildSelectedOperations();
  const subset = buildSubsetOpenApi(selectedOps);
  if (!subset) {
    ElMessage.warning('请先选择导出范围');
    return false;
  }

  const title = subset.info?.title || 'api-doc';
  const markdownContent = buildMarkdownDocument(subset, selectedOps);
  const htmlContent = buildExportHtml(markdownContent, title);

  try {
    switch (exportFormat.value) {
      case 'docx': {
        const docxDocument = new DocxDocument({
          title,
          sections: [
            {
              children: buildDocxChildrenFromMarkdown(markdownContent),
            },
          ],
        });
        const mimeType =
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        const docxBlob = await DocxPacker.toBlob(docxDocument);
        downloadFile(docxBlob, `${title}.docx`, mimeType);
        return true;
      }
      case 'html': {
        downloadFile(htmlContent, `${title}.html`, 'text/html;charset=utf-8');
        return true;
      }
      case 'markdown': {
        downloadFile(
          markdownContent,
          `${title}.md`,
          'text/markdown;charset=utf-8',
        );
        return true;
      }
      case 'openapi.json': {
        downloadFile(
          JSON.stringify(subset, null, 2),
          `${title}.openapi.json`,
          'application/json;charset=utf-8',
        );
        return true;
      }
      case 'pdf': {
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
          ElMessage.warning('浏览器拦截了弹窗，请允许后重试');
          return false;
        }
        printWindow.document.open();
        printWindow.document.write(htmlContent);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
        ElMessage.success('已打开打印窗口，请选择“另存为 PDF”');
        return true;
      }
    }
  } catch (error: any) {
    console.error(error);
    ElMessage.error(error?.message || '导出失败，请稍后重试');
    return false;
  }

  return false;
}

function openExportDialog() {
  exportDialogVisible.value = true;
}

async function confirmExportDocument() {
  if (exportSubmitting.value) {
    return;
  }

  exportSubmitting.value = true;
  try {
    const success = await exportDocument();
    if (success) {
      exportDialogVisible.value = false;
    }
  } finally {
    exportSubmitting.value = false;
  }
}

function scheduleAutoPreview() {
  if (previewAutoTimer) {
    window.clearTimeout(previewAutoTimer);
  }
  previewGenerationToken += 1;
  previewAutoTimer = window.setTimeout(
    () => {
      previewAutoTimer = null;
      if (loading.value) {
        return;
      }
      void generatePreview(true);
    },
    operations.value.length > PREVIEW_MAX_OPERATION_COUNT
      ? PREVIEW_AUTO_DELAY_LARGE
      : PREVIEW_AUTO_DELAY,
  );
}

watch(
  () => isAggregation.value,
  async () => {
    await loadDocContext();
  },
  { immediate: true },
);

watch(
  () => services.value.map((item) => `${item.url}:${item.disabled}`).join('|'),
  async () => {
    if (isAggregation.value) {
      await loadDocContext();
    }
  },
);

watch(
  [
    scopeMode,
    selectedOperations,
    operations,
    () => exportDocOptions.value.join('|'),
    currentOpenApi,
    aggregationGatewayOpenApi,
  ],
  () => {
    scheduleAutoPreview();
  },
);

watch(loading, (value) => {
  if (!value) {
    scheduleAutoPreview();
  }
});

onBeforeUnmount(() => {
  if (previewAutoTimer) {
    window.clearTimeout(previewAutoTimer);
    previewAutoTimer = null;
  }
  previewGenerationToken += 1;
  resetPreviewChunkObserver();
  resetPreviewChunkMeasureFrame();
});
</script>

<template>
  <div class="doc-export-page h-full overflow-hidden px-5 pb-2 pt-5">
    <ElRow :gutter="16" class="doc-export-layout">
      <ElCol :span="10" class="doc-export-col">
        <div class="doc-left-column">
          <ElCard shadow="never" class="doc-range-card">
            <template #header>
              <span class="font-medium">导出范围选择</span>
            </template>

            <ElSkeleton v-if="loading" :rows="6" animated />
            <template v-else>
              <ElForm label-width="90px">
                <ElFormItem label="导出范围">
                  <ElRadioGroup v-model="scopeMode">
                    <ElRadio value="all">全部文档</ElRadio>
                    <ElRadio value="custom">自定义范围</ElRadio>
                  </ElRadioGroup>
                </ElFormItem>
              </ElForm>

              <ElAlert class="mb-6" type="info" :closable="false">
                <template #default>{{ summaryText }}</template>
              </ElAlert>

              <template v-if="scopeMode === 'custom'">
                <div class="mb-2 mt-3 flex gap-2">
                  <ElInput
                    v-model.trim="operationKeyword"
                    placeholder="搜索 微服务 / 分组 / URL / 描述 / operationId"
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

                <div class="mb-2 text-xs text-[var(--el-text-color-secondary)]">
                  {{
                    isAggregation
                      ? '一层是微服务，二层是分组（若存在），末层是接口。左侧复选框可全选，右侧箭头可展开。'
                      : '一层是分组，二层是接口。可直接勾选分组，或展开后勾选部分接口。'
                  }}
                </div>

                <div
                  class="scope-tree-panel rounded border border-[var(--el-border-color)] bg-[var(--el-bg-color)] px-2"
                >
                  <template v-if="isAggregation">
                    <template v-if="aggregationServiceTree.length > 0">
                      <div
                        class="divide-y divide-[var(--el-border-color-lighter)]"
                      >
                        <div
                          v-for="serviceNode in aggregationServiceTree"
                          :key="serviceNode.serviceUrl"
                          class="py-2"
                        >
                          <div
                            class="service-header flex items-center justify-between px-1 py-1"
                            :class="{
                              'group-node--checked':
                                getCheckedCountInGroupByNode(
                                  serviceNode.key,
                                  serviceNode.allOperations,
                                ) > 0,
                            }"
                          >
                            <ElCheckbox
                              :model-value="
                                isGroupChecked(
                                  serviceNode.allOperations,
                                  serviceNode.key,
                                )
                              "
                              :indeterminate="
                                isGroupIndeterminate(
                                  serviceNode.allOperations,
                                  serviceNode.key,
                                )
                              "
                              @change="
                                (value) =>
                                  toggleGroupSelection(
                                    serviceNode.allOperations,
                                    Boolean(value),
                                  )
                              "
                            >
                              <span class="font-medium">
                                {{ serviceNode.serviceName }}
                              </span>
                              <span
                                class="ml-1 text-xs text-[var(--el-text-color-secondary)]"
                              >
                                ({{
                                  getCheckedCountInGroupByNode(
                                    serviceNode.key,
                                    serviceNode.allOperations,
                                  )
                                }}/{{ serviceNode.allOperations.length }})
                              </span>
                            </ElCheckbox>
                            <div
                              class="group-toggle-area"
                              role="button"
                              tabindex="0"
                              :aria-label="
                                isGroupExpanded(serviceNode.key)
                                  ? '收起微服务'
                                  : '展开微服务'
                              "
                              @click.stop="toggleGroupExpanded(serviceNode.key)"
                              @keydown.enter.prevent.stop="
                                toggleGroupExpanded(serviceNode.key)
                              "
                              @keydown.space.prevent.stop="
                                toggleGroupExpanded(serviceNode.key)
                              "
                            >
                              <component
                                :is="
                                  isGroupExpanded(serviceNode.key)
                                    ? SvgDoubleArrowUpIcon
                                    : SvgDoubleArrowDownIcon
                                "
                                class="group-toggle-icon"
                              />
                            </div>
                          </div>

                          <Transition name="group-submenu-motion">
                            <div
                              v-if="isGroupExpanded(serviceNode.key)"
                              class="group-submenu-wrap ml-3 mt-2 border-l border-dashed border-[var(--el-border-color)] pl-3"
                            >
                              <template v-if="serviceNode.hasGroupLevel">
                                <div class="group-submenu-list py-1">
                                  <div
                                    v-for="group in serviceNode.groups"
                                    :key="group.key"
                                    class="mb-2 last:mb-0"
                                  >
                                    <div
                                      class="group-header flex items-center justify-between px-1 py-1"
                                      :class="{
                                        'group-node--checked':
                                          getCheckedCountInGroupByNode(
                                            group.key,
                                            group.operations,
                                          ) > 0,
                                      }"
                                    >
                                      <ElCheckbox
                                        :model-value="
                                          isGroupChecked(
                                            group.operations,
                                            group.key,
                                          )
                                        "
                                        :indeterminate="
                                          isGroupIndeterminate(
                                            group.operations,
                                            group.key,
                                          )
                                        "
                                        @change="
                                          (value) =>
                                            toggleGroupSelection(
                                              group.operations,
                                              Boolean(value),
                                            )
                                        "
                                      >
                                        <span class="font-medium">
                                          {{ group.name }}
                                        </span>
                                        <span
                                          class="ml-1 text-xs text-[var(--el-text-color-secondary)]"
                                        >
                                          ({{
                                            getCheckedCountInGroupByNode(
                                              group.key,
                                              group.operations,
                                            )
                                          }}/{{ group.operations.length }})
                                        </span>
                                      </ElCheckbox>
                                      <div
                                        class="group-toggle-area"
                                        role="button"
                                        tabindex="0"
                                        :aria-label="
                                          isGroupExpanded(group.key)
                                            ? '收起分组'
                                            : '展开分组'
                                        "
                                        @click.stop="
                                          toggleGroupExpanded(group.key)
                                        "
                                        @keydown.enter.prevent.stop="
                                          toggleGroupExpanded(group.key)
                                        "
                                        @keydown.space.prevent.stop="
                                          toggleGroupExpanded(group.key)
                                        "
                                      >
                                        <component
                                          :is="
                                            isGroupExpanded(group.key)
                                              ? SvgDoubleArrowUpIcon
                                              : SvgDoubleArrowDownIcon
                                          "
                                          class="group-toggle-icon"
                                        />
                                      </div>
                                    </div>

                                    <Transition name="group-submenu-motion">
                                      <div
                                        v-if="isGroupExpanded(group.key)"
                                        class="group-submenu-wrap ml-3 mt-2 border-l border-dashed border-[var(--el-border-color)] pl-3"
                                      >
                                        <div class="group-submenu-list py-1">
                                          <ElCheckbox
                                            v-for="item in group.operations"
                                            :key="item.key"
                                            class="group-submenu-item"
                                            :title="
                                              getOperationDisplayTitle(item)
                                            "
                                            :model-value="
                                              isOperationChecked(item.key)
                                            "
                                            @change="
                                              (value) =>
                                                toggleOperationSelection(
                                                  item.key,
                                                  Boolean(value),
                                                )
                                            "
                                          >
                                            <span class="operation-label">
                                              [{{ item.method.toUpperCase() }}]
                                              {{ item.path }}
                                              <span
                                                v-if="
                                                  item.summary ||
                                                  item.description
                                                "
                                                class="operation-label__desc"
                                              >
                                                -
                                                {{
                                                  item.summary ||
                                                  item.description
                                                }}
                                              </span>
                                            </span>
                                          </ElCheckbox>
                                        </div>
                                      </div>
                                    </Transition>
                                  </div>
                                </div>
                              </template>
                              <template v-else>
                                <div class="group-submenu-list py-1">
                                  <ElCheckbox
                                    v-for="item in serviceNode.operations"
                                    :key="item.key"
                                    class="group-submenu-item"
                                    :title="getOperationDisplayTitle(item)"
                                    :model-value="isOperationChecked(item.key)"
                                    @change="
                                      (value) =>
                                        toggleOperationSelection(
                                          item.key,
                                          Boolean(value),
                                        )
                                    "
                                  >
                                    <span class="operation-label">
                                      [{{ item.method.toUpperCase() }}]
                                      {{ item.path }}
                                      <span
                                        v-if="item.summary || item.description"
                                        class="operation-label__desc"
                                      >
                                        -
                                        {{ item.summary || item.description }}
                                      </span>
                                    </span>
                                  </ElCheckbox>
                                </div>
                              </template>
                            </div>
                          </Transition>
                        </div>
                      </div>
                    </template>
                    <div
                      v-else
                      class="py-8 text-center text-sm text-[var(--el-text-color-secondary)]"
                    >
                      暂无匹配接口
                    </div>
                  </template>
                  <template v-else>
                    <template v-if="groupedFilteredOperations.length > 0">
                      <div
                        class="divide-y divide-[var(--el-border-color-lighter)]"
                      >
                        <div
                          v-for="group in groupedFilteredOperations"
                          :key="group.code"
                          class="py-2"
                        >
                          <div
                            class="group-header flex items-center justify-between px-1 py-1"
                            :class="{
                              'group-node--checked':
                                getCheckedCountInGroupByNode(
                                  group.code,
                                  group.operations,
                                ) > 0,
                            }"
                          >
                            <ElCheckbox
                              :model-value="
                                isGroupChecked(group.operations, group.code)
                              "
                              :indeterminate="
                                isGroupIndeterminate(
                                  group.operations,
                                  group.code,
                                )
                              "
                              @change="
                                (value) =>
                                  toggleGroupSelection(
                                    group.operations,
                                    Boolean(value),
                                  )
                              "
                            >
                              <span class="font-medium">{{ group.name }}</span>
                              <span
                                class="ml-1 text-xs text-[var(--el-text-color-secondary)]"
                              >
                                ({{
                                  getCheckedCountInGroupByNode(
                                    group.code,
                                    group.operations,
                                  )
                                }}/{{ group.operations.length }})
                              </span>
                            </ElCheckbox>
                            <div
                              class="group-toggle-area"
                              role="button"
                              tabindex="0"
                              :aria-label="
                                isGroupExpanded(group.code)
                                  ? '收起分组'
                                  : '展开分组'
                              "
                              @click.stop="toggleGroupExpanded(group.code)"
                              @keydown.enter.prevent.stop="
                                toggleGroupExpanded(group.code)
                              "
                              @keydown.space.prevent.stop="
                                toggleGroupExpanded(group.code)
                              "
                            >
                              <component
                                :is="
                                  isGroupExpanded(group.code)
                                    ? SvgDoubleArrowUpIcon
                                    : SvgDoubleArrowDownIcon
                                "
                                class="group-toggle-icon"
                              />
                            </div>
                          </div>

                          <Transition name="group-submenu-motion">
                            <div
                              v-if="isGroupExpanded(group.code)"
                              class="group-submenu-wrap ml-3 mt-2 border-l border-dashed border-[var(--el-border-color)] pl-3"
                            >
                              <div class="group-submenu-list py-1">
                                <ElCheckbox
                                  v-for="item in group.operations"
                                  :key="item.key"
                                  class="group-submenu-item"
                                  :title="getOperationDisplayTitle(item)"
                                  :model-value="isOperationChecked(item.key)"
                                  @change="
                                    (value) =>
                                      toggleOperationSelection(
                                        item.key,
                                        Boolean(value),
                                      )
                                  "
                                >
                                  <span class="operation-label">
                                    [{{ item.method.toUpperCase() }}]
                                    {{ item.path }}
                                    <span
                                      v-if="item.summary || item.description"
                                      class="operation-label__desc"
                                    >
                                      -
                                      {{ item.summary || item.description }}
                                    </span>
                                  </span>
                                </ElCheckbox>
                              </div>
                            </div>
                          </Transition>
                        </div>
                      </div>
                    </template>
                    <div
                      v-else
                      class="py-8 text-center text-sm text-[var(--el-text-color-secondary)]"
                    >
                      暂无匹配接口
                    </div>
                  </template>
                </div>
              </template>
              <template v-else>
                <div
                  class="doc-all-selected-tip rounded border p-3 text-sm text-[var(--el-text-color-secondary)]"
                >
                  已选择全部接口文档，无需单独勾选。
                </div>
              </template>
            </template>
          </ElCard>

          <ElCard shadow="never" class="doc-other-card">
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
        </div>
      </ElCol>

      <ElCol :span="14" class="doc-export-col">
        <div class="doc-right-column">
          <ElCard shadow="never" class="doc-preview-card">
            <template #header>
              <div class="flex flex-wrap items-center justify-between gap-3">
                <span class="font-medium">Markdown 实时预览</span>
                <div class="flex items-center gap-3">
                  <span class="text-xs text-[var(--el-text-color-secondary)]">
                    当前格式：{{ exportFormatTextMap[exportFormat] }}
                  </span>
                  <ElButton type="primary" @click="openExportDialog">
                    导出文档
                  </ElButton>
                </div>
              </div>
            </template>

            <ElSkeleton v-if="previewLoading" :rows="8" animated />
            <template v-else>
              <ElAlert
                v-if="previewNoticeText"
                class="mb-4"
                type="warning"
                :closable="false"
              >
                <template #default>{{ previewNoticeText }}</template>
              </ElAlert>
              <ElEmpty
                v-if="isPreviewEmpty"
                description="请选择导出范围或接口，预览将自动更新"
              />
              <div
                v-else
                ref="previewScrollRef"
                class="doc-preview-html overflow-auto [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2"
              >
                <div
                  v-if="previewChunks.length <= 0"
                  class="doc-preview-html-content"
                  v-html="previewHtml"
                ></div>
                <template v-else>
                  <section
                    v-for="(chunk, index) in previewChunks"
                    :key="`preview-chunk-${index}`"
                    :ref="
                      (el) => setPreviewChunkRef(el as Element | null, index)
                    "
                    :data-preview-chunk-index="index"
                    class="doc-preview-virtual-block"
                    :style="
                      isPreviewChunkLoaded(index)
                        ? undefined
                        : {
                            minHeight: `${previewChunkPlaceholderHeights[index] || 720}px`,
                          }
                    "
                    v-html="isPreviewChunkLoaded(index) ? chunk : ''"
                  ></section>
                </template>
              </div>
            </template>
          </ElCard>
        </div>
      </ElCol>
    </ElRow>

    <ElDialog
      v-model="exportDialogVisible"
      title="选择导出格式"
      width="780px"
      class="doc-export-dialog"
      destroy-on-close
      align-center
    >
      <div class="export-dialog-panel">
        <div class="export-dialog-intro">
          <div class="export-dialog-intro__title">
            选择一个适合当前场景的导出格式
          </div>
          <div class="export-dialog-intro__desc">
            左侧导出范围与附加内容会一并生效。当前已选格式为
            <strong>{{ activeExportOption.title }}</strong>
            ，确认后立即开始导出。
          </div>
        </div>

        <div class="export-format-grid">
          <button
            v-for="option in exportFormatOptions"
            :key="option.format"
            type="button"
            class="export-format-card"
            :class="{
              'is-active': exportFormat === option.format,
            }"
            @click="exportFormat = option.format"
          >
            <span class="export-format-card__badge">
              {{ exportFormat === option.format ? '已选' : '格式' }}
            </span>
            <span class="export-format-card__logo">
              <component :is="option.icon" class="export-format-card__icon" />
            </span>
            <span class="export-format-card__title">{{ option.title }}</span>
            <span class="export-format-card__desc">
              {{ option.description }}
            </span>
          </button>
        </div>
      </div>

      <template #footer>
        <div class="export-dialog-footer">
          <ElButton @click="exportDialogVisible = false">取消</ElButton>
          <ElButton
            type="primary"
            :loading="exportSubmitting"
            @click="confirmExportDocument"
          >
            导出 {{ activeExportOption.title }}
          </ElButton>
        </div>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped lang="scss">
.doc-export-page {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 100%;
  min-height: 0;

  :deep(.doc-range-card .el-card__body),
  :deep(.doc-preview-card .el-card__body) {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  :deep(.doc-preview-card .el-card__body),
  :deep(.doc-preview-html) {
    contain: layout paint;
  }
}

.doc-export-layout {
  flex: 1;
  align-items: stretch;
  min-width: 0;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.doc-export-col {
  display: flex;
  min-width: 0;
  height: 100%;
  min-height: 0;
}

.doc-left-column,
.doc-right-column {
  display: flex;
  flex: 1;
  flex-direction: column;
  width: 100%;
  min-width: 0;
  min-height: 0;
}

.doc-range-card,
.doc-preview-card {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
  overflow: hidden;
}

.doc-range-card {
  flex: 1;
  min-height: 0;
}

.doc-other-card {
  margin-top: auto;
  margin-bottom: 6px;
}

.doc-preview-card {
  flex: 1;
  min-height: 0;
  margin-bottom: 6px;
}

.doc-all-selected-tip {
  margin-top: 8px;
}

:deep(.doc-export-dialog) {
  max-width: calc(100vw - 24px);
}

:deep(.doc-export-dialog .el-dialog) {
  overflow: hidden;
  background: linear-gradient(
    180deg,
    rgb(var(--el-color-primary-rgb) / 12%) 0%,
    var(--el-bg-color) 22%,
    var(--el-bg-color) 100%
  );
  border: 1px solid var(--el-border-color);
  border-radius: 28px;
  box-shadow: 0 28px 80px rgb(15 23 42 / 18%);
}

:deep(.doc-export-dialog .el-dialog__header) {
  margin-right: 0;
  padding: 24px 24px 0;
}

:deep(.doc-export-dialog .el-dialog__title) {
  font-size: 18px;
  font-weight: 700;
  color: var(--el-text-color-primary);
  letter-spacing: 0.01em;
}

:deep(.doc-export-dialog .el-dialog__body) {
  padding: 20px 24px 8px;
}

:deep(.doc-export-dialog .el-dialog__footer) {
  padding: 0 24px 24px;
}

.export-dialog-panel {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.export-dialog-intro {
  padding: 18px 20px;
  background: linear-gradient(
    135deg,
    rgb(var(--el-color-primary-rgb) / 14%) 0%,
    rgb(var(--el-color-primary-rgb) / 4%) 52%,
    var(--el-fill-color-light) 100%
  );
  border: 1px solid rgb(var(--el-color-primary-rgb) / 18%);
  border-radius: 22px;
}

.export-dialog-intro__title {
  font-size: 22px;
  font-weight: 700;
  line-height: 1.3;
  color: var(--el-text-color-primary);
}

.export-dialog-intro__desc {
  margin-top: 8px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--el-text-color-regular);
}

.export-format-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
}

.export-format-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-height: 176px;
  padding: 14px;
  text-align: left;
  cursor: pointer;
  user-select: none;
  background: linear-gradient(
    180deg,
    var(--el-bg-color) 0%,
    var(--el-fill-color-lighter) 100%
  );
  border: 1px solid var(--el-border-color);
  border-radius: 22px;
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease,
    border-color 0.18s ease,
    background 0.18s ease;
}

.export-format-card:hover,
.export-format-card:focus-visible {
  transform: translateY(-2px);
  border-color: rgb(var(--el-color-primary-rgb) / 42%);
  box-shadow: 0 18px 36px rgb(15 23 42 / 10%);
  outline: none;
}

.export-format-card.is-active {
  background: linear-gradient(
    180deg,
    rgb(var(--el-color-primary-rgb) / 12%) 0%,
    var(--el-bg-color) 100%
  );
  border-color: rgb(var(--el-color-primary-rgb) / 46%);
  box-shadow:
    0 0 0 1px rgb(var(--el-color-primary-rgb) / 18%),
    0 20px 44px rgb(var(--el-color-primary-rgb) / 14%);
}

.export-format-card__badge {
  position: absolute;
  top: 12px;
  right: 12px;
  padding: 3px 7px;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 999px;
}

.export-format-card.is-active .export-format-card__badge {
  color: var(--el-color-primary);
  background: rgb(var(--el-color-primary-rgb) / 12%);
  border-color: rgb(var(--el-color-primary-rgb) / 20%);
}

.export-format-card__logo {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 72px;
  margin-bottom: 14px;
  background: linear-gradient(
    180deg,
    rgb(var(--el-color-primary-rgb) / 12%) 0%,
    rgb(var(--el-color-primary-rgb) / 4%) 100%
  );
  border: 1px solid rgb(var(--el-color-primary-rgb) / 14%);
  border-radius: 18px;
}

.export-format-card__icon {
  width: 52px;
  height: 52px;
}

.export-format-card__title {
  display: block;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.35;
  color: var(--el-text-color-primary);
}

.export-format-card__desc {
  display: block;
  margin-top: 6px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.export-dialog-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
}

.scope-tree-panel {
  flex: 1;
  width: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden auto;
  scrollbar-gutter: stable;
}

@supports not (scrollbar-gutter: stable) {
  .scope-tree-panel {
    overflow-y: scroll;
  }
}

.group-toggle-area {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 28px;
  padding: 0;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  user-select: none;
  border-radius: 8px;
}

.group-toggle-area:hover,
.group-toggle-area:focus-visible {
  color: var(--el-color-primary);
  outline: none;
  background: var(--el-fill-color-light);
}

.group-toggle-icon {
  width: 14px;
  height: 14px;
}

.group-header {
  padding: 4px 8px;
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
}

.service-header {
  padding: 4px 8px;
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
}

.group-header.group-node--checked,
.service-header.group-node--checked {
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary-light-7);
}

.doc-preview-html {
  flex: 1;
  width: 100%;
  min-width: 0;
  min-height: 0;
  line-height: 1.85;
  overflow-wrap: anywhere;
}

.doc-preview-html-content,
.doc-preview-virtual-block {
  width: 100%;
}

@supports (content-visibility: auto) {
  .doc-preview-html:deep(.doc-preview-virtual-block) {
    display: block;
    contain: content;
    content-visibility: auto;
    contain-intrinsic-size: auto 1200px;
  }
}

.doc-preview-html:deep(p) {
  margin: 0 0 14px;
}

.doc-preview-html:deep(li) {
  margin: 6px 0;
}

.doc-preview-html:deep(ul),
.doc-preview-html:deep(ol) {
  padding-left: 22px;
  margin: 10px 0 14px;
}

.doc-preview-html:deep(h1),
.doc-preview-html:deep(h2),
.doc-preview-html:deep(h3),
.doc-preview-html:deep(h4) {
  margin: 20px 0 12px;
  line-height: 1.45;
}

.group-submenu-wrap {
  width: 100%;
  min-width: 0;
  overflow: hidden;
}

.group-submenu-list {
  width: 100%;
  min-width: 0;
}

.group-submenu-list :deep(.group-submenu-item.el-checkbox) {
  display: flex;
  align-items: flex-start;
  width: 100%;
  min-width: 0;
  margin: 0;
}

.group-submenu-list :deep(.group-submenu-item .el-checkbox__label) {
  display: block;
  flex: 1;
  width: 0;
  min-width: 0;
  overflow: hidden;
}

.operation-label {
  display: block;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.operation-label__desc {
  color: var(--el-text-color-secondary);
}

.group-submenu-list
  :deep(.group-submenu-item.el-checkbox + .group-submenu-item.el-checkbox) {
  margin-top: 8px;
}

.group-submenu-motion-enter-active,
.group-submenu-motion-leave-active {
  overflow: hidden;
  transition:
    max-height 0.2s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.18s ease;
}

.group-submenu-motion-enter-from,
.group-submenu-motion-leave-to {
  max-height: 0;
  opacity: 0;
}

.group-submenu-motion-enter-to,
.group-submenu-motion-leave-from {
  max-height: 1000px;
  opacity: 1;
}

@media (max-width: 920px) {
  .export-format-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  :deep(.doc-export-dialog .el-dialog__header) {
    padding: 20px 20px 0;
  }

  :deep(.doc-export-dialog .el-dialog__body) {
    padding: 16px 20px 8px;
  }

  :deep(.doc-export-dialog .el-dialog__footer) {
    padding: 0 20px 20px;
  }

  .export-dialog-intro__title {
    font-size: 18px;
  }

  .export-format-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .export-format-card {
    min-height: 168px;
  }
}

@media (max-width: 520px) {
  .export-format-grid {
    grid-template-columns: 1fr;
  }
}
</style>
