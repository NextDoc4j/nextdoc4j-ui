import { createIconifyIcon } from '@vben-core/icons';

import './load.js';

// 全部使用本地 svg 离线注册（svg/icons 下的同名文件，经 load.ts 注册为 svg:*）。
const SvgAiCopyIcon = createIconifyIcon('svg:ai-copy');
const SvgCaretRightIcon = createIconifyIcon('svg:caret-right');
const SvgCloseIcon = createIconifyIcon('svg:close-duotone');
const SvgCopyIcon = createIconifyIcon('svg:copy');
// 文档导出图标保留自定义SVG（带颜色）
const SvgDocExportHtmlIcon = createIconifyIcon('svg:doc-export-html');
const SvgDocExportMarkdownIcon = createIconifyIcon('svg:doc-export-markdown');
const SvgDocExportOpenapiIcon = createIconifyIcon('svg:doc-export-openapi');
const SvgDocExportPdfIcon = createIconifyIcon('svg:doc-export-pdf');
const SvgDocExportWordIcon = createIconifyIcon('svg:doc-export-word');
const SvgDocumentDocTrashBinIcon = createIconifyIcon(
  'svg:document-doc-trash-bin',
);
const SvgDocumentLayoutIcon = createIconifyIcon('svg:document-layout');
const SvgDocumentOmittedIcon = createIconifyIcon('svg:document-omitted');
const SvgDocumentResetIcon = createIconifyIcon('svg:document-reset');
const SvgFileDownIcon = createIconifyIcon('svg:file-down');
const SvgDoubleArrowDownIcon = createIconifyIcon('svg:chevrons-down');
const SvgDoubleArrowUpIcon = createIconifyIcon('svg:chevrons-up');
const SvgMenuDocumentManageIcon = createIconifyIcon('svg:menu-document-manage');
const SvgFormatLeftIcon = createIconifyIcon('svg:format-left');
const SvgGlobalConfigIcon = createIconifyIcon('svg:global-config');
const SvgApiPrefixIcon = createIconifyIcon('svg:api-prefix');
const SvgMenuApiIcon = createIconifyIcon('svg:menu-api');
const SvgMenuDocumentIcon = createIconifyIcon('svg:menu-document');
const SvgMenuEntityIcon = createIconifyIcon('svg:menu-entity');
const SvgMenuHomeIcon = createIconifyIcon('svg:menu-home');
const SvgMenuSafetyIcon = createIconifyIcon('svg:menu-safety');

export {
  SvgAiCopyIcon,
  SvgApiPrefixIcon,
  SvgCaretRightIcon,
  SvgCloseIcon,
  SvgCopyIcon,
  SvgDocExportHtmlIcon,
  SvgDocExportMarkdownIcon,
  SvgDocExportOpenapiIcon,
  SvgDocExportPdfIcon,
  SvgDocExportWordIcon,
  SvgDocumentDocTrashBinIcon,
  SvgDocumentLayoutIcon,
  SvgDocumentOmittedIcon,
  SvgDocumentResetIcon,
  SvgDoubleArrowDownIcon,
  SvgDoubleArrowUpIcon,
  SvgFileDownIcon,
  SvgFormatLeftIcon,
  SvgGlobalConfigIcon,
  SvgMenuApiIcon,
  SvgMenuDocumentIcon,
  SvgMenuDocumentManageIcon,
  SvgMenuEntityIcon,
  SvgMenuHomeIcon,
  SvgMenuSafetyIcon,
};
