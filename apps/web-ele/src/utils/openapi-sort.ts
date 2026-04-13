import type {
  OpenAPISpec,
  OpenApiTagObject,
  PathItem,
  SwaggerConfig,
  SwaggerServiceItem,
} from '#/typings/openApi';

const naturalCollator = new Intl.Collator('zh-CN', {
  numeric: true,
  sensitivity: 'base',
});

const METHOD_ORDER = new Map<string, number>([
  ['delete', 4],
  ['get', 1],
  ['head', 6],
  ['options', 7],
  ['patch', 5],
  ['post', 2],
  ['put', 3],
  ['trace', 8],
]);

const TAG_SOURCE_NAME_KEYS = [
  'x-controller-name',
  'x-controller',
  'x-class-name',
  'x-origin-name',
  'controllerName',
  'controller',
  'className',
  'sourceName',
] as const;

interface MethodLike {
  method?: string;
}

interface NamedLike {
  name?: string;
}

interface NamedUrlLike extends NamedLike {
  url?: string;
  'x-order'?: number | string;
}

interface OperationLike extends MethodLike {
  'x-order'?: number | string;
  operationId?: string;
  path?: string;
  raw?: {
    'x-order'?: number | string;
  };
  summary?: string;
}

interface TagLike extends NamedLike {
  'x-order'?: number | string;
  [key: string]: any;
}

const isNonEmptyText = (value: unknown): value is string => {
  return typeof value === 'string' && value.trim().length > 0;
};

const toDisplayText = (value: unknown) => {
  if (value === null || value === undefined) {
    return '';
  }
  return `${value}`.trim();
};

const resolveOrderValue = (value: unknown): null | number => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const source =
    typeof value === 'object' && value
      ? (value as { 'x-order'?: number | string })['x-order']
      : value;

  if (source === null || source === undefined || source === '') {
    return null;
  }

  const order =
    typeof source === 'number' ? source : Number.parseFloat(`${source}`.trim());

  return Number.isFinite(order) ? order : null;
};

const compareOrderValue = (left: unknown, right: unknown) => {
  const leftOrder = resolveOrderValue(left);
  const rightOrder = resolveOrderValue(right);

  if (leftOrder === null && rightOrder === null) {
    return 0;
  }
  if (leftOrder === null) {
    return 1;
  }
  if (rightOrder === null) {
    return -1;
  }
  return leftOrder - rightOrder;
};

const normalizePathSegments = (path: string) => {
  return path.split('/').filter((segment) => segment.length > 0);
};

const unwrapPathSegment = (segment: string) => {
  return isPathParamSegment(segment) ? segment.slice(1, -1) : segment;
};

export const naturalCompare = (left: unknown, right: unknown) => {
  return naturalCollator.compare(toDisplayText(left), toDisplayText(right));
};

export const getMethodOrder = (method?: string) => {
  return METHOD_ORDER.get(toDisplayText(method).toLowerCase()) ?? 999;
};

export const isPathParamSegment = (segment: string) => {
  return /^\{[^/]+\}$/u.test(segment.trim());
};

export const compareUrlPath = (left: string, right: string) => {
  const leftSegments = normalizePathSegments(left);
  const rightSegments = normalizePathSegments(right);
  const maxLength = Math.max(leftSegments.length, rightSegments.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftSegment = leftSegments[index];
    const rightSegment = rightSegments[index];

    if (leftSegment === undefined) {
      return -1;
    }
    if (rightSegment === undefined) {
      return 1;
    }

    const leftIsParam = isPathParamSegment(leftSegment);
    const rightIsParam = isPathParamSegment(rightSegment);
    if (leftIsParam !== rightIsParam) {
      return leftIsParam ? 1 : -1;
    }

    const segmentCompare = naturalCompare(
      unwrapPathSegment(leftSegment),
      unwrapPathSegment(rightSegment),
    );
    if (segmentCompare !== 0) {
      return segmentCompare;
    }
  }

  return naturalCompare(left, right);
};

export const resolveTagSourceName = (tag?: null | TagLike) => {
  if (!tag) {
    return '';
  }

  for (const key of TAG_SOURCE_NAME_KEYS) {
    const value = tag[key];
    if (isNonEmptyText(value)) {
      return value.trim();
    }
  }

  return '';
};

export const compareTagLike = (
  left?: null | TagLike,
  right?: null | TagLike,
) => {
  const orderCompare = compareOrderValue(left, right);
  if (orderCompare !== 0) {
    return orderCompare;
  }

  const nameCompare = naturalCompare(left?.name, right?.name);
  if (nameCompare !== 0) {
    return nameCompare;
  }

  return naturalCompare(
    resolveTagSourceName(left),
    resolveTagSourceName(right),
  );
};

const findTagMeta = (spec: null | OpenAPISpec | undefined, tagName: string) => {
  return spec?.tags?.find((tag) => tag.name === tagName);
};

export const compareTagNames = (
  left: string,
  right: string,
  spec?: null | OpenAPISpec,
) => {
  const leftTag =
    findTagMeta(spec, left) || ({ name: left } as OpenApiTagObject);
  const rightTag =
    findTagMeta(spec, right) || ({ name: right } as OpenApiTagObject);
  return compareTagLike(leftTag, rightTag);
};

export const sortTagNames = (
  tags: string[] | undefined,
  spec?: null | OpenAPISpec,
) => {
  return [...(tags || [])].sort((left, right) =>
    compareTagNames(left, right, spec),
  );
};

export const compareNamedUrlLike = (
  left?: NamedUrlLike | null,
  right?: NamedUrlLike | null,
) => {
  const orderCompare = compareOrderValue(left, right);
  if (orderCompare !== 0) {
    return orderCompare;
  }

  const nameCompare = naturalCompare(left?.name, right?.name);
  if (nameCompare !== 0) {
    return nameCompare;
  }

  const urlCompare = compareUrlPath(left?.url || '', right?.url || '');
  if (urlCompare !== 0) {
    return urlCompare;
  }

  return naturalCompare(left?.url, right?.url);
};

export const compareSwaggerServiceItems = (
  left?: null | SwaggerServiceItem,
  right?: null | SwaggerServiceItem,
) => {
  return compareNamedUrlLike(left, right);
};

export const compareOperationLike = (
  left?: null | OperationLike,
  right?: null | OperationLike,
) => {
  const orderCompare = compareOrderValue(
    left?.raw ?? left,
    right?.raw ?? right,
  );
  if (orderCompare !== 0) {
    return orderCompare;
  }

  const summaryCompare = naturalCompare(left?.summary, right?.summary);
  if (summaryCompare !== 0) {
    return summaryCompare;
  }

  const pathCompare = compareUrlPath(left?.path || '', right?.path || '');
  if (pathCompare !== 0) {
    return pathCompare;
  }

  const methodCompare =
    getMethodOrder(left?.method) - getMethodOrder(right?.method);
  if (methodCompare !== 0) {
    return methodCompare;
  }

  const methodNameCompare = naturalCompare(left?.method, right?.method);
  if (methodNameCompare !== 0) {
    return methodNameCompare;
  }

  return naturalCompare(left?.operationId, right?.operationId);
};

const sortPathItem = (pathItem: PathItem, spec?: null | OpenAPISpec) => {
  const methodEntries: Array<[string, any]> = [];
  const otherEntries: Array<[string, any]> = [];

  Object.entries(pathItem || {}).forEach(([key, value]) => {
    const methodName = key.toLowerCase();
    if (METHOD_ORDER.has(methodName)) {
      methodEntries.push([
        key,
        value && typeof value === 'object'
          ? {
              ...value,
              ...(Array.isArray(value.tags)
                ? { tags: sortTagNames(value.tags, spec) }
                : {}),
            }
          : value,
      ]);
      return;
    }
    otherEntries.push([key, value]);
  });

  methodEntries.sort(([leftKey], [rightKey]) => {
    const orderCompare = getMethodOrder(leftKey) - getMethodOrder(rightKey);
    if (orderCompare !== 0) {
      return orderCompare;
    }
    return naturalCompare(leftKey, rightKey);
  });

  return Object.fromEntries([...methodEntries, ...otherEntries]) as PathItem;
};

export const sortSwaggerConfig = (config: null | SwaggerConfig | undefined) => {
  if (!config) {
    return config;
  }

  return {
    ...config,
    urls: [...(config.urls || [])].sort(compareSwaggerServiceItems),
  };
};

export const sortOpenApiSpec = (spec: null | OpenAPISpec | undefined) => {
  if (!spec) {
    return spec;
  }

  const sortedPaths = Object.fromEntries(
    Object.entries(spec.paths || {})
      .sort(([leftPath], [rightPath]) => compareUrlPath(leftPath, rightPath))
      .map(([path, pathItem]) => [path, sortPathItem(pathItem, spec)]),
  );

  return {
    ...spec,
    ...(Array.isArray(spec.tags)
      ? { tags: [...spec.tags].sort(compareTagLike) }
      : {}),
    paths: sortedPaths,
  };
};
