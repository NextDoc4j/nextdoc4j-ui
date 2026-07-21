import { describe, expect, it } from 'vitest';

import {
  formatBodyEnumValidationMessage,
  hasBodyEnumConstraints,
  validateBodyEnumValues,
} from './body-schema-validation';

describe('validateBodyEnumValues', () => {
  it('validates nested enum fields and accepts equivalent numeric strings', () => {
    const schema = {
      properties: {
        status: { enum: [1, 2] },
      },
      type: 'object',
    };

    expect(validateBodyEnumValues({ status: '1' }, schema)).toEqual([]);
    expect(validateBodyEnumValues({ status: 3 }, schema)).toEqual([
      {
        allowedValues: [1, 2],
        path: '$.status',
        value: 3,
      },
    ]);
  });

  it('validates enum fields inside arrays', () => {
    const schema = {
      items: {
        properties: {
          status: { enum: ['ACTIVE', 'DISABLED'] },
        },
        type: 'object',
      },
      type: 'array',
    };

    expect(
      validateBodyEnumValues(
        [{ status: 'ACTIVE' }, { status: 'UNKNOWN' }],
        schema,
      ),
    ).toEqual([
      {
        allowedValues: ['ACTIVE', 'DISABLED'],
        path: '$[1].status',
        value: 'UNKNOWN',
      },
    ]);
  });

  it('uses extended enum items when a standard enum is absent', () => {
    const schema = {
      properties: {
        status: {
          'x-nextdoc4j-enum': {
            items: [
              { description: '启用', value: 1 },
              { description: '禁用', value: 2 },
            ],
          },
        },
      },
      type: 'object',
    };

    const issues = validateBodyEnumValues({ status: 0 }, schema);
    expect(formatBodyEnumValidationMessage(issues)).toBe(
      '$.status 的值 0 不在枚举范围内，可选值：1、2',
    );
    expect(hasBodyEnumConstraints(schema)).toBe(true);
  });
});
