// 权限扩展工具函数

export interface AuthInfo {
  values: string[];
  mode: string;
  type?: string;
  orValues?: string[];
  orType?: string;
}

export interface SecurityMetadata {
  permissions?: AuthInfo[];
  roles?: AuthInfo[];
  ignore?: boolean;
}

/**
 * 解析权限扩展信息
 * @param apiInfo - API 信息对象
 * @returns 权限元数据
 */
export function parseSecurityMetadata(apiInfo: any): null | SecurityMetadata {
  if (!apiInfo) return null;

  const securityMetadata = apiInfo['x-nextdoc4j-security'] as
    | SecurityMetadata
    | undefined;

  if (!securityMetadata) {
    return null;
  }

  return securityMetadata;
}

/**
 * 检查是否有权限要求
 * @param apiInfo - API 信息对象
 * @returns 是否有权限要求
 */
export function hasSecurityRequirement(apiInfo: any): boolean | undefined {
  const metadata = parseSecurityMetadata(apiInfo);

  if (!metadata || metadata.ignore) {
    return false;
  }

  const hasPermissions =
    metadata.permissions && metadata.permissions.length > 0;
  const hasRoles = metadata.roles && metadata.roles.length > 0;

  return hasPermissions || hasRoles;
}

/**
 * 格式化权限模式显示文本
 * @param mode - 权限模式 (AND/OR)
 * @returns 中文显示文本
 */
export function formatMode(mode: string): string {
  const modeMap: Record<string, string> = {
    AND: '且',
    OR: '或',
  };
  return modeMap[mode.toUpperCase()] || mode;
}

/**
 * 获取权限要求的摘要文本
 * @param apiInfo - API 信息对象
 * @returns 权限要求摘要
 */
export function getSecuritySummary(apiInfo: any): string {
  const metadata = parseSecurityMetadata(apiInfo);

  if (!metadata || metadata.ignore) {
    return '无权限要求';
  }

  const parts: string[] = [];

  if (metadata.roles && metadata.roles.length > 0) {
    const roleCount = metadata.roles.reduce(
      (sum, r) => sum + r.values.length,
      0,
    );
    parts.push(`${roleCount} 个角色`);
  }

  if (metadata.permissions && metadata.permissions.length > 0) {
    const permCount = metadata.permissions.reduce(
      (sum, p) => sum + p.values.length,
      0,
    );
    parts.push(`${permCount} 个权限`);
  }

  return parts.length > 0 ? parts.join(' / ') : '无权限要求';
}
