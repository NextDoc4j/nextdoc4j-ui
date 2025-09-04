<script lang="ts" setup>
import type { MarkDownDes } from '#/typings/openApi';

import { computed, onBeforeMount, ref } from 'vue';
import { useRoute } from 'vue-router';

import DOMPurify from 'dompurify';
import { ElCard, ElCol, ElRow } from 'element-plus';
import hljs from 'highlight.js';
import MarkdownIt from 'markdown-it';

import { useApiStore } from '#/store';

import 'highlight.js/styles/atom-one-light.css';

const route = useRoute();
const apiStore = useApiStore();

const md = new MarkdownIt({
  html: true, // 禁止原始 HTML
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
</script>
<template>
  <div class="relative box-border h-full w-full overflow-y-auto p-5">
    <ElCard>
      <div v-html="contentHtml" class="markdown-body leading-relaxed"></div>
      <ElRow class="markdown-body">
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
    </ElCard>
  </div>
</template>
<style lang="scss">
.markdown-body {
  padding: 20px;
  line-height: 1.6;
  color: var(--el-text-color-regular);

  table {
    width: 100%;
    border-collapse: collapse;

    th {
      background-color: var(--el-fill-color);
    }

    td {
      padding: 8px;
      text-align: left;
      border: 1px solid var(--el-border-color);
    }
  }

  code {
    padding: 0.2em 0.4em;
    color: var(--el-text-color-regular);
    background-color: var(--el-fill-color);
    border-radius: 3px;
  }

  pre {
    padding: 16px;
    overflow: auto;
    background-color: var(--el-fill-color);
    border-radius: 3px;
  }

  .hljs {
    padding: 10px !important;
  }
}
</style>
