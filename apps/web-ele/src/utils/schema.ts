import type { Schema } from '#/typings/openApi';

import { useApiStore } from '#/store';

export type SchemaViewMode = 'entity' | 'request' | 'response';

interface SchemaAdaptOptions {
  maxDepth?: number;
  mode?: SchemaViewMode;
}

interface GenerateExampleOptions {
  maxDepth?: number;
  mode?: SchemaViewMode;
}

const DEFAULT_MAX_DEPTH = 40;
const DEFAULT_SENTINEL = '##default';
const SCHEMA_REF_PREFIX = '#/components/schemas/';

const mergeUniqueStrings = (...valueGroups: Array<undefined | unknown[]>) => {
  const values = valueGroups.flatMap((group) =>
    (group || []).map((item) => `${item || ''}`.trim()).filter(Boolean),
  );
  return [...new Set(values)];
};

const hasSchemaComposition = (schema: any) => {
  return Boolean(
    (Array.isArray(schema?.oneOf) && schema.oneOf.length > 0) ||
      (Array.isArray(schema?.anyOf) && schema.anyOf.length > 0) ||
      (Array.isArray(schema?.allOf) && schema.allOf.length > 0),
  );
};

const hasSchemaStructuralShape = (schema: any) => {
  return Boolean(
    schema?.type ||
      (Array.isArray(schema?.types) && schema.types.length > 0) ||
      schema?.properties ||
      schema?.additionalProperties !== undefined ||
      schema?.maxProperties !== undefined ||
      schema?.minProperties !== undefined ||
      schema?.items ||
      (Array.isArray(schema?.prefixItems) && schema.prefixItems.length > 0) ||
      (Array.isArray(schema?.enum) && schema.enum.length > 0) ||
      hasSchemaComposition(schema),
  );
};

const isFreeFormSchema = (schema: any) => {
  if (!schema || typeof schema !== 'object') {
    return false;
  }
  return !hasSchemaStructuralShape(schema);
};

const inferSchemaType = (schema: any) => {
  if (schema?.type) {
    return schema.type;
  }
  if (Array.isArray(schema?.types) && schema.types.length > 0) {
    return schema.types[0];
  }
  if (
    schema?.properties ||
    schema?.additionalProperties !== undefined ||
    schema?.maxProperties !== undefined ||
    schema?.minProperties !== undefined
  ) {
    return 'object';
  }
  if (
    schema?.items ||
    (Array.isArray(schema?.prefixItems) && schema.prefixItems.length > 0)
  ) {
    return 'array';
  }
  if (Array.isArray(schema?.enum) && schema.enum.length > 0) {
    if (typeof schema.enum[0] === 'number') {
      return Number.isInteger(schema.enum[0]) ? 'integer' : 'number';
    }
    return typeof schema.enum[0];
  }
  if (isFreeFormSchema(schema)) {
    return 'any';
  }
  return '';
};

const parseExampleValue = (value: unknown) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }
  if (
    trimmed === 'true' ||
    trimmed === 'false' ||
    trimmed === 'null' ||
    /^-?\d+(?:\.\d+)?$/.test(trimmed) ||
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

const isPlainObject = (value: unknown): value is Record<string, any> => {
  if (Object.prototype.toString.call(value) !== '[object Object]') {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
};

const getSchemaMap = () => {
  try {
    return useApiStore().openApi?.components?.schemas ?? {};
  } catch {
    return {};
  }
};

const shouldIncludeByAccess = (
  schema: any,
  mode: SchemaViewMode = 'entity',
) => {
  if (!schema || typeof schema !== 'object') {
    return true;
  }
  if (schema.hidden === true) {
    return false;
  }
  const accessMode = `${schema.accessMode || ''}`.toUpperCase();
  const readOnly = Boolean(schema.readOnly) || accessMode === 'READ_ONLY';
  const writeOnly = Boolean(schema.writeOnly) || accessMode === 'WRITE_ONLY';

  if (mode === 'request' && readOnly) {
    return false;
  }
  if (mode === 'response' && writeOnly) {
    return false;
  }
  return true;
};

const mergeAllOfSchemas = (schemas: any[]) => {
  const merged: any = {
    properties: {},
    required: [],
    type: 'object',
  };

  schemas.forEach((schema) => {
    if (!schema || typeof schema !== 'object') {
      return;
    }

    if (schema.properties && typeof schema.properties === 'object') {
      Object.assign(merged.properties, schema.properties);
    }
    if (Array.isArray(schema.required)) {
      merged.required.push(...schema.required);
    }

    if (!merged.description && schema.description) {
      merged.description = schema.description;
    }
    if (!merged.title && schema.title) {
      merged.title = schema.title;
    }
    if (!merged.format && schema.format) {
      merged.format = schema.format;
    }
    if ((!merged.type || merged.type === 'object') && schema.type) {
      merged.type = schema.type;
    }
    if (merged.nullable !== true && schema.nullable === true) {
      merged.nullable = true;
    }
    if (merged.deprecated !== true && schema.deprecated === true) {
      merged.deprecated = true;
    }
  });

  merged.required = mergeUniqueStrings(merged.required);
  if (merged.required.length <= 0) {
    delete merged.required;
  }
  if (Object.keys(merged.properties).length <= 0) {
    delete merged.properties;
  }
  return merged;
};

const normalizeAdditionalProperties = (
  additionalProperties: any,
  options: Required<SchemaAdaptOptions>,
  resolvedRefs: Set<string>,
  depth: number,
) => {
  if (additionalProperties === undefined || additionalProperties === false) {
    return null;
  }
  if (additionalProperties === true) {
    return {
      description: '可扩展键值对',
      type: 'object',
      'x-nextdoc4j-additional': true,
    };
  }
  return {
    ...adaptSchemaInternal(
      additionalProperties,
      options,
      new Set(resolvedRefs),
      depth + 1,
    ),
    'x-nextdoc4j-additional': true,
  };
};

const adaptSchemaInternal = (
  inputSchema: any,
  options: Required<SchemaAdaptOptions>,
  resolvedRefs: Set<string>,
  depth: number,
): any => {
  if (inputSchema === null || inputSchema === undefined) {
    return null;
  }
  if (typeof inputSchema !== 'object') {
    return inputSchema;
  }
  if (depth > options.maxDepth) {
    return {
      description: 'schema depth exceeded',
      type: 'unknown',
    };
  }

  let schema = inputSchema;
  const nextResolvedRefs = new Set(resolvedRefs);
  const refName = parseSchemaRefName(schema.$ref);
  if (refName) {
    if (resolvedRefs.has(refName)) {
      return {
        ...schema,
        title: schema.title || refName,
        type: 'ref',
        'x-nextdoc4j-circular-ref': true,
      };
    }

    const refSchema = getSchemaMap()[refName];
    if (!refSchema) {
      return {
        ...schema,
        title: schema.title || refName,
        type: 'unknown',
      };
    }

    nextResolvedRefs.add(refName);
    const { $ref: _dropRef, ...localOverrides } = schema;
    schema = {
      ...refSchema,
      ...localOverrides,
      title: localOverrides.title || refSchema.title || refName,
    };
  }

  const adapted: any = { ...schema };
  adapted.type = inferSchemaType(schema);

  if (Array.isArray(schema.types) && schema.types.length > 0) {
    adapted.types = [...schema.types];
  }

  const required = mergeUniqueStrings(
    schema.required,
    schema.requiredProperties,
  );
  if (required.length > 0) {
    adapted.required = required;
  } else {
    delete adapted.required;
  }

  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    adapted.oneOf = schema.oneOf
      .map((item: any) =>
        adaptSchemaInternal(
          item,
          options,
          new Set(nextResolvedRefs),
          depth + 1,
        ),
      )
      .filter(Boolean);
  }

  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    adapted.anyOf = schema.anyOf
      .map((item: any) =>
        adaptSchemaInternal(
          item,
          options,
          new Set(nextResolvedRefs),
          depth + 1,
        ),
      )
      .filter(Boolean);
  }

  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    adapted.allOf = schema.allOf
      .map((item: any) =>
        adaptSchemaInternal(
          item,
          options,
          new Set(nextResolvedRefs),
          depth + 1,
        ),
      )
      .filter(Boolean);
    const merged = mergeAllOfSchemas(adapted.allOf);
    adapted['x-nextdoc4j-allOfMerged'] = merged;
  }

  const allOfMerged = adapted['x-nextdoc4j-allOfMerged'] || {};
  if (
    adapted.type === 'object' ||
    adapted.properties ||
    allOfMerged.properties ||
    adapted.additionalProperties !== undefined
  ) {
    const sourceProperties = {
      ...allOfMerged.properties,
      ...adapted.properties,
    };

    const nextProperties: Record<string, any> = {};
    Object.entries(sourceProperties).forEach(([key, value]) => {
      const child = adaptSchemaInternal(
        value,
        options,
        new Set(nextResolvedRefs),
        depth + 1,
      );
      if (!shouldIncludeByAccess(child, options.mode)) {
        return;
      }
      nextProperties[key] = child;
    });

    const additionalPropertySchema = normalizeAdditionalProperties(
      adapted.additionalProperties,
      options,
      nextResolvedRefs,
      depth,
    );
    if (additionalPropertySchema) {
      nextProperties['[key: string]'] = additionalPropertySchema;
    }

    adapted.properties = nextProperties;
    adapted.type = 'object';

    const nextRequired = mergeUniqueStrings(adapted.required).filter((key) =>
      Object.prototype.hasOwnProperty.call(nextProperties, key),
    );
    if (nextRequired.length > 0) {
      adapted.required = nextRequired;
    } else {
      delete adapted.required;
    }
  }

  if (
    adapted.type === 'array' ||
    adapted.items ||
    (Array.isArray(adapted.prefixItems) && adapted.prefixItems.length > 0)
  ) {
    if (adapted.items) {
      adapted.items = adaptSchemaInternal(
        adapted.items,
        options,
        new Set(nextResolvedRefs),
        depth + 1,
      );
    }
    if (Array.isArray(adapted.prefixItems)) {
      adapted.prefixItems = adapted.prefixItems
        .map((item: any) =>
          adaptSchemaInternal(
            item,
            options,
            new Set(nextResolvedRefs),
            depth + 1,
          ),
        )
        .filter(Boolean);
    }
    adapted.type = 'array';
  }

  if (Array.isArray(adapted.enum)) {
    adapted.enum = [...adapted.enum];
  }

  if (adapted.default === DEFAULT_SENTINEL) {
    delete adapted.default;
  }

  return adapted;
};

export function parseSchemaRefName(ref?: string) {
  if (!ref || !ref.startsWith(SCHEMA_REF_PREFIX)) {
    return '';
  }
  return ref.slice(SCHEMA_REF_PREFIX.length);
}

export function hasRenderableSchema(schema: any) {
  if (!schema || typeof schema !== 'object') {
    return false;
  }
  return Boolean(
    inferSchemaType(schema) ||
      schema.$ref ||
      schema.format ||
      schema.example !== undefined ||
      (Array.isArray(schema.examples) && schema.examples.length > 0) ||
      schema.default !== undefined,
  );
}

export function getSchemaTypeLabel(schema: any): string {
  if (!schema || typeof schema !== 'object') {
    return '-';
  }

  const schemaType = inferSchemaType(schema) || 'any';
  if (schemaType === 'array') {
    return `array<${getSchemaTypeLabel(schema.items)}>`;
  }

  if (schemaType === 'any') {
    return schema.title ? `any<${schema.title}>` : 'any';
  }

  const suffix = schema.format ? `<${schema.format}>` : '';
  if (schema.title && schemaType === 'object') {
    return `${schemaType}<${schema.title}>`;
  }
  return `${schemaType}${suffix}`;
}

export function adaptSchemaForView(
  schema: any,
  options: SchemaAdaptOptions = {},
) {
  const normalizedOptions: Required<SchemaAdaptOptions> = {
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    mode: options.mode ?? 'entity',
  };
  return adaptSchemaInternal(schema, normalizedOptions, new Set(), 0);
}

// 解析 Schema 引用
export function resolveSchema(
  schema: Schema,
  _resolvedRefs: Set<string> = new Set(),
): any {
  if (!schema) {
    return null;
  }
  try {
    const adapted = adaptSchemaForView(schema, {
      mode: 'entity',
    });
    if (!adapted?.$ref) {
      return adapted;
    }
    return adapted;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unknown error',
      type: 'error',
    };
  }
}

// 格式化描述文本
export function formatDescription(description?: string): string {
  if (!description) return '';

  // 处理枚举值说明，例如：{1=系统消息, 2=用户消息}
  // 处理 HTML 标签
  return description.replaceAll(/\{([^}]+)\}/g, (_, content) => {
    const items = content.split(',').map((item: string) => {
      const [key, value] = item.trim().split('=');
      return `<ElTag size="small" style="margin: 0 4px">${key}</ElTag> ${value}`;
    });
    return items.join('、');
  });
}

// 构建树形结构数据
export function buildSchemaTree(schema: Schema): any[] {
  if (!schema) {
    return [];
  }

  const normalized = adaptSchemaForView(schema, { mode: 'entity' });
  const nodes: any[] = [];
  const properties = normalized?.properties || {};
  const requiredSet = new Set<string>(normalized?.required || []);

  Object.entries(properties).forEach(([key, prop]: [string, any]) => {
    const children = buildSchemaTree(prop as Schema);
    nodes.push({
      children: children.length > 0 ? children : undefined,
      description: prop?.description,
      enum: prop?.enum,
      format: prop?.format,
      key,
      title: key + (requiredSet.has(key) ? ' *' : ''),
      type: prop?.type || 'unknown',
    });
  });

  return nodes;
}

// 格式化 JSON 示例
export function formatJson(data: any): string {
  if (!data) return '';

  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return '';
  }
}

const stringExampleByFormat = (format?: string) => {
  const normalized = `${format || ''}`.toLowerCase();
  switch (normalized) {
    case 'binary': {
      return '<binary>';
    }
    case 'byte': {
      return '<base64>';
    }
    case 'date': {
      return '2026-01-01';
    }
    case 'date-time': {
      return '2026-01-01T00:00:00Z';
    }
    case 'email': {
      return 'user@example.com';
    }
    case 'uri':
    case 'url': {
      return 'https://example.com';
    }
    case 'uuid': {
      return '123e4567-e89b-12d3-a456-426614174000';
    }
    default: {
      return 'string';
    }
  }
};

const generateExampleInternal = (
  schema: any,
  options: Required<GenerateExampleOptions>,
  seenObjects: WeakSet<object>,
  depth: number,
): any => {
  if (schema === null || schema === undefined) {
    return null;
  }
  if (depth > options.maxDepth) {
    return null;
  }
  if (typeof schema !== 'object') {
    return schema;
  }

  const normalized = adaptSchemaForView(schema, {
    mode: options.mode,
    maxDepth: options.maxDepth,
  });
  if (!normalized || typeof normalized !== 'object') {
    return null;
  }

  if (normalized.example !== undefined) {
    return parseExampleValue(normalized.example);
  }

  if (
    Array.isArray(normalized.examples) &&
    normalized.examples.length > 0 &&
    normalized.examples[0] !== undefined
  ) {
    return parseExampleValue(normalized.examples[0]);
  }

  if (
    normalized.default !== undefined &&
    normalized.default !== DEFAULT_SENTINEL
  ) {
    return parseExampleValue(normalized.default);
  }

  if (normalized._const !== undefined && normalized._const !== '') {
    return parseExampleValue(normalized._const);
  }

  if (Array.isArray(normalized.enum) && normalized.enum.length > 0) {
    return normalized.enum[0];
  }

  if (Array.isArray(normalized.oneOf) && normalized.oneOf.length > 0) {
    return generateExampleInternal(
      normalized.oneOf[0],
      options,
      seenObjects,
      depth + 1,
    );
  }

  if (Array.isArray(normalized.anyOf) && normalized.anyOf.length > 0) {
    return generateExampleInternal(
      normalized.anyOf[0],
      options,
      seenObjects,
      depth + 1,
    );
  }

  if (Array.isArray(normalized.allOf) && normalized.allOf.length > 0) {
    const mergedObject: Record<string, any> = {};
    let hasMerged = false;

    normalized.allOf.forEach((item: any) => {
      const value = generateExampleInternal(
        item,
        options,
        seenObjects,
        depth + 1,
      );
      if (isPlainObject(value)) {
        Object.assign(mergedObject, value);
        hasMerged = true;
      }
    });

    if (hasMerged) {
      return mergedObject;
    }
    return generateExampleInternal(
      normalized.allOf[0],
      options,
      seenObjects,
      depth + 1,
    );
  }

  const schemaType = inferSchemaType(normalized);
  switch (schemaType) {
    case 'any': {
      return {};
    }
    case 'array': {
      if (
        Array.isArray(normalized.prefixItems) &&
        normalized.prefixItems.length > 0
      ) {
        return normalized.prefixItems.map((item: any) =>
          generateExampleInternal(item, options, seenObjects, depth + 1),
        );
      }
      if (normalized.items) {
        return [
          generateExampleInternal(
            normalized.items,
            options,
            seenObjects,
            depth + 1,
          ),
        ];
      }
      return [];
    }
    case 'boolean': {
      return false;
    }
    case 'integer': {
      return normalized.format === 'int64' ? 0 : 1;
    }
    case 'number': {
      return 0;
    }
    case 'object': {
      if (seenObjects.has(normalized)) {
        return {};
      }
      seenObjects.add(normalized);

      const result: Record<string, any> = {};
      const properties = normalized.properties || {};

      Object.entries(properties).forEach(([key, value]) => {
        if ((value as any)?.['x-nextdoc4j-additional']) {
          return;
        }
        if (!shouldIncludeByAccess(value, options.mode)) {
          return;
        }
        result[key] = generateExampleInternal(
          value,
          options,
          seenObjects,
          depth + 1,
        );
      });

      if (Object.keys(result).length <= 0) {
        const additional = normalized.additionalProperties;
        if (additional === true) {
          result.key = 'string';
        } else if (additional && typeof additional === 'object') {
          result.key = generateExampleInternal(
            additional,
            options,
            seenObjects,
            depth + 1,
          );
        }
      }

      seenObjects.delete(normalized);
      return result;
    }
    case 'string': {
      return stringExampleByFormat(normalized.format);
    }
    default: {
      if (normalized.nullable === true) {
        return null;
      }
      if (normalized.properties) {
        return generateExampleInternal(
          { ...normalized, type: 'object' },
          options,
          seenObjects,
          depth + 1,
        );
      }
      return null;
    }
  }
};

// 生成 JSON 示例数据
export function generateExample(
  schema: Schema,
  options: GenerateExampleOptions = {},
): any {
  if (!schema) {
    return null;
  }
  const normalizedOptions: Required<GenerateExampleOptions> = {
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    mode: options.mode ?? 'entity',
  };
  return generateExampleInternal(schema, normalizedOptions, new WeakSet(), 0);
}

// 处理请求和响应的 schema
export const processSchema = (schema: Schema) => {
  if (!schema) {
    return {};
  }
  const adapted = adaptSchemaForView(schema, { mode: 'entity' });
  if (adapted?.properties) {
    return adapted.properties;
  }
  if (adapted?.items?.properties) {
    return adapted.items.properties;
  }
  return {};
};
