const DEFAULT_OPENAPI_DOC_PATH = '/v3/api-docs';
const ABSOLUTE_HTTP_URL_PATTERN = /^https?:\/\//i;

/**
 * 移除字符串末尾连续的斜杠。
 *
 * @param value 待处理的字符串
 * @returns 移除末尾斜杠后的字符串
 */
const trimTrailingSlashes = (value: string) => value.replace(/\/+$/, '');

/**
 * 归一化 OpenAPI 文档路径。
 *
 * @param docPath 网关配置的 OpenAPI 文档路径
 * @returns 以单个斜杠开头且不以斜杠结尾的文档路径
 */
const normalizeDocPath = (docPath?: string) => {
  const value = docPath?.trim() || DEFAULT_OPENAPI_DOC_PATH;
  const normalized = value.startsWith('/') ? value : `/${value}`;
  return trimTrailingSlashes(normalized);
};

/**
 * 拼接 URL 路径并消除边界处的重复斜杠。
 *
 * @param prefix URL 路径前缀
 * @param path 待追加的 URL 路径
 * @returns 拼接后的 URL 路径
 */
const appendPath = (prefix: string, path: string) => {
  const normalizedPrefix = trimTrailingSlashes(prefix);
  const normalizedPath = path.replace(/^\/+/, '');
  return normalizedPrefix
    ? `${normalizedPrefix}/${normalizedPath}`
    : `/${normalizedPath}`;
};

/**
 * 从服务文档地址中提取网关服务前缀。
 *
 * @param serviceDocumentUrl 服务 OpenAPI 文档地址
 * @param docPath 网关配置的 OpenAPI 文档路径
 * @returns 网关服务路由前缀；文档路径不匹配时返回原服务文档地址
 */
export function resolveServiceDocumentPrefix(
  serviceDocumentUrl: string,
  docPath?: string,
) {
  const normalizedServiceUrl = trimTrailingSlashes(serviceDocumentUrl.trim());
  const normalizedDocPath = normalizeDocPath(docPath);

  if (normalizedServiceUrl.endsWith(normalizedDocPath)) {
    return normalizedServiceUrl.slice(0, -normalizedDocPath.length);
  }
  return normalizedServiceUrl;
}

/**
 * 根据服务文档地址解析可通过网关访问的分组文档地址。
 *
 * @param serviceDocumentUrl 服务 OpenAPI 文档地址
 * @param groupDocumentUrl swagger-config 返回的分组文档地址
 * @param docPath 网关配置的 OpenAPI 文档路径
 * @returns 归一化后的分组文档请求地址
 */
export function resolveServiceGroupDocumentUrl(
  serviceDocumentUrl: string,
  groupDocumentUrl: string,
  docPath?: string,
) {
  const normalizedServiceUrl = trimTrailingSlashes(serviceDocumentUrl.trim());
  const normalizedGroupUrl = groupDocumentUrl.trim();

  if (
    !normalizedGroupUrl ||
    ABSOLUTE_HTTP_URL_PATTERN.test(normalizedGroupUrl)
  ) {
    return normalizedGroupUrl || normalizedServiceUrl;
  }
  if (
    normalizedGroupUrl === normalizedServiceUrl ||
    normalizedGroupUrl.startsWith(`${normalizedServiceUrl}/`) ||
    normalizedGroupUrl.startsWith(`${normalizedServiceUrl}?`) ||
    normalizedGroupUrl.startsWith(`${normalizedServiceUrl}#`)
  ) {
    return normalizedGroupUrl;
  }
  if (!normalizedGroupUrl.startsWith('/')) {
    return appendPath(normalizedServiceUrl, normalizedGroupUrl);
  }

  return appendPath(
    resolveServiceDocumentPrefix(normalizedServiceUrl, docPath),
    normalizedGroupUrl,
  );
}

/**
 * 将网关服务的相对 Base URL 转换为浏览器实际访问的完整地址。
 *
 * @param serverUrl OpenAPI servers 中声明的服务地址
 * @param apiUrl 前端运行时配置的接口前缀
 * @param origin 当前页面 Origin
 * @returns 网关模式下完整的 Base URL；服务地址为空时返回空字符串
 */
export function resolveGatewayBaseUrl(
  serverUrl: string,
  apiUrl: string,
  origin: string,
) {
  const normalizedServerUrl = serverUrl?.trim();
  if (
    !normalizedServerUrl ||
    ABSOLUTE_HTTP_URL_PATTERN.test(normalizedServerUrl)
  ) {
    return normalizedServerUrl || '';
  }

  const normalizedApiUrl = apiUrl?.trim();
  let requestBaseUrl = origin;
  if (normalizedApiUrl) {
    requestBaseUrl = ABSOLUTE_HTTP_URL_PATTERN.test(normalizedApiUrl)
      ? normalizedApiUrl
      : appendPath(origin, normalizedApiUrl);
  }
  return appendPath(requestBaseUrl, normalizedServerUrl);
}
