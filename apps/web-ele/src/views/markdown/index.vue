<script lang="ts" setup>
import type { MarkDownDes } from '#/typings/openApi';

import { computed, onBeforeMount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';

import { preferences } from '@vben/preferences';

import DOMPurify from 'dompurify';
import { ElCol, ElRow } from 'element-plus';
import hljs from 'highlight.js';
import MarkdownIt from 'markdown-it';
import Anchor from 'markdown-it-anchor';
import tocPlugin from 'markdown-it-toc-done-right';

import { useApiStore } from '#/store';

import 'highlight.js/styles/atom-one-light.css';
import '#/assets/style/github-markdown.css';

const route = useRoute();
const apiStore = useApiStore();
const nav = ref();
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
})
  .use(Anchor, {
    permalink: false,
    permalinkBefore: false,
    permalinkSymbol: '#',
  })
  .use(tocPlugin, {
    maxDepth: 3, // 可调整的最大标题层级
    bullets: '- ', // 目录条目的符号
    anchorLinkSymbol: '', // 是否显示锚点链接，默认为'
    containerClass: 'toc',
    callback(html: string) {
      // 把目录单独列出来
      nav.value = html;
    },
  });

const markDown = ref();
const contentHtml = computed(() =>
  markDown.value.content ? renderMarkdown(markDown.value.content) : '',
);
// 安全渲染函数
function renderMarkdown(text: string) {
  return DOMPurify.sanitize(md.render(text));
}

// 配置链接在新窗口打开
const defaultRender =
  md.renderer.rules.link_open ||
  function (
    tokens: { [x: string]: { attrPush: (arg0: string[]) => void } },
    idx: number | string,
    options: Record<string, any>,
    env: string,
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
onMounted(() => {
  // 处理目录点击事件
  document.querySelectorAll('.toc a').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.target instanceof HTMLElement) {
        const targetId = e.target.getAttribute('href')?.slice(1) || '';
        // eslint-disable-next-line unicorn/prefer-query-selector
        const targetElement = document.getElementById(targetId);
        if (targetElement) {
          targetElement.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
          });
        }
      }
    });
  });
});
</script>
<template>
  <div class="relative box-border h-full w-full p-5">
    <ElRow class="h-full w-full">
      <ElCol
        :span="18"
        class="h-full w-full overflow-y-auto overflow-x-hidden pr-2"
      >
        <div
          v-html="contentHtml"
          class="markdown-body"
          :data-theme="preferences.theme.mode"
        ></div>
        <ElRow class="mt-8">
          <ElCol
            :span="12"
            class="text-xs text-[var(--el-text-color-placeholder)]"
          >
            更新时间：{{ markDown.lastModified }}
          </ElCol>
          <ElCol
            :span="12"
            class="text-right text-xs text-[var(--el-text-color-placeholder)]"
          >
            文件大小：{{ markDown.contentLength }}
          </ElCol>
        </ElRow>
      </ElCol>
      <ElCol :span="6" class="h-full w-full">
        <div
          v-html="nav"
          class="nav h-full w-full overflow-y-auto overflow-x-hidden"
        ></div>
      </ElCol>
    </ElRow>
  </div>
</template>
<style lang="scss">
.nav {
  ol {
    counter-reset: list-item;
  }

  li {
    display: block;
    padding-left: 6px;
    font-size: 0.9rem;
    line-height: 1.8;
    counter-increment: list-item;
  }
}
</style>
