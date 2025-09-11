import type { ApplicationConfig } from '@vben/types/global';

/**
 * 由 vite-inject-app-config 注入的全局配置
 */
export function useAppConfig(
  env: Record<string, any>,
  isProduction: boolean,
): ApplicationConfig {
  if (isProduction) {
    const path = window.location.pathname;
    const index = path.lastIndexOf('/');
    const basePath =
      path.length === index + 1 ? path : path.slice(0, Math.max(0, index));
    return {
      apiURL: basePath,
    };
  }
  return {
    apiURL: env.VITE_GLOB_API_URL,
  };
}
