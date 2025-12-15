// # 枚举扩展工具函数

export interface EnumItem {
  value: string;
  description?: string;
}

export interface ExtendedEnum {
  items: EnumItem[];
}

/**
 * 解析扩展枚举信息
 * @param schema - 包含枚举信息的 schema 对象
 * @returns 格式化后的枚举描述字符串
 */
export function parseExtendedEnum(schema: any): null | string {
  if (!schema) return null;

  const extendedEnum = schema['x-nextdoc4j-enum'] as ExtendedEnum | undefined;

  if (!extendedEnum?.items || !Array.isArray(extendedEnum.items)) {
    return null;
  }

  // 过滤掉空对象并格式化为 "value - description"
  const formattedItems = extendedEnum.items
    .filter((item) => item && item.value) // 过滤空对象和无效项
    .map((item) => {
      if (item.description) {
        return `${item.value} - ${item.description}`;
      }
      return item.value;
    });

  return formattedItems.length > 0 ? formattedItems.join(', ') : null;
}

/**
 * 获取完整的枚举描述(原始描述 + 枚举值说明)
 * @param originalDescription - 原始描述
 * @param schema - 包含枚举信息的 schema 对象
 * @returns 组合后的描述
 */
export function getEnumDescription(
  originalDescription: string | undefined,
  schema: any,
): string {
  const enumDesc = parseExtendedEnum(schema);

  if (!enumDesc) {
    return originalDescription || '';
  }

  if (!originalDescription) {
    return enumDesc;
  }

  return `${originalDescription} (${enumDesc})`;
}

/**
 * 获取枚举项列表用于展示
 * @param schema - 包含枚举信息的 schema 对象
 * @returns 枚举项数组
 */
export function getEnumItems(schema: any): EnumItem[] {
  if (!schema) return [];

  const extendedEnum = schema['x-nextdoc4j-enum'] as ExtendedEnum | undefined;

  if (!extendedEnum?.items || !Array.isArray(extendedEnum.items)) {
    // 如果没有扩展枚举,但有普通 enum,返回基本格式
    if (schema.enum && Array.isArray(schema.enum)) {
      return schema.enum.map((value: string) => ({ value }));
    }
    return [];
  }

  return extendedEnum.items.filter((item) => item && item.value);
}
