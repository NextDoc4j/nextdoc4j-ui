export type BodyEnumValue = number | string;

export interface BodySchemaValidationIssue {
  allowedValues: BodyEnumValue[];
  path: string;
  value: unknown;
}

const getSchemaEnumValues = (schema: any): BodyEnumValue[] => {
  if (Array.isArray(schema?.enum) && schema.enum.length > 0) {
    return schema.enum;
  }

  const extendedItems = schema?.['x-nextdoc4j-enum']?.items;
  if (!Array.isArray(extendedItems)) {
    return [];
  }

  return extendedItems
    .map((item: any) => item?.value)
    .filter(
      (value: unknown): value is BodyEnumValue =>
        typeof value === 'number' || typeof value === 'string',
    );
};

const isAllowedEnumValue = (value: unknown, allowedValues: BodyEnumValue[]) =>
  allowedValues.some((allowed) => String(allowed) === String(value));

export const hasBodyEnumConstraints = (schema: any, depth = 0): boolean => {
  if (!schema || typeof schema !== 'object' || depth > 40) {
    return false;
  }
  if (getSchemaEnumValues(schema).length > 0) {
    return true;
  }
  if (schema.items && hasBodyEnumConstraints(schema.items, depth + 1)) {
    return true;
  }
  if (!schema.properties || typeof schema.properties !== 'object') {
    return false;
  }
  return Object.values(schema.properties).some((propertySchema) =>
    hasBodyEnumConstraints(propertySchema, depth + 1),
  );
};

export const validateBodyEnumValues = (
  value: unknown,
  schema: any,
  path = '$',
  depth = 0,
): BodySchemaValidationIssue[] => {
  if (!schema || typeof schema !== 'object' || depth > 40) {
    return [];
  }

  const issues: BodySchemaValidationIssue[] = [];
  const allowedValues = getSchemaEnumValues(schema);
  if (
    allowedValues.length > 0 &&
    value !== undefined &&
    !isAllowedEnumValue(value, allowedValues)
  ) {
    issues.push({ allowedValues, path, value });
  }

  if (schema.items && value !== undefined && value !== null) {
    const items = Array.isArray(value) ? value : [value];
    items.forEach((item, index) => {
      issues.push(
        ...validateBodyEnumValues(
          item,
          schema.items,
          `${path}[${index}]`,
          depth + 1,
        ),
      );
    });
  }

  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    schema.properties &&
    typeof schema.properties === 'object'
  ) {
    Object.entries(schema.properties).forEach(([key, propertySchema]) => {
      if (!Object.hasOwn(value, key)) {
        return;
      }
      issues.push(
        ...validateBodyEnumValues(
          (value as Record<string, unknown>)[key],
          propertySchema,
          `${path}.${key}`,
          depth + 1,
        ),
      );
    });
  }

  return issues;
};

const formatIssueValue = (value: unknown) => {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

export const formatBodyEnumValidationMessage = (
  issues: BodySchemaValidationIssue[],
) => {
  const firstIssue = issues[0];
  if (!firstIssue) {
    return '';
  }

  const allowedText = firstIssue.allowedValues
    .map((value) => formatIssueValue(value))
    .join('、');
  const remainingText =
    issues.length > 1 ? `，另有 ${issues.length - 1} 处错误` : '';
  return `${firstIssue.path} 的值 ${formatIssueValue(firstIssue.value)} 不在枚举范围内，可选值：${allowedText}${remainingText}`;
};
