/**
 * 构建「复制接口信息给 AI」所需的提示词文本。
 *
 * 两个场景：
 * - 接口详情：把接口定义整理成 Markdown，交给 Cursor 等 AI 编程工具生成调用代码；
 * - 在线调试：把实际请求 / 响应 / 错误整理成 Markdown，交给 Coding Agent 排查并修复代码。
 */

interface AiAuthMethod {
  detail?: string;
  label: string;
}

interface AiParam {
  description?: string;
  name: string;
  required?: boolean;
  type?: string;
}

interface AiResponseSummary {
  code: string;
  description?: string;
}

export interface ApiDocPromptParams {
  authMethods?: AiAuthMethod[];
  description?: string;
  method?: string;
  /** 接口对应的原始 OpenAPI JSON 片段（已序列化字符串） */
  openApiJson?: string;
  pathParams?: AiParam[];
  queryParams?: AiParam[];
  responses?: AiResponseSummary[];
  responseTs?: string;
  requestTs?: string;
  summary?: string;
  tags?: string[];
  url?: string;
}

interface AiKeyValue {
  name: string;
  value: string;
}

export interface DebugPromptParams {
  bodyText?: string;
  bodyType?: string;
  errorMessage?: string;
  headers?: AiKeyValue[];
  method?: string;
  pathParams?: AiKeyValue[];
  queryParams?: AiKeyValue[];
  responseBody?: string;
  responseMime?: string;
  responseSize?: string;
  responseStatus?: string;
  responseTime?: number | string;
  summary?: string;
  url?: string;
}

/** 去除描述中的 HTML 标签，得到纯文本 */
function stripHtml(html?: string) {
  if (!html) return '';
  return html
    .replaceAll(/<[^>]*>/gu, ' ')
    .replaceAll('&nbsp;', ' ')
    .replaceAll(/\s+/gu, ' ')
    .trim();
}

/** 渲染参数列表为 Markdown 无序列表 */
function renderParamList(params?: AiParam[]) {
  if (!params || params.length === 0) {
    return '';
  }
  return params
    .map((item) => {
      const type = item.type ? `\`${item.type}\`` : '`string`';
      const required = item.required ? '必填' : '可选';
      const desc = stripHtml(item.description);
      return `- ${item.name} (${type}, ${required})${desc ? `：${desc}` : ''}`;
    })
    .join('\n');
}

/** 渲染键值表为 Markdown 无序列表 */
function renderKeyValueList(items?: AiKeyValue[]) {
  if (!items || items.length === 0) {
    return '';
  }
  return items
    .filter((item) => item.name)
    .map((item) => `- ${item.name}: ${item.value ?? ''}`)
    .join('\n');
}

/** 接口详情：生成供 AI 生成调用代码的 Markdown 提示词 */
export function buildApiDocPrompt(params: ApiDocPromptParams) {
  const lines: string[] = [];

  lines.push(
    '请根据下面的接口定义，生成高质量、可直接使用的调用代码（包含类型定义、请求函数、错误处理与必要注释）。',
    '',
    `## 接口：${params.summary || '未命名接口'}`,
  );

  const meta: string[] = [];
  if (params.method) {
    meta.push(`- 请求方法：${params.method.toUpperCase()}`);
  }
  if (params.url) {
    meta.push(`- 请求地址：${params.url}`);
  }
  if (params.tags && params.tags.length > 0) {
    meta.push(`- 所属分组：${params.tags.join('、')}`);
  }
  const description = stripHtml(params.description);
  if (description) {
    meta.push(`- 接口描述：${description}`);
  }
  if (params.authMethods && params.authMethods.length > 0) {
    const auth = params.authMethods
      .map((item) =>
        item.detail ? `${item.label}（${item.detail}）` : item.label,
      )
      .join('、');
    meta.push(`- 认证方式：${auth}`);
  }
  if (meta.length > 0) {
    lines.push(...meta);
  }

  const pathList = renderParamList(params.pathParams);
  if (pathList) {
    lines.push('', '### 路径参数', pathList);
  }

  const queryList = renderParamList(params.queryParams);
  if (queryList) {
    lines.push('', '### 查询参数', queryList);
  }

  if (params.requestTs) {
    lines.push(
      '',
      '### 请求体（TypeScript）',
      '```typescript',
      params.requestTs,
      '```',
    );
  }

  if (params.responseTs) {
    lines.push(
      '',
      '### 响应体（TypeScript）',
      '```typescript',
      params.responseTs,
      '```',
    );
  }

  if (params.responses && params.responses.length > 0) {
    const responseList = params.responses
      .map((item) => `- ${item.code}：${item.description || '响应结果'}`)
      .join('\n');
    lines.push('', '### 响应状态', responseList);
  }

  if (params.openApiJson) {
    lines.push(
      '',
      '### 原始 OpenAPI 定义（JSON）',
      '```json',
      params.openApiJson,
      '```',
    );
  }

  return lines.join('\n');
}

/** 在线调试：生成供 Coding Agent 排查并修复代码的 Markdown 提示词 */
export function buildDebugPrompt(params: DebugPromptParams) {
  const lines: string[] = [];

  lines.push(
    '以下是我在调试该接口时的实际请求与响应信息，请帮我定位并修复相关代码问题。',
    '',
    `## 接口：${(params.method || 'GET').toUpperCase()} ${params.url || ''}`.trim(),
  );

  if (params.summary) {
    lines.push(`- 接口名称：${params.summary}`);
  }

  const headerList = renderKeyValueList(params.headers);
  if (headerList) {
    lines.push('', '### 请求头', headerList);
  }

  const queryList = renderKeyValueList(params.queryParams);
  if (queryList) {
    lines.push('', '### 查询参数', queryList);
  }

  const pathList = renderKeyValueList(params.pathParams);
  if (pathList) {
    lines.push('', '### 路径参数', pathList);
  }

  if (params.bodyText) {
    lines.push(
      '',
      `### 请求体（${params.bodyType || 'raw'}）`,
      '```',
      params.bodyText,
      '```',
    );
  }

  lines.push('', '### 响应');
  const responseMeta: string[] = [];
  if (params.responseStatus) {
    responseMeta.push(`- 状态：${params.responseStatus}`);
  }
  if (params.responseTime !== undefined && params.responseTime !== '') {
    responseMeta.push(`- 耗时：${params.responseTime} ms`);
  }
  if (params.responseSize) {
    responseMeta.push(`- 大小：${params.responseSize}`);
  }
  if (params.responseMime) {
    responseMeta.push(`- 类型：${params.responseMime}`);
  }
  if (responseMeta.length > 0) {
    lines.push(...responseMeta);
  }

  if (params.responseBody) {
    lines.push('', '响应内容：', '```', params.responseBody, '```');
  }

  if (params.errorMessage) {
    lines.push('', '### 错误信息', '```', params.errorMessage, '```');
  }

  return lines.join('\n');
}
