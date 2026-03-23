<script lang="ts" setup>
import type { MarkDownDes } from '#/typings/openApi';

import {
  computed,
  nextTick,
  onBeforeMount,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';
import { useRoute } from 'vue-router';

import { preferences } from '@vben/preferences';

import DOMPurify from 'dompurify';
import { ElCol, ElRow, ElScrollbar } from 'element-plus';
import hljs from 'highlight.js';
import MarkdownIt from 'markdown-it';
import Anchor from 'markdown-it-anchor';

import { useApiStore } from '#/store';

import 'highlight.js/styles/atom-one-light.css';
import '#/assets/style/github-markdown.css';

const route = useRoute();
const apiStore = useApiStore();
const md = new MarkdownIt({
  html: true, // 禁止原始 HTML
  xhtmlOut: true,
  linkify: true, // 自动识别链接
  breaks: true, // 换行转 <br>
  typographer: true, // 启用印刷替换
  highlight(str: string, lang: string) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`;
      } catch {}
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`;
  },
}).use(Anchor, {
  permalink: false,
  permalinkBefore: false,
  permalinkSymbol: '#',
});

type TocItem = {
  id: string;
  level: number;
  title: string;
};

const markDown = ref<{
  content?: string;
  contentLength?: string;
  lastModified?: string;
}>();
const contentHtml = computed(() => {
  const content = markDown.value?.content ?? '';
  return content ? renderMarkdown(content) : '';
});
const contentContainer = ref<HTMLElement | null>(null);
const pageScrollbar = ref<InstanceType<typeof ElScrollbar> | null>(null);
const tocItems = ref<TocItem[]>([]);
const tocHeadingEls = ref<HTMLElement[]>([]);
const tocListRef = ref<HTMLElement | null>(null);
const activeTocId = ref('');
const tocSvgPath = ref('');
const tocSvgWidth = ref(0);
const tocSvgHeight = ref(0);
const tocThumbStyle = ref<Record<string, string>>({
  '--toc-thumb-height': '0px',
  '--toc-thumb-top': '0px',
  opacity: '0',
});
const tocDotStyle = ref<Record<string, string>>({
  transform: 'translate(0px, 0px)',
  opacity: '0',
});

// 安全渲染函数
function renderMarkdown(text: string) {
  return DOMPurify.sanitize(md.render(text));
}

function buildTocFromDom() {
  const container = contentContainer.value;
  if (!container) return;

  const headings = [...container.querySelectorAll('h2, h3, h4')].filter(
    (heading): heading is HTMLElement => heading instanceof HTMLElement,
  );

  tocHeadingEls.value = headings;

  tocItems.value = headings
    .map((heading) => {
      const level = Number.parseInt(heading.tagName.slice(1), 10);
      const title = heading.textContent?.trim() ?? '';
      const id = heading.id;
      if (!id || !title) return null;

      return { id, title, level };
    })
    .filter(Boolean) as TocItem[];
}

function resolveTocLevel(level: number) {
  if (level <= 2) return 2;
  if (level === 3) return 3;
  return 4;
}

function getTocItemOffset(level: number) {
  if (level <= 2) return 14;
  if (level === 3) return 26;
  return 36;
}

function getTocLineOffset(level: number) {
  if (level <= 2) return 2;
  if (level === 3) return 10;
  return 20;
}

function getTocCurrentLevel(index: number) {
  return resolveTocLevel(tocItems.value[index]?.level ?? 2);
}

function getTocUpperLevel(index: number) {
  return resolveTocLevel(
    tocItems.value[index - 1]?.level ?? tocItems.value[index]?.level ?? 2,
  );
}

function getTocLowerLevel(index: number) {
  return resolveTocLevel(
    tocItems.value[index + 1]?.level ?? tocItems.value[index]?.level ?? 2,
  );
}

function isTocTopCut(index: number) {
  return (
    getTocLineOffset(getTocCurrentLevel(index)) !==
    getTocLineOffset(getTocUpperLevel(index))
  );
}

function isTocBottomCut(index: number) {
  return (
    getTocLineOffset(getTocCurrentLevel(index)) !==
    getTocLineOffset(getTocLowerLevel(index))
  );
}

function getTocCurveViewBox(index: number) {
  const offset = getTocLineOffset(getTocCurrentLevel(index));
  const upperOffset = getTocLineOffset(getTocUpperLevel(index));
  return `${Math.min(offset, upperOffset)} 0 ${Math.abs(upperOffset - offset)} 12`;
}

function getTocCurveStyle(index: number) {
  const offset = getTocLineOffset(getTocCurrentLevel(index));
  const upperOffset = getTocLineOffset(getTocUpperLevel(index));
  return {
    width: `${Math.abs(upperOffset - offset) + 1}px`,
    height: '12px',
    insetInlineStart: `${Math.min(offset, upperOffset)}px`,
  };
}

function getTocCurvePath(index: number) {
  const offset = getTocLineOffset(getTocCurrentLevel(index));
  const upperOffset = getTocLineOffset(getTocUpperLevel(index));
  return `M ${upperOffset} 0 C ${upperOffset} 8 ${offset} 4 ${offset} 12`;
}

function getTocBranchStyle(index: number) {
  return {
    insetInlineStart: `${getTocLineOffset(getTocCurrentLevel(index))}px`,
  };
}

function getTocItemStyle(index: number) {
  return {
    paddingInlineStart: `${getTocItemOffset(getTocCurrentLevel(index))}px`,
  };
}

function updateTocSvgPath() {
  const container = tocListRef.value;
  if (!container) return;

  const links = [...container.querySelectorAll<HTMLElement>('.toc-link')];
  if (links.length === 0 || links.length !== tocItems.value.length) {
    tocSvgPath.value = '';
    tocSvgWidth.value = 0;
    tocSvgHeight.value = 0;
    return;
  }

  let width = 0;
  let height = 0;
  let previousBottom = 0;
  let path = '';

  tocItems.value.forEach((item, index) => {
    const link = links[index];
    if (!link) return;

    const styles = getComputedStyle(link);
    const currentLevel = resolveTocLevel(item.level);
    const currentOffset = getTocLineOffset(currentLevel) + 1;
    const top = link.offsetTop + (Number.parseFloat(styles.paddingTop) || 0);
    const bottom =
      link.offsetTop +
      link.clientHeight -
      (Number.parseFloat(styles.paddingBottom) || 0);

    width = Math.max(width, currentOffset);
    height = Math.max(height, bottom);

    if (index === 0) {
      path += ` M${currentOffset} ${top} L${currentOffset} ${bottom}`;
    } else {
      const prevLevel = resolveTocLevel(
        tocItems.value[index - 1]?.level ?? item.level,
      );
      const prevOffset = getTocLineOffset(prevLevel) + 1;
      path += ` C ${prevOffset} ${top - 4} ${currentOffset} ${previousBottom + 4} ${currentOffset} ${top} L${currentOffset} ${bottom}`;
    }

    previousBottom = bottom;
  });

  tocSvgPath.value = path.trim();
  tocSvgWidth.value = width + 1;
  tocSvgHeight.value = height;
}

function updateTocThumb() {
  const container = tocListRef.value;
  if (!container) return;

  const activeIndex = tocItems.value.findIndex(
    (item) => item.id === activeTocId.value,
  );
  const links = [...container.querySelectorAll<HTMLElement>('.toc-link')];
  const activeLink = activeIndex === -1 ? null : links[activeIndex];
  if (!activeLink || activeIndex === -1) {
    tocThumbStyle.value = {
      '--toc-thumb-height': '0px',
      '--toc-thumb-top': '0px',
      opacity: '0',
    };
    tocDotStyle.value = {
      transform: 'translate(0px, 0px)',
      opacity: '0',
    };
    return;
  }

  const styles = getComputedStyle(activeLink);
  const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0;
  const top = activeLink.offsetTop + paddingTop;
  const height = Math.max(
    0,
    activeLink.clientHeight - paddingTop - paddingBottom,
  );

  tocThumbStyle.value = {
    '--toc-thumb-height': `${height}px`,
    '--toc-thumb-top': `${top}px`,
    opacity: '1',
  };

  const dotOffset = getTocLineOffset(getTocCurrentLevel(activeIndex)) - 1.25;
  tocDotStyle.value = {
    transform: `translate(${dotOffset}px, ${top}px)`,
    opacity: '1',
  };
}

function updateActiveToc() {
  const scrollWrap = pageScrollbar.value?.wrapRef;
  if (!scrollWrap) return;

  if (tocHeadingEls.value.length === 0) {
    activeTocId.value = '';
    return;
  }

  const scrollTop = scrollWrap.scrollTop;
  let currentId = tocHeadingEls.value[0]?.id ?? '';

  tocHeadingEls.value.forEach((heading) => {
    const offsetTop = heading.offsetTop;
    if (offsetTop - 12 <= scrollTop) {
      currentId = heading.id;
    }
  });

  activeTocId.value = currentId;
  updateTocThumb();
}

function handleTocClick(item: TocItem) {
  const target = tocHeadingEls.value.find((heading) => heading.id === item.id);
  if (!target) return;

  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  activeTocId.value = item.id;
  updateTocThumb();
}

// 配置链接在新窗口打开
const defaultRender =
  md.renderer.rules.link_open ||
  function (
    tokens: { [x: string]: { attrPush: (arg0: string[]) => void } },
    idx: number | string,
    options: Record<string, any>,
    _env: string,
    self: { renderToken: (arg0: any, arg1: any, arg2: any) => any },
  ) {
    return self.renderToken(tokens, idx, options);
  };
md.renderer.rules.link_open = function (
  tokens: { [x: string]: { attrPush: (arg0: string[]) => void } },
  idx: number | string,
  options: Record<string, any>,
  env: string,
  self: { renderToken: (arg0: any, arg1: any, arg2: any) => any },
) {
  tokens?.[idx]?.attrPush(['target', '_blank']);
  return defaultRender(tokens, idx, options, env, self);
};

onBeforeMount(() => {
  const routeName = route.name;
  if (!routeName || typeof routeName !== 'string') {
    console.warn('Route name is not available');
    return;
  }

  const [group, name] = routeName.split('*') ?? [];
  // 确保所有参数都是字符串类型
  const safeGroup = group || '';
  const safeName = name || '';

  markDown.value = apiStore.searchMarkDown(
    safeGroup as keyof MarkDownDes,
    safeName,
  );
});
watch(
  contentHtml,
  async () => {
    await nextTick();
    buildTocFromDom();
    updateTocSvgPath();
    updateActiveToc();
    updateTocThumb();
  },
  { immediate: true },
);

function handleLayoutResize() {
  updateTocSvgPath();
  updateTocThumb();
}

onMounted(() => {
  const scrollWrap = pageScrollbar.value?.wrapRef;
  if (scrollWrap) {
    scrollWrap.addEventListener('scroll', updateActiveToc, { passive: true });
  }

  window.addEventListener('resize', handleLayoutResize);
  nextTick(() => {
    updateTocSvgPath();
    updateTocThumb();
  });
});

onBeforeUnmount(() => {
  const scrollWrap = pageScrollbar.value?.wrapRef;
  if (scrollWrap) {
    scrollWrap.removeEventListener('scroll', updateActiveToc);
  }

  window.removeEventListener('resize', handleLayoutResize);
});
</script>
<template>
  <div class="markdown-shell">
    <ElScrollbar ref="pageScrollbar" class="markdown-scroll">
      <div class="markdown-page">
        <div class="markdown-content">
          <div
            ref="contentContainer"
            v-html="contentHtml"
            class="markdown-body"
            :data-theme="preferences.theme.mode"
          ></div>
          <ElRow class="markdown-meta">
            <ElCol
              :span="12"
              class="text-xs text-[var(--el-text-color-placeholder)]"
            >
              更新时间：{{ markDown?.lastModified || '-' }}
            </ElCol>
            <ElCol
              :span="12"
              class="text-right text-xs text-[var(--el-text-color-placeholder)]"
            >
              文件大小：{{ markDown?.contentLength || '-' }}
            </ElCol>
          </ElRow>
        </div>

        <aside class="toc-panel" aria-label="目录">
          <h3 class="toc-header">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
              class="toc-header-icon"
            >
              <path d="M4 7h16" />
              <path d="M4 12h16" />
              <path d="M4 17h10" />
            </svg>
            <span>目录</span>
          </h3>
          <div class="toc-scroll">
            <nav v-if="tocItems.length > 0" ref="tocListRef" class="toc-list">
              <div
                v-if="tocSvgPath"
                class="toc-svg-layer"
                :style="{
                  width: `${tocSvgWidth}px`,
                  height: `${tocSvgHeight}px`,
                }"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="toc-svg toc-svg-rail"
                  :viewBox="`0 0 ${tocSvgWidth} ${tocSvgHeight}`"
                >
                  <path :d="tocSvgPath" />
                </svg>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="toc-svg toc-svg-active"
                  :viewBox="`0 0 ${tocSvgWidth} ${tocSvgHeight}`"
                  :style="tocThumbStyle"
                >
                  <path :d="tocSvgPath" />
                </svg>
              </div>
              <div class="toc-dot" :style="tocDotStyle"></div>
              <button
                v-for="(item, index) in tocItems"
                :key="item.id"
                type="button"
                class="toc-link"
                :class="[
                  { 'is-active': activeTocId === item.id },
                  { 'is-top-cut': isTocTopCut(index) },
                  { 'is-bottom-cut': isTocBottomCut(index) },
                ]"
                :style="getTocItemStyle(index)"
                @click="handleTocClick(item)"
              >
                <svg
                  v-if="isTocTopCut(index)"
                  xmlns="http://www.w3.org/2000/svg"
                  class="toc-curve"
                  :viewBox="getTocCurveViewBox(index)"
                  :style="getTocCurveStyle(index)"
                >
                  <path :d="getTocCurvePath(index)" />
                </svg>
                <span
                  class="toc-branch"
                  :style="getTocBranchStyle(index)"
                ></span>
                <span class="toc-link-title">{{ item.title }}</span>
              </button>
            </nav>
            <div v-else class="toc-empty">暂无目录</div>
          </div>
        </aside>
      </div>
    </ElScrollbar>
  </div>
</template>

<style scoped lang="scss">
.markdown-shell {
  width: 100%;
  height: 100%;
}

.markdown-page {
  box-sizing: border-box;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 16.75rem;
  gap: 1.25rem;
  align-items: start;
  width: 100%;
  padding: 12px 20px 2px;
}

.markdown-scroll {
  width: 100%;
  min-width: 0;
  height: 100%;
}

.markdown-scroll :deep(.el-scrollbar__view) {
  min-width: 0;
  min-height: 100%;
}

.markdown-content {
  width: 100%;
  max-width: 900px;
  padding-bottom: 4px;
  margin: 0 auto;
}

.markdown-body {
  background-color: transparent;
}

.markdown-body[data-theme='dark'] {
  background-color: var(--el-bg-color-page, var(--el-bg-color));
}

.markdown-meta {
  margin-top: 6px;
}

.toc-panel {
  position: sticky;
  top: 12px;
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 176px);
  padding-inline-end: 4px;
  overflow: hidden;
}

.toc-header {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 500;
  color: var(--el-text-color-secondary);
}

.toc-header-icon {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
}

.toc-scroll {
  position: relative;
  max-height: calc(100vh - 220px);
  padding: 10px 0;
  margin-inline-start: 1px;
  overflow: auto;
  scrollbar-width: none;
  mask-image: linear-gradient(
    to bottom,
    transparent,
    #000 16px,
    #000 calc(100% - 16px),
    transparent
  );
}

.toc-scroll::-webkit-scrollbar {
  display: none;
}

.toc-list {
  position: relative;
  display: flex;
  flex-direction: column;
}

.toc-svg-layer {
  position: absolute;
  inset-inline-start: 0;
  top: 0;
  pointer-events: none;
}

.toc-svg {
  position: absolute;
  inset-inline-start: 0;
  top: 0;
  width: 100%;
  height: 100%;
}

.toc-svg path {
  fill: none;
  stroke-width: 1;
}

.toc-svg-rail path {
  stroke: color-mix(in srgb, var(--el-text-color-primary) 14%, transparent);
}

.toc-svg-active {
  clip-path: polygon(
    0 var(--toc-thumb-top),
    100% var(--toc-thumb-top),
    100% calc(var(--toc-thumb-top) + var(--toc-thumb-height)),
    0 calc(var(--toc-thumb-top) + var(--toc-thumb-height))
  );
  transition:
    clip-path 0.15s ease,
    opacity 0.15s ease;
}

.toc-svg-active path {
  stroke: var(--el-color-primary);
}

.toc-dot {
  position: absolute;
  width: 4px;
  height: 4px;
  pointer-events: none;
  background: var(--el-color-primary);
  border-radius: 999px;
  transition:
    transform 0.15s ease,
    opacity 0.15s ease;
}

.toc-link {
  position: relative;
  display: block;
  width: 100%;
  padding-block: 6px;
  padding-inline-end: 0;
  overflow: hidden;
  font-size: 14px;
  font-weight: 400;
  line-height: 1.45;
  color: var(--el-text-color-secondary);
  text-align: left;
  overflow-wrap: anywhere;
  cursor: pointer;
  background: transparent;
  border: none;
  transition: color 0.15s ease;
}

.toc-link:first-of-type {
  padding-top: 0;
}

.toc-link:last-of-type {
  padding-bottom: 0;
}

.toc-link-title {
  display: -webkit-box;
  overflow: hidden;
  text-overflow: ellipsis;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.toc-curve {
  position: absolute;
  top: -6px;
}

.toc-curve path {
  fill: none;
  stroke: color-mix(in srgb, var(--el-text-color-primary) 14%, transparent);
  stroke-width: 1;
}

.toc-branch {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: color-mix(in srgb, var(--el-text-color-primary) 14%, transparent);
}

.toc-link.is-top-cut .toc-branch {
  top: 6px;
}

.toc-link.is-bottom-cut .toc-branch {
  bottom: 6px;
}

.toc-link:hover {
  color: var(--el-text-color-primary);
}

.toc-link.is-active {
  font-weight: 500;
  color: var(--el-color-primary);
}

.toc-empty {
  padding: 8px 12px;
  font-size: 13px;
  color: var(--el-text-color-placeholder);
}

@media (max-width: 1100px) {
  .markdown-page {
    grid-template-columns: minmax(0, 1fr);
    padding-bottom: 2px;
  }

  .markdown-content {
    max-width: none;
  }

  .toc-panel {
    display: none;
  }
}
</style>
