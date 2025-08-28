import type { OpenAPISpec, SwaggerConfig } from '#/typings/openApi';

import { requestClient } from '#/api/request';
// 获取 OpenAPI
export function getOpenAPI() {
  return requestClient.get<{ data: OpenAPISpec }>('/v3/api-docs');
}

// 获取 OpenAPI 分组
export function getOpenAPIConfig() {
  return requestClient.get<{ data: SwaggerConfig }>(
    '/v3/api-docs/swagger-config',
  );
}

// 获取指定模块的 API 文档
export function getModuleAPIDoc(module: string) {
  return requestClient.get<{ data: OpenAPISpec }>(`/v3/api-docs/${module}`);
}
