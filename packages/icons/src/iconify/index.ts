import { createIconifyIcon } from '@vben-core/icons';

export * from '@vben-core/icons';

// 已被业务渲染的图标统一走本地 svg 离线注册（svg/icons 下同名文件，见 ../svg/load.ts）。
export const MdiKeyboardEsc = createIconifyIcon('svg:close-duotone');

// 这几个兼容导出当前无业务引用，统一映射到本地已注册图标。
export const MdiWechat = createIconifyIcon('svg:copy');

export const MdiGithub = createIconifyIcon('svg:copy');

export const MdiGoogle = createIconifyIcon('svg:copy');

export const MdiQqchat = createIconifyIcon('svg:copy');

export const MdiLock = createIconifyIcon('svg:lock');

export const MdiPlus = createIconifyIcon('svg:plus');

export const MdiMinus = createIconifyIcon('svg:minus');

export const ApiLinkPrefix = createIconifyIcon('svg:api-prefix');

export const ApiTestRun = createIconifyIcon('svg:play');

export const ApiTestRunning = createIconifyIcon('svg:loader-circle');
