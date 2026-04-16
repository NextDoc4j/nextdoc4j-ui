export const REQUEST_TIMEOUTS = {
  onlineDebug: 30_000,
  openApiDocument: 30_000,
  serviceProbe: 10_000,
} as const;

export const ONLINE_DEBUG_TIMEOUT_MESSAGE = '请求超时，请稍后重试';
