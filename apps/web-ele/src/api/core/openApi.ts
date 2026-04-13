import type { OpenAPISpec, SwaggerConfig } from '#/typings/openApi';

import { requestClient } from '#/api/request';
import { sortOpenApiSpec, sortSwaggerConfig } from '#/utils/openapi-sort';

const withSortedData = <T extends { data: any }>(
  response: T,
  data: T['data'],
): T => ({
  ...response,
  data,
});

const sortRequiredOpenApiSpec = (data: OpenAPISpec) => {
  return sortOpenApiSpec(data) ?? data;
};

const sortRequiredSwaggerConfig = (data: SwaggerConfig) => {
  return sortSwaggerConfig(data) ?? data;
};

// 获取 OpenAPI
export async function getOpenAPI() {
  const response = await requestClient.get<{ data: OpenAPISpec }>(
    '/v3/api-docs',
  );
  return withSortedData(response, sortRequiredOpenApiSpec(response.data));
}

// 获取 OpenAPI 分组
export async function getOpenAPIConfig() {
  const response = await requestClient.get<{ data: SwaggerConfig }>(
    '/v3/api-docs/swagger-config',
  );
  return withSortedData(response, sortRequiredSwaggerConfig(response.data));
}

// 获取指定服务的 OpenAPI 配置
export async function getServiceOpenAPIConfig(serviceUrl: string) {
  // serviceUrl 格式: "/file/v3/api-docs"
  // 转换为: "/file/v3/api-docs/swagger-config"
  const configUrl = `${serviceUrl}/swagger-config`;
  const response = await requestClient.get<{ data: SwaggerConfig }>(configUrl);
  return withSortedData(response, sortRequiredSwaggerConfig(response.data));
}

// 获取指定模块的 API 文档
export async function getModuleAPIDoc(module: string) {
  const response = await requestClient.get<{ data: OpenAPISpec }>(
    `/v3/api-docs/${module}`,
  );
  return withSortedData(response, sortRequiredOpenApiSpec(response.data));
}
