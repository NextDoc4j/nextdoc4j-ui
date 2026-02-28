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
import {
  ElCard,
  ElCol,
  ElDivider,
  ElRow,
  ElScrollbar,
  ElTree,
} from 'element-plus';
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
  children: TocItem[];
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
const activeTocId = ref('');
const tocProps = { label: 'title', children: 'children' };

// 安全渲染函数
function renderMarkdown(text: string) {
  return DOMPurify.sanitize(md.render(text));
}

function buildTocFromDom() {
  const container = contentContainer.value;
  if (!container) return;

  const headings = [...container.querySelectorAll('h1, h2, h3')].filter(
    (heading): heading is HTMLElement => heading instanceof HTMLElement,
  );

  tocHeadingEls.value = headings;

  const items: TocItem[] = [];
  const stack: TocItem[] = [];

  headings.forEach((heading) => {
    const level = Number.parseInt(heading.tagName.slice(1), 10);
    const title = heading.textContent?.trim() ?? '';
    const id = heading.id;
    if (!id || !title) return;

    const current: TocItem = { id, title, level, children: [] };

    while (stack.length > 0 && stack[stack.length - 1]!.level >= level) {
      stack.pop();
    }

    if (stack.length === 0) {
      items.push(current);
    } else {
      stack[stack.length - 1]!.children.push(current);
    }

    stack.push(current);
  });

  tocItems.value = items;
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
}

function handleTocClick(item: TocItem) {
  const target = tocHeadingEls.value.find((heading) => heading.id === item.id);
  if (!target) return;

  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  activeTocId.value = item.id;
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
    updateActiveToc();
  },
  { immediate: true },
);

onMounted(() => {
  const scrollWrap = pageScrollbar.value?.wrapRef;
  if (!scrollWrap) return;
  scrollWrap.addEventListener('scroll', updateActiveToc, { passive: true });
});

onBeforeUnmount(() => {
  const scrollWrap = pageScrollbar.value?.wrapRef;
  if (!scrollWrap) return;
  scrollWrap.removeEventListener('scroll', updateActiveToc);
});
</script>
<template>
  <div class="relative box-border h-full min-h-0 w-full p-5">
    <ElCard shadow="never" class="relative h-full min-h-0 w-full">
      <ElScrollbar
        ref="pageScrollbar"
        class="h-full min-h-0 w-full"
        style="height: calc(100vh - 220px)"
      >
        <div class="pr-80">
          <div
            ref="contentContainer"
            v-html="contentHtml"
            class="markdown-body"
            :data-theme="preferences.theme.mode"
          ></div>
          <ElRow class="mt-8">
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
      </ElScrollbar>
      <div class="absolute right-4 top-4 w-72">
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium">本页目录</span>
        </div>
        <ElDivider class="my-2" />
        <ElScrollbar style="height: calc(100vh - 240px)">
          <ElTree
            :data="tocItems"
            node-key="id"
            :props="tocProps"
            default-expand-all
            highlight-current
            :current-node-key="activeTocId"
            @node-click="handleTocClick"
          />
        </ElScrollbar>
      </div>
    </ElCard>
  </div>
</template>
