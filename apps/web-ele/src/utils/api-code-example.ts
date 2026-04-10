import type { ApiInfo, ParameterObject, SchemaObject } from '#/typings/openApi';

import X2JS from 'x2js';

import {
  adaptSchemaForView,
  generateExample,
  parseSchemaRefName,
} from '#/utils/schema';

export type CodeExampleLanguage = 'javascript' | 'typescript';

type BodyKind =
  | 'binary'
  | 'form-data'
  | 'json'
  | 'none'
  | 'raw'
  | 'x-www-form-urlencoded'
  | 'xml';

interface ExampleEntry {
  description?: string;
  format?: string;
  isBinary?: boolean;
  name: string;
  required?: boolean;
  schema?: SchemaObject;
  value: any;
}

interface CodeExampleBody {
  contentType: string;
  fields: ExampleEntry[];
  kind: BodyKind;
  metadata?: SchemaMetadata;
  originalSchema?: SchemaObject;
  required: boolean;
  schema?: any;
  value: any;
}

interface DeclarationState {
  blocksByName: Map<string, string>;
  order: string[];
  schemaMap: Record<string, SchemaObject>;
}

interface ExampleRootSchema {
  adaptedSchema: any;
  metadata?: SchemaMetadata;
  originalSchema?: SchemaObject;
}

interface ResponseDefinitionGroup extends ExampleRootSchema {
  codes: string[];
  signature: string;
}

interface SchemaMetadata {
  description?: string;
  refName?: string;
  title?: string;
}

export interface CodeExampleContext {
  body: CodeExampleBody | null;
  functionName: string;
  method: string;
  path: string;
  pathEntries: ExampleEntry[];
  queryEntries: ExampleEntry[];
  response: ExampleRootSchema | null;
  schemaMap: Record<string, SchemaObject>;
}

interface CodeExampleInput {
  info: ApiInfo;
  requestBodyType?: string;
  requestBodyVariantState?: Record<string, number>;
  schemaMap?: Record<string, SchemaObject>;
}

interface RenderArgument {
  exampleCode: string;
  kind: 'data' | 'params' | 'path';
  name: string;
  optional: boolean;
  type: string;
}

type TypeDefinitionScope = 'all' | 'request' | 'response';

const x2js = new X2JS({
  arrayAccessForm: 'none',
  attributePrefix: '_',
  datetimeAccessFormPaths: ['root.date'],
  ignoreRoot: false,
});

const isPlainObject = (value: unknown): value is Record<string, any> => {
  if (Object.prototype.toString.call(value) !== '[object Object]') {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
};

const capitalize = (value: string) => {
  if (!value) {
    return '';
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
};

const toCamelCase = (value: string) => {
  const parts = value
    .replaceAll(/[^A-Z0-9]+/gi, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length <= 0) {
    return '';
  }

  return parts
    .map((part, index) => {
      const normalized = part.toLowerCase();
      if (index === 0) {
        return normalized;
      }
      return capitalize(normalized);
    })
    .join('');
};

const escapeTemplateString = (value: string) => {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('`', '\\`')
    .replaceAll('${', '\\${');
};

const renderStringLiteral = (value: string) => {
  if (!value.includes('\n')) {
    return JSON.stringify(value);
  }
  return `\`${escapeTemplateString(value)}\``;
};

const renderValueLiteral = (value: any) => {
  if (typeof value === 'string') {
    return renderStringLiteral(value);
  }
  if (value === undefined) {
    return 'undefined';
  }
  return JSON.stringify(value, null, 2) ?? 'null';
};

const isValidIdentifier = (value: string) => /^[A-Za-z_$][\w$]*$/u.test(value);

const formatObjectKey = (value: string) => {
  return isValidIdentifier(value) ? value : JSON.stringify(value);
};

const renderMemberAccess = (source: string, key: string) => {
  return isValidIdentifier(key)
    ? `${source}.${key}`
    : `${source}[${JSON.stringify(key)}]`;
};

const renderCodeObjectLiteral = (
  entries: Array<{ code: string; name: string }>,
) => {
  if (entries.length <= 0) {
    return '{}';
  }

  return [
    '{',
    ...entries.flatMap((entry, index) => {
      const lines = entry.code.split('\n');
      const [firstLine = 'undefined', ...restLines] = lines;
      const propertyLines = [
        `  ${formatObjectKey(entry.name)}: ${firstLine}`,
        ...restLines.map((line) => `  ${line}`),
      ];

      const lastIndex = propertyLines.length - 1;
      if (index < entries.length - 1) {
        propertyLines[lastIndex] = `${propertyLines[lastIndex]},`;
      }

      return propertyLines;
    }),
    '}',
  ].join('\n');
};

const renderFunctionCall = (name: string, args: string[]) => {
  if (args.length <= 0) {
    return `${name}();`;
  }

  const multiline = args.length > 1 || args.some((arg) => arg.includes('\n'));
  if (!multiline) {
    return `${name}(${args[0]});`;
  }

  return [
    `${name}(`,
    ...args.flatMap((arg, index) => {
      const lines = arg.split('\n').map((line) => `  ${line}`);
      const lastIndex = lines.length - 1;
      if (index < args.length - 1) {
        lines[lastIndex] = `${lines[lastIndex]},`;
      }
      return lines;
    }),
    ');',
  ].join('\n');
};

const buildFunctionName = (info: ApiInfo) => {
  const byOperationId = toCamelCase(info.operationId || '');
  if (byOperationId) {
    return byOperationId;
  }

  const method = toCamelCase(info.method || 'request');
  const pathName = toCamelCase(
    info.path?.replaceAll(/\{([^}]+)\}/g, ' by $1 ').replaceAll('/', ' ') ||
      'api request',
  );
  const combined = `${method}${capitalize(pathName)}` || 'requestApi';
  return /^[A-Z_$]/i.test(combined)
    ? combined
    : `request${capitalize(combined)}`;
};

const resolveExampleValue = (schema?: SchemaObject, explicitExample?: any) => {
  if (explicitExample !== undefined) {
    return explicitExample;
  }
  if (!schema) {
    return '';
  }
  const nextValue = generateExample(schema, {
    mode: 'request',
  });
  return nextValue ?? '';
};

const normalizeRawBodyValue = (value: any) => {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    return '';
  }
  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    return String(value);
  }
};

const buildParameterEntries = (
  parameters: ParameterObject[] = [],
  location: ParameterObject['in'],
) => {
  return parameters
    .filter((item) => item.in === location)
    .map((item) => ({
      description: item.description,
      format: item.schema?.format,
      name: item.name,
      required: item.required,
      schema: item.schema,
      value: resolveExampleValue(item.schema, item.example),
    }));
};

const parseBodyContent = (requestBody?: ApiInfo['requestBody']) => {
  const content = requestBody?.content;
  if (!content) {
    return null;
  }

  const entries = Object.entries(content).filter(([, body]) =>
    Boolean((body as any)?.schema),
  );
  if (entries.length <= 0) {
    return null;
  }

  return (
    entries.find(([contentType]) =>
      contentType.toLowerCase().includes('application/json'),
    ) ||
    entries[0] ||
    null
  );
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
      current = mergeComposedSchema(
        base,
        current.oneOf[index] ?? current.oneOf[0],
      );
    } else if (Array.isArray(current.anyOf) && current.anyOf.length > 0) {
      const index = pickVariantIndex(path, current.anyOf);
      const base = { ...current };
      delete base.oneOf;
      delete base.anyOf;
      delete base.allOf;
      delete base['x-nextdoc4j-allOfMerged'];
      current = mergeComposedSchema(
        base,
        current.anyOf[index] ?? current.anyOf[0],
      );
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

const hasBinaryField = (schema: any): boolean => {
  if (!schema || typeof schema !== 'object') {
    return false;
  }
  if (schema.format === 'binary') {
    return true;
  }
  if (schema.type === 'array' && schema.items) {
    return hasBinaryField(schema.items);
  }
  if (schema.properties && typeof schema.properties === 'object') {
    return Object.values(schema.properties).some((value) =>
      hasBinaryField(value),
    );
  }
  return false;
};

const resolveBodyKind = (contentType: string, schema: any): BodyKind => {
  const normalizedContentType = `${contentType || ''}`.toLowerCase();

  if (normalizedContentType.includes('multipart/form-data')) {
    return 'form-data';
  }
  if (normalizedContentType.includes('x-www-form-urlencoded')) {
    return 'x-www-form-urlencoded';
  }
  if (normalizedContentType.includes('json')) {
    return 'json';
  }
  if (normalizedContentType.includes('xml')) {
    return 'xml';
  }
  if (normalizedContentType.startsWith('text/')) {
    return 'raw';
  }
  if (schema?.format === 'binary') {
    return 'binary';
  }
  if (hasBinaryField(schema)) {
    return 'form-data';
  }
  if (schema?.type === 'string') {
    return 'raw';
  }
  return 'json';
};

const toXmlExample = (value: any) => {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    return '';
  }
  try {
    const xml = x2js.js2xml(value);
    return `<?xml version="1.0" encoding="UTF-8"?><root>${xml}</root>`;
  } catch {
    return '<root></root>';
  }
};

const buildBodyFields = (schema: any, exampleValue: any) => {
  const properties =
    schema?.properties && typeof schema.properties === 'object'
      ? schema.properties
      : {};
  const required = new Set<string>(
    Array.isArray(schema?.required) ? schema.required : [],
  );
  const valueMap = isPlainObject(exampleValue) ? exampleValue : {};
  const names = new Set<string>([
    ...Object.keys(properties),
    ...Object.keys(valueMap),
  ]);

  return [...names].map((name) => {
    const propertySchema = properties[name];
    const propertyValue = Object.prototype.hasOwnProperty.call(valueMap, name)
      ? valueMap[name]
      : resolveExampleValue(propertySchema);

    const format =
      propertySchema?.type === 'array'
        ? propertySchema?.items?.format
        : propertySchema?.format;

    return {
      description: propertySchema?.description,
      format,
      isBinary: format === 'binary',
      name,
      required: required.has(name),
      schema: propertySchema,
      value: propertyValue,
    };
  });
};

const resolveSchemaMetadata = (
  schema: null | SchemaObject | undefined,
  schemaMap: Record<string, SchemaObject> = {},
): SchemaMetadata | undefined => {
  if (!schema || typeof schema !== 'object') {
    return undefined;
  }

  const refName = parseSchemaRefName(schema.$ref);
  const refSchema = refName ? schemaMap[refName] : undefined;
  const title = refName || refSchema?.title || schema.title || '';
  const description = refSchema?.description || schema.description || '';

  if (!refName && !title && !description) {
    return undefined;
  }

  return {
    description,
    refName,
    title,
  };
};

const resolveRequestBodyContext = (
  info: ApiInfo,
  schemaMap: Record<string, SchemaObject> = {},
  requestBodyType = '',
  requestBodyVariantState: Record<string, number> = {},
): CodeExampleBody | null => {
  const selected = parseBodyContent(info.requestBody);
  if (!selected) {
    return null;
  }

  const [contentType, body] = selected;
  const schema = (body as any)?.schema;
  if (!schema) {
    return null;
  }

  let resolvedSchema = schema;
  let originalSchema = schema as SchemaObject;
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    const variants = schema.oneOf
      .map((item: any, index: number) => {
        const adapted = adaptSchemaForView(item, {
          mode: 'request',
        });
        if (!adapted) {
          return null;
        }
        return {
          schema: adapted,
          variantKey: buildRequestBodyVariantKey(item, index),
        };
      })
      .filter(Boolean);

    resolvedSchema =
      variants.find((item: any) =>
        isMatchedRequestBodyVariant(item, requestBodyType),
      )?.schema ||
      variants[0]?.schema ||
      adaptSchemaForView(schema, { mode: 'request' });
    originalSchema =
      schema.oneOf.find((item: any, index: number) => {
        return isMatchedRequestBodyVariant(
          {
            variantKey: buildRequestBodyVariantKey(item, index),
            title: item?.title,
          },
          requestBodyType,
        );
      }) ||
      schema.oneOf[0] ||
      schema;
  } else {
    resolvedSchema = adaptSchemaForView(schema, {
      mode: 'request',
    });
  }

  resolvedSchema = applyRequestBodyVariantState(
    resolvedSchema,
    requestBodyVariantState,
  );

  const kind = resolveBodyKind(contentType, resolvedSchema);
  const exampleValue = generateExample(resolvedSchema, {
    mode: 'request',
  });
  const required = Boolean(info.requestBody?.required);
  const metadata = resolveSchemaMetadata(originalSchema, schemaMap);

  switch (kind) {
    case 'form-data':
    case 'x-www-form-urlencoded': {
      return {
        contentType,
        fields: buildBodyFields(resolvedSchema, exampleValue),
        kind,
        metadata,
        originalSchema,
        required,
        schema: resolvedSchema,
        value: exampleValue,
      };
    }
    case 'xml': {
      return {
        contentType,
        fields: [],
        kind,
        metadata,
        originalSchema,
        required,
        schema: resolvedSchema,
        value: toXmlExample(exampleValue),
      };
    }
    default: {
      let value = exampleValue;
      if (kind === 'binary') {
        value = null;
      } else if (kind === 'raw') {
        value = normalizeRawBodyValue(exampleValue);
      }

      return {
        contentType,
        fields: [],
        kind,
        metadata,
        originalSchema,
        required,
        schema: resolvedSchema,
        value,
      };
    }
  }
};

const pickContentSchema = (content?: Record<string, any>) => {
  if (!content) {
    return null;
  }

  return (
    content['application/json']?.schema ||
    content['*/*']?.schema ||
    Object.values(content).find((item) => Boolean((item as any)?.schema))
      ?.schema ||
    null
  );
};

const resolvePrimaryResponseSchema = (
  responses?: ApiInfo['responses'],
  schemaMap: Record<string, SchemaObject> = {},
): ExampleRootSchema | null => {
  if (!responses) {
    return null;
  }

  const orderedKeys = [
    '200',
    '201',
    '202',
    'default',
    ...Object.keys(responses),
  ];
  for (const key of new Set(orderedKeys)) {
    const response = responses[key];
    if (!response) {
      continue;
    }
    const schema = pickContentSchema(response.content) || response.schema;
    if (!schema) {
      continue;
    }
    return {
      adaptedSchema: adaptSchemaForView(schema, {
        mode: 'response',
      }),
      metadata: resolveSchemaMetadata(schema, schemaMap),
      originalSchema: schema,
    };
  }

  return null;
};

const inferTsTypeFromValue = (value: any): string => {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'unknown';
  }
  if (Array.isArray(value)) {
    if (value.length <= 0) {
      return 'unknown[]';
    }
    const itemTypes = [
      ...new Set(value.map((item) => inferTsTypeFromValue(item))),
    ];
    return itemTypes.length === 1
      ? `${itemTypes[0]}[]`
      : `Array<${itemTypes.join(' | ')}>`;
  }
  if (typeof value === 'string') {
    return 'string';
  }
  if (typeof value === 'number') {
    return 'number';
  }
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  if (isPlainObject(value)) {
    return 'Record<string, any>';
  }
  return 'unknown';
};

const withNullable = (schema: any, type: string) => {
  return schema?.nullable ? `${type} | null` : type;
};

const toTypeName = (value: string) => {
  const normalized = value
    .replaceAll(/[^A-Z0-9]+/gi, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((item) => capitalize(item))
    .join('');

  if (!normalized) {
    return 'AnonymousModel';
  }
  return /^[A-Z_$]/i.test(normalized) ? normalized : `T${normalized}`;
};

const toEnumMemberName = (value: string, index: number) => {
  const normalized = value
    .replaceAll(/[^A-Z0-9]+/gi, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((item) => capitalize(item.toLowerCase()))
    .join('');

  if (!normalized) {
    return `Value${index + 1}`;
  }
  return /^[A-Z_$]/i.test(normalized) ? normalized : `Value${index + 1}`;
};

const splitCommentLines = (text?: string) => {
  return `${text || ''}`
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
};

const renderDocComment = (lines: string[], indent = '') => {
  if (lines.length <= 0) {
    return [];
  }
  return [
    `${indent}/**`,
    ...lines.map((line) => `${indent} * ${line}`),
    `${indent} */`,
  ];
};

const buildMetadataCommentLines = (metadata?: SchemaMetadata) => {
  const label = metadata?.refName || metadata?.title || '';
  const description = metadata?.description?.trim() || '';
  if (label && description) {
    return [`${label}，${description}`];
  }
  if (label) {
    return [label];
  }
  if (description) {
    return [description];
  }
  return [];
};

const buildResponseCommentLines = (
  metadata?: SchemaMetadata,
  codes: string[] = [],
) => {
  const lines = buildMetadataCommentLines(metadata);
  if (codes.length > 0) {
    lines.push(`状态码：${codes.join(', ')}`);
  }
  return [...new Set(lines.filter(Boolean))];
};

const resolveSchemaSource = (
  schema: any,
  schemaMap: Record<string, SchemaObject>,
  seenRefs = new Set<string>(),
): any => {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  let current = schema;
  const refName = parseSchemaRefName(current.$ref);
  if (refName && !seenRefs.has(refName)) {
    const refSchema = schemaMap[refName];
    if (refSchema) {
      seenRefs.add(refName);
      const { $ref: _dropRef, ...localOverrides } = current;
      current = {
        ...resolveSchemaSource(refSchema, schemaMap, seenRefs),
        ...localOverrides,
      };
    }
  }

  if (Array.isArray(current.allOf) && current.allOf.length > 0) {
    const merged: any = {
      ...current,
      properties: {},
    };
    delete merged.allOf;

    const required = [
      ...(Array.isArray(current.required) ? current.required : []),
    ];
    current.allOf.forEach((item: any) => {
      const resolved = resolveSchemaSource(item, schemaMap, new Set(seenRefs));
      if (!resolved || typeof resolved !== 'object') {
        return;
      }
      if (resolved.properties && typeof resolved.properties === 'object') {
        Object.assign(merged.properties, resolved.properties);
      }
      if (Array.isArray(resolved.required)) {
        required.push(...resolved.required);
      }
      if (!merged.description && resolved.description) {
        merged.description = resolved.description;
      }
      if (!merged.title && resolved.title) {
        merged.title = resolved.title;
      }
      if (!merged.type && resolved.type) {
        merged.type = resolved.type;
      }
      if (
        merged.additionalProperties === undefined &&
        resolved.additionalProperties !== undefined
      ) {
        merged.additionalProperties = resolved.additionalProperties;
      }
    });

    if (current.properties && typeof current.properties === 'object') {
      Object.assign(merged.properties, current.properties);
    }
    if (Object.keys(merged.properties).length <= 0) {
      delete merged.properties;
    }
    if (required.length > 0) {
      merged.required = [...new Set(required)];
    } else {
      delete merged.required;
    }
    current = merged;
  }

  return current;
};

const wrapArrayType = (type: string) => {
  const normalized = type.trim() || 'unknown';
  return /^[A-Za-z_$][\w$]*$/u.test(normalized)
    ? `${normalized}[]`
    : `Array<${normalized}>`;
};

const buildSchemaShapeSignature = (schema: any) => {
  const stack = new WeakSet<object>();

  const visit = (value: any): string => {
    if (value === null) {
      return 'null';
    }
    if (value === undefined) {
      return 'undefined';
    }
    if (typeof value !== 'object') {
      return JSON.stringify(value);
    }
    if (stack.has(value)) {
      return `circular:${value?.title || value?.type || 'object'}`;
    }

    stack.add(value);
    try {
      const nullable = value?.nullable ? '|null' : '';

      if (value?.['x-nextdoc4j-circular-ref'] || value?.type === 'ref') {
        return `ref:${value?.title || value?.$ref || 'anonymous'}${nullable}`;
      }

      if (Array.isArray(value?.enum) && value.enum.length > 0) {
        return `enum(${value.enum.map((item: any) => JSON.stringify(item)).join('|')})${nullable}`;
      }

      if (Array.isArray(value?.oneOf) && value.oneOf.length > 0) {
        return `oneOf(${value.oneOf
          .map((item: any) => visit(item))
          .sort()
          .join('|')})${nullable}`;
      }

      if (Array.isArray(value?.anyOf) && value.anyOf.length > 0) {
        return `anyOf(${value.anyOf
          .map((item: any) => visit(item))
          .sort()
          .join('|')})${nullable}`;
      }

      if (Array.isArray(value?.allOf) && value.allOf.length > 0) {
        return `allOf(${value.allOf
          .map((item: any) => visit(item))
          .sort()
          .join('&')})${nullable}`;
      }

      if (
        (value?.properties && typeof value.properties === 'object') ||
        value?.additionalProperties !== undefined
      ) {
        const requiredSet = new Set<string>(value?.required || []);
        const propertySignature = Object.keys(value?.properties || {})
          .sort()
          .map((key) => {
            return `${JSON.stringify(key)}${requiredSet.has(key) ? '!' : '?'}:${visit(value.properties[key])}`;
          })
          .join(',');
        let additionalSignature = '';
        if (value?.additionalProperties === true) {
          additionalSignature = '|additional:true';
        } else if (value?.additionalProperties === false) {
          additionalSignature = '|additional:false';
        } else if (value?.additionalProperties !== undefined) {
          additionalSignature = `|additional:${visit(value.additionalProperties)}`;
        }

        return `object{${propertySignature}}${additionalSignature}${nullable}`;
      }

      if (
        `${value?.type || ''}`.toLowerCase() === 'array' ||
        value?.items ||
        (Array.isArray(value?.prefixItems) && value.prefixItems.length > 0)
      ) {
        const itemSignature = value?.items ? visit(value.items) : 'unknown';
        const prefixSignature = Array.isArray(value?.prefixItems)
          ? `|prefix:${value.prefixItems.map((item: any) => visit(item)).join(',')}`
          : '';
        return `array<${itemSignature}>${prefixSignature}${nullable}`;
      }

      return `${value?.type || 'unknown'}:${value?.format || ''}${nullable}`;
    } finally {
      stack.delete(value);
    }
  };

  return visit(schema);
};

const createDeclarationState = (schemaMap: Record<string, SchemaObject>) => {
  return {
    blocksByName: new Map<string, string>(),
    order: [],
    schemaMap,
  } satisfies DeclarationState;
};

const buildResponseDefinitionGroups = (
  responseDefinitions: Array<
    | null
    | undefined
    | {
        adaptedSchema?: any;
        code?: string;
        metadata?: SchemaMetadata;
        schema: any;
      }
  >,
): ResponseDefinitionGroup[] => {
  const groups: ResponseDefinitionGroup[] = [];

  responseDefinitions.forEach((item) => {
    if (!item?.schema) {
      return;
    }

    const adaptedSchema =
      item.adaptedSchema ||
      adaptSchemaForView(item.schema, {
        mode: 'response',
      });

    if (!adaptedSchema) {
      return;
    }

    const signature = buildSchemaShapeSignature(adaptedSchema);
    const existingGroup = groups.find((group) => group.signature === signature);

    if (existingGroup) {
      if (item.code && !existingGroup.codes.includes(item.code)) {
        existingGroup.codes.push(item.code);
      }
      return;
    }

    groups.push({
      adaptedSchema,
      codes: item.code ? [item.code] : [],
      metadata: item.metadata,
      originalSchema: item.schema,
      signature,
    });
  });

  return groups;
};

const buildResponseTypeName = (codes: string[], index: number) => {
  if (codes.length <= 0) {
    return index === 0 ? 'Response' : `Response${index + 1}`;
  }
  return toTypeName(`Response ${codes[0]}`);
};

const pickDeclarationName = (
  preferredName: null | string | undefined,
  rawSchema: any,
  adaptedSchema: any,
  fallbackName: string,
) => {
  const refName = parseSchemaRefName(rawSchema?.$ref);
  return toTypeName(
    refName ||
      rawSchema?.title ||
      adaptedSchema?.title ||
      preferredName ||
      fallbackName,
  );
};

const renderDefaultEntryCode = (entry: ExampleEntry) => {
  if (entry.isBinary || entry.format === 'binary') {
    return "new File([''], 'example.bin')";
  }
  return renderValueLiteral(entry.value);
};

const renderBodyExampleCode = (body: CodeExampleBody) => {
  switch (body.kind) {
    case 'binary': {
      return "new File([''], 'example.bin')";
    }
    case 'form-data':
    case 'x-www-form-urlencoded': {
      return renderCodeObjectLiteral(
        body.fields.map((field) => ({
          code: renderDefaultEntryCode(field),
          name: field.name,
        })),
      );
    }
    default: {
      return renderValueLiteral(body.value);
    }
  }
};

const buildUrlExpression = (
  path: string,
  accessResolver: (name: string) => string,
) => {
  if (!/\{[^}]+\}/u.test(path)) {
    return renderStringLiteral(path);
  }

  const template = escapeTemplateString(path).replaceAll(
    /\{([^}]+)\}/g,
    (_, name: string) =>
      `\${encodeURIComponent(String(${accessResolver(name)}))}`,
  );
  return `\`${template}\``;
};

const renderFormDataHelper = (
  helperName: string,
  body: CodeExampleBody,
  requestTypeName: string,
  isTypeScript: boolean,
) => {
  const formDataType = isTypeScript ? ': FormData' : '';
  const keyType = isTypeScript ? ': string' : '';
  const valueType = isTypeScript ? ': unknown' : '';
  const dataType = isTypeScript ? `: ${requestTypeName}` : '';

  return [
    `function appendFormDataValue(formData${formDataType}, key${keyType}, value${valueType}) {`,
    '  if (value === undefined || value === null) {',
    '    return;',
    '  }',
    '  if (Array.isArray(value)) {',
    '    value.forEach((item) => appendFormDataValue(formData, key, item));',
    '    return;',
    '  }',
    '  if (value instanceof Blob) {',
    '    formData.append(key, value);',
    '    return;',
    '  }',
    "  formData.append(key, typeof value === 'string' ? value : JSON.stringify(value));",
    '}',
    '',
    `function ${helperName}(data${dataType}) {`,
    '  const formData = new FormData();',
    ...body.fields.map((field) => {
      return `  appendFormDataValue(formData, ${JSON.stringify(field.name)}, ${renderMemberAccess('data', field.name)});`;
    }),
    '  return formData;',
    '}',
  ].join('\n');
};

const renderSearchParamsHelper = (
  helperName: string,
  body: CodeExampleBody,
  requestTypeName: string,
  isTypeScript: boolean,
) => {
  const paramsType = isTypeScript ? ': URLSearchParams' : '';
  const keyType = isTypeScript ? ': string' : '';
  const valueType = isTypeScript ? ': unknown' : '';
  const dataType = isTypeScript ? `: ${requestTypeName}` : '';

  return [
    `function appendSearchParam(searchParams${paramsType}, key${keyType}, value${valueType}) {`,
    '  if (value === undefined || value === null) {',
    '    return;',
    '  }',
    '  if (Array.isArray(value)) {',
    '    value.forEach((item) => appendSearchParam(searchParams, key, item));',
    '    return;',
    '  }',
    "  searchParams.append(key, typeof value === 'string' ? value : JSON.stringify(value));",
    '}',
    '',
    `function ${helperName}(data${dataType}) {`,
    '  const searchParams = new URLSearchParams();',
    ...body.fields.map((field) => {
      return `  appendSearchParam(searchParams, ${JSON.stringify(field.name)}, ${renderMemberAccess('data', field.name)});`;
    }),
    '  return searchParams;',
    '}',
  ].join('\n');
};

const ensureNamedDeclaration = (
  preferredName: string,
  rawSchema: any,
  adaptedSchema: any,
  state: DeclarationState,
  mode: 'request' | 'response',
) => {
  const name = toTypeName(preferredName);
  if (state.blocksByName.has(name)) {
    return name;
  }

  const block = renderNamedDeclarationBlock(
    name,
    rawSchema,
    adaptedSchema,
    state,
    mode,
  );
  state.blocksByName.set(name, block);
  state.order.push(name);
  return name;
};

const resolveTsTypeExpression = (
  rawSchema: any,
  adaptedSchema: any,
  state: DeclarationState,
  mode: 'request' | 'response',
  suggestedName: string,
): string => {
  const rawResolved = resolveSchemaSource(rawSchema, state.schemaMap);
  const normalized =
    adaptedSchema ||
    (rawSchema
      ? adaptSchemaForView(rawSchema, {
          mode,
        })
      : null);

  if (!normalized || typeof normalized !== 'object') {
    return 'unknown';
  }

  const schemaType = `${normalized.type || ''}`.toLowerCase();

  if (Array.isArray(normalized.enum) && normalized.enum.length > 0) {
    const enumName = ensureNamedDeclaration(
      pickDeclarationName(suggestedName, rawSchema, normalized, suggestedName),
      rawSchema,
      normalized,
      state,
      mode,
    );
    return withNullable(normalized, enumName);
  }

  if (Array.isArray(normalized.oneOf) && normalized.oneOf.length > 0) {
    const rawOptions = Array.isArray(rawResolved?.oneOf)
      ? rawResolved.oneOf
      : [];
    const unionType = [
      ...new Set(
        normalized.oneOf.map((item: any, index: number) =>
          resolveTsTypeExpression(
            rawOptions[index],
            item,
            state,
            mode,
            `${suggestedName}${index + 1}`,
          ),
        ),
      ),
    ].join(' | ');
    return withNullable(normalized, unionType || 'unknown');
  }

  if (Array.isArray(normalized.anyOf) && normalized.anyOf.length > 0) {
    const rawOptions = Array.isArray(rawResolved?.anyOf)
      ? rawResolved.anyOf
      : [];
    const unionType = [
      ...new Set(
        normalized.anyOf.map((item: any, index: number) =>
          resolveTsTypeExpression(
            rawOptions[index],
            item,
            state,
            mode,
            `${suggestedName}${index + 1}`,
          ),
        ),
      ),
    ].join(' | ');
    return withNullable(normalized, unionType || 'unknown');
  }

  if (
    (normalized.properties && typeof normalized.properties === 'object') ||
    normalized.additionalProperties !== undefined
  ) {
    const modelName = ensureNamedDeclaration(
      pickDeclarationName(suggestedName, rawSchema, normalized, suggestedName),
      rawSchema,
      normalized,
      state,
      mode,
    );
    return withNullable(normalized, modelName);
  }

  switch (schemaType) {
    case 'any': {
      return withNullable(normalized, 'any');
    }
    case 'array': {
      const itemType = resolveTsTypeExpression(
        rawResolved?.items,
        normalized.items,
        state,
        mode,
        `${suggestedName}Item`,
      );
      return withNullable(normalized, wrapArrayType(itemType));
    }
    case 'boolean': {
      return withNullable(normalized, 'boolean');
    }
    case 'integer':
    case 'number': {
      return withNullable(normalized, 'number');
    }
    case 'string': {
      if (normalized.format === 'date' || normalized.format === 'date-time') {
        return withNullable(normalized, 'Date');
      }
      return withNullable(
        normalized,
        normalized.format === 'binary' ? 'File | Blob' : 'string',
      );
    }
    default: {
      return withNullable(normalized, inferTsTypeFromValue(undefined));
    }
  }
};

const renderNamedDeclarationBlock = (
  name: string,
  rawSchema: any,
  adaptedSchema: any,
  state: DeclarationState,
  mode: 'request' | 'response',
  commentLines: string[] = buildMetadataCommentLines(
    resolveSchemaMetadata(rawSchema, state.schemaMap),
  ),
) => {
  const rawResolved = resolveSchemaSource(rawSchema, state.schemaMap);
  const normalized =
    adaptedSchema ||
    (rawSchema
      ? adaptSchemaForView(rawSchema, {
          mode,
        })
      : null);

  const lines: string[] = [];
  lines.push(...renderDocComment(commentLines));

  if (
    normalized &&
    Array.isArray(normalized.enum) &&
    normalized.enum.length > 0
  ) {
    lines.push(`export enum ${name} {`);
    normalized.enum.forEach((value: any, index: number) => {
      lines.push(
        `  ${toEnumMemberName(String(value), index)} = ${renderValueLiteral(value)},`,
      );
    });
    lines.push('}');
    return lines.join('\n');
  }

  const hasObjectShape = Boolean(
    normalized &&
      ((normalized.properties && typeof normalized.properties === 'object') ||
        normalized.additionalProperties !== undefined),
  );

  if (hasObjectShape) {
    const properties = normalized?.properties || {};
    const rawProperties = rawResolved?.properties || {};
    const requiredSet = new Set<string>(normalized?.required || []);

    lines.push(`export interface ${name} {`);
    Object.entries(properties).forEach(([key, value]) => {
      lines.push(
        ...renderDocComment(
          splitCommentLines(
            (value as any)?.description || rawProperties[key]?.description,
          ),
          '  ',
        ),
        `  ${formatObjectKey(key)}${requiredSet.has(key) ? '' : '?'}: ${resolveTsTypeExpression(
          rawProperties[key],
          value,
          state,
          mode,
          `${name}${toTypeName(key)}`,
        )};`,
      );
    });
    lines.push('  [property: string]: any;', '}');
    return lines.join('\n');
  }

  const typeExpression = resolveTsTypeExpression(
    rawResolved,
    normalized,
    state,
    mode,
    `${name}Value`,
  );
  lines.push(`export type ${name} = ${typeExpression};`);
  return lines.join('\n');
};

const renderEntriesInterfaceBlock = (
  name: string,
  entries: ExampleEntry[],
  state: DeclarationState,
) => {
  const lines: string[] = [`export interface ${name} {`];
  entries.forEach((entry) => {
    lines.push(
      ...renderDocComment(splitCommentLines(entry.description), '  '),
      `  ${formatObjectKey(entry.name)}${entry.required ? '' : '?'}: ${resolveTsTypeExpression(
        entry.schema,
        entry.schema
          ? adaptSchemaForView(entry.schema, {
              mode: 'request',
            })
          : null,
        state,
        'request',
        `${name}${toTypeName(entry.name)}`,
      )};`,
    );
  });
  lines.push('  [property: string]: any;', '}');
  return lines.join('\n');
};

const buildRenderArguments = (context: CodeExampleContext) => {
  const args: RenderArgument[] = [];

  if (context.pathEntries.length > 0) {
    args.push({
      exampleCode: renderCodeObjectLiteral(
        context.pathEntries.map((entry) => ({
          code: renderDefaultEntryCode(entry),
          name: entry.name,
        })),
      ),
      kind: 'path',
      name: 'path',
      optional: false,
      type: 'Path',
    });
  }

  if (context.queryEntries.length > 0) {
    args.push({
      exampleCode: renderCodeObjectLiteral(
        context.queryEntries.map((entry) => ({
          code: renderDefaultEntryCode(entry),
          name: entry.name,
        })),
      ),
      kind: 'params',
      name: 'query',
      optional: !context.queryEntries.some((entry) => entry.required),
      type: 'Query',
    });
  }

  if (context.body) {
    args.push({
      exampleCode: renderBodyExampleCode(context.body),
      kind: 'data',
      name: 'data',
      optional: !context.body.required,
      type: 'Request',
    });
  }

  return args;
};

const buildTypeSections = (
  context: CodeExampleContext,
  scope: TypeDefinitionScope = 'all',
  responseGroups?: ResponseDefinitionGroup[],
) => {
  const lines: string[] = [];
  const state = createDeclarationState(context.schemaMap);
  const includeRequest = scope === 'all' || scope === 'request';
  const includeResponse = scope === 'all' || scope === 'response';
  const effectiveResponseGroups =
    responseGroups ||
    (context.response
      ? [
          {
            ...context.response,
            codes: [],
            signature: buildSchemaShapeSignature(
              context.response.adaptedSchema,
            ),
          },
        ]
      : []);

  const pushSection = (label: string, render: () => string) => {
    const startIndex = state.order.length;
    const rootBlock = render();
    const nestedBlocks = state.order
      .slice(startIndex)
      .map((name) => state.blocksByName.get(name))
      .filter(Boolean) as string[];

    lines.push(`// ${label}`, rootBlock);
    nestedBlocks.forEach((block) => {
      lines.push('', block);
    });
    lines.push('');
  };

  if (includeRequest && context.pathEntries.length > 0) {
    pushSection('path', () =>
      renderEntriesInterfaceBlock('Path', context.pathEntries, state),
    );
  }

  if (includeRequest && context.queryEntries.length > 0) {
    pushSection('query', () =>
      renderEntriesInterfaceBlock('Query', context.queryEntries, state),
    );
  }

  if (includeRequest && context.body) {
    const requestBody = context.body;
    pushSection('body', () =>
      renderNamedDeclarationBlock(
        'Request',
        requestBody.originalSchema,
        requestBody.schema,
        state,
        'request',
        buildMetadataCommentLines(requestBody.metadata),
      ),
    );
  }

  if (includeResponse && effectiveResponseGroups.length > 0) {
    const useSharedResponseName = effectiveResponseGroups.length === 1;

    effectiveResponseGroups.forEach((responseSchema, index) => {
      pushSection(
        responseSchema.codes.length > 0
          ? `response ${responseSchema.codes.join(', ')}`
          : 'response',
        () =>
          renderNamedDeclarationBlock(
            useSharedResponseName
              ? 'Response'
              : buildResponseTypeName(responseSchema.codes, index),
            responseSchema.originalSchema,
            responseSchema.adaptedSchema,
            state,
            'response',
            buildResponseCommentLines(
              responseSchema.metadata,
              responseSchema.codes,
            ),
          ),
      );
    });
  }

  return lines;
};

export function buildCodeExampleContext(
  input: CodeExampleInput,
): CodeExampleContext {
  const schemaMap = input.schemaMap || {};

  return {
    body: resolveRequestBodyContext(
      input.info,
      schemaMap,
      input.requestBodyType,
      input.requestBodyVariantState,
    ),
    functionName: buildFunctionName(input.info),
    method: input.info.method?.toUpperCase?.() || 'GET',
    path: input.info.path || '/',
    pathEntries: buildParameterEntries(input.info.parameters, 'path'),
    queryEntries: buildParameterEntries(input.info.parameters, 'query'),
    response: resolvePrimaryResponseSchema(input.info.responses, schemaMap),
    schemaMap,
  };
}

export function renderTypeDefinitions(
  input: CodeExampleInput & {
    responseOverride?: null | {
      adaptedSchema?: any;
      code?: string;
      metadata?: {
        description?: string;
        refName?: string;
        title?: string;
      };
      schema: any;
    };
    responseOverrides?: Array<{
      adaptedSchema?: any;
      code?: string;
      metadata?: {
        description?: string;
        refName?: string;
        title?: string;
      };
      schema: any;
    }>;
    scope?: TypeDefinitionScope;
  },
) {
  const context = buildCodeExampleContext(input);
  let responseGroups: ResponseDefinitionGroup[] | undefined;

  if (input.responseOverrides !== undefined) {
    responseGroups = buildResponseDefinitionGroups(input.responseOverrides);
    const [firstResponseGroup] = responseGroups;
    context.response = firstResponseGroup
      ? {
          adaptedSchema: firstResponseGroup.adaptedSchema,
          metadata: firstResponseGroup.metadata,
          originalSchema: firstResponseGroup.originalSchema,
        }
      : null;
  }

  if (input.responseOverride !== undefined) {
    const responseOverride = input.responseOverride;
    context.response = responseOverride
      ? {
          adaptedSchema:
            responseOverride.adaptedSchema ||
            adaptSchemaForView(responseOverride.schema, {
              mode: 'response',
            }),
          metadata: responseOverride.metadata,
          originalSchema: responseOverride.schema,
        }
      : null;
    responseGroups =
      responseOverride === null
        ? []
        : buildResponseDefinitionGroups([responseOverride]);
  }

  return buildTypeSections(context, input.scope, responseGroups)
    .join('\n')
    .trim();
}

export function renderCodeExample(
  context: CodeExampleContext,
  language: CodeExampleLanguage,
) {
  const isTypeScript = language === 'typescript';
  const method = (context.method || 'GET').toLowerCase();
  const baseName = capitalize(context.functionName) || 'ApiRequest';
  const argumentsList = buildRenderArguments(context);
  const lines: string[] = ['// request 请替换成你项目里的统一请求方法'];

  if (isTypeScript) {
    lines.push('', ...buildTypeSections(context));
  }

  let helperName = '';
  if (context.body?.kind === 'form-data') {
    helperName = `to${baseName}FormData`;
  } else if (context.body?.kind === 'x-www-form-urlencoded') {
    helperName = `to${baseName}SearchParams`;
  }

  if (context.body?.kind === 'form-data') {
    lines.push(
      renderFormDataHelper(helperName, context.body, 'Request', isTypeScript),
      '',
    );
  } else if (context.body?.kind === 'x-www-form-urlencoded') {
    lines.push(
      renderSearchParamsHelper(
        helperName,
        context.body,
        'Request',
        isTypeScript,
      ),
      '',
    );
  }

  const signature = argumentsList
    .map((arg) => {
      if (!isTypeScript) {
        return arg.name;
      }
      return `${arg.name}${arg.optional ? '?' : ''}: ${arg.type}`;
    })
    .join(', ');

  lines.push(
    `export function ${context.functionName}(${signature}) {`,
    `  return request${isTypeScript ? '<Response>' : ''}({`,
    `    url: ${buildUrlExpression(context.path, (name) =>
      renderMemberAccess('path', name),
    )},`,
    `    method: '${method}',`,
  );

  const queryArgument = argumentsList.find((item) => item.kind === 'params');
  if (queryArgument) {
    lines.push(`    params: ${queryArgument.name},`);
  }

  const dataArgument = argumentsList.find((item) => item.kind === 'data');
  if (dataArgument) {
    const isTransformedBody =
      context.body?.kind === 'form-data' ||
      context.body?.kind === 'x-www-form-urlencoded';
    let requestDataExpression = dataArgument.name;

    if (isTransformedBody) {
      requestDataExpression = dataArgument.optional
        ? `${dataArgument.name} ? ${helperName}(${dataArgument.name}) : undefined`
        : `${helperName}(${dataArgument.name})`;
    }

    lines.push(`    data: ${requestDataExpression},`);
  }

  lines.push(
    '  });',
    '}',
    '',
    '// 调用示例',
    renderFunctionCall(
      context.functionName,
      argumentsList.map((arg) => arg.exampleCode),
    ),
  );

  return lines.join('\n');
}
