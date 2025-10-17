import type { Schema } from '#/typings/openApi';

import { useApiStore } from '#/store';

// 解析 Schema 引用
export function resolveSchema(
  schema: Schema,
  resolvedRefs: Set<string> = new Set(),
): any {
  if (!schema) return null;
  const { openApi } = useApiStore();
  if (!openApi) return null;
  try {
    // 处理引用
    if (schema.$ref) {
      const ref = schema.$ref.replace('#/components/schemas/', '');
      if (resolvedRefs.has(ref)) {
        return { type: 'ref', title: ref };
      }

      const resolved = openApi.components?.schemas?.[ref];

      if (!resolved) {
        return { type: 'unknown', title: ref };
      }

      resolvedRefs.add(ref);

      const resolvedSchema = resolveSchema(resolved, resolvedRefs);

      return {
        ...resolvedSchema,
        title: ref,
      };
    }

    // 处理对象
    if (schema.type === 'object' || schema.properties) {
      const properties: Record<string, any> = {};
      for (const [key, value] of Object.entries(schema.properties || {})) {
        if (value) {
          properties[key] = resolveSchema(value as any, new Set(resolvedRefs));
        }
      }
      return {
        ...schema,
        type: 'object',
        properties,
        required: schema.required || [],
      };
    }

    // 处理数组
    if (schema.type === 'array' && schema.items) {
      return {
        ...schema,
        type: 'array',
        items: resolveSchema(schema.items, resolvedRefs),
      };
    }

    // 处理基本类型
    return schema;
  } catch (error) {
    return {
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
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
  if (!schema) return [];

  const nodes: any[] = [];

  // 处理 oneOf
  if (schema.type === 'oneOf' && schema.oneOf) {
    schema.oneOf.forEach((item: any, index: number) => {
      const node = {
        key: `oneOf-${index}`,
        title: item.title || `选项 ${index + 1}`,
        type: 'oneOf',
        description: item.description,
        children: buildSchemaTree(item),
      };
      nodes.push(node);
    });
    return nodes;
  }

  // 处理对象
  if (schema.type === 'object' && schema.properties) {
    Object.entries(schema.properties).forEach(([key, prop]: [string, any]) => {
      const required = schema.required?.includes(key);
      const hasChildren =
        prop.type === 'object' ||
        (prop.type === 'array' && prop.items?.type === 'object');

      const node: any = {
        key,
        title: key + (required ? ' *' : ''),
        type: prop.type,
        format: prop.format,
        description: prop.description,
        enum: prop.enum,
        children: hasChildren ? [] : undefined, // 只有有嵌套结构时才添加 children
      };

      if (prop.type === 'object') {
        node.children = buildSchemaTree(prop);
      } else if (prop.type === 'array' && prop.items) {
        node.type = `array<${prop.items.type || 'any'}>`;
        if (prop.items.type === 'object') {
          node.children = buildSchemaTree(prop.items);
        }
      }

      nodes.push(node);
    });
  }

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

// 生成 JSON 示例数据
export function generateExample(schema: Schema): any {
  if (!schema) return null;

  if (schema.example !== undefined) {
    return schema.example;
  }

  // 处理 oneOf
  if (schema.type === 'oneOf' && schema.items?.length > 0) {
    // 返回第一个选项的示例
    return generateExample(schema.items[0]);
  }
  const example: Record<string, any> = {};
  switch (schema.type) {
    case 'array': {
      return schema.items ? [generateExample(schema.items)] : [];
    }
    case 'boolean': {
      return false;
    }
    case 'integer':
    case 'number': {
      return schema.enum?.[0] || 0;
    }
    case 'object': {
      if (!schema.properties) {
        return {};
      }
      for (const [key, prop] of Object.entries(schema.properties)) {
        example[key] = generateExample(prop as any);
      }
      return example;
    }
    case 'string': {
      return schema.enum?.[0] || 'string';
    }

    default: {
      return null;
    }
  }
}

// 处理请求和响应的 schema
export const processSchema = (schema: Schema) => {
  if (!schema) return {};
  const allProperties = {};
  // 如果传入的是已经处理过的 schema，直接返回
  if (schema.properties) {
    const properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, item]) => {
        if (item.$ref) {
          const resolved = resolveSchema(item);
          return [
            key,
            {
              ...resolved,
              format: resolved.title,
            },
          ];
        } else {
          return [key, item];
        }
      }),
    );
    Object.assign(allProperties, properties);
  } else if (schema.items) {
    const properties = Object.fromEntries(
      Object.entries(schema.items).map(([key, item]) => {
        if (item.$ref) {
          const resolved = resolveSchema(item);
          return [
            key,
            {
              ...resolved,
              format: resolved.title,
            },
          ];
        } else {
          return [key, item];
        }
      }),
    );
    Object.assign(allProperties, properties);
  }

  if (schema.allOf) {
    schema.allOf.forEach((item: Schema) => {
      if (item.$ref) {
        const resolved = resolveSchema(item);
        Object.assign(allProperties, {
          [resolved.title]: resolved,
        });
      }
      Object.assign(allProperties, item.properties);
    });
  }
  return allProperties;
};
