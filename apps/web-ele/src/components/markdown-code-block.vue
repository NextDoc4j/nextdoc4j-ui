<script setup lang="ts">
import { computed, useSlots } from 'vue';

import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import MarkdownIt from 'markdown-it';

import 'highlight.js/styles/atom-one-light.css';
import '#/assets/style/github-markdown.css';

const props = withDefaults(
  defineProps<{
    code: string;
    dark?: boolean;
    language?: string;
  }>(),
  {
    dark: false,
    language: 'plaintext',
  },
);

const slots = useSlots();

const md = new MarkdownIt({
  html: false,
  xhtmlOut: true,
  linkify: false,
  breaks: false,
  typographer: false,
  highlight(str: string, lang: string) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`;
      } catch {}
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`;
  },
});

const theme = computed(() => (props.dark ? 'dark' : 'light'));
const hasToolbar = computed(() => Boolean(slots.toolbar));

const fencedMarkdown = computed(() => {
  const content = props.code || '';
  const maxBacktickRun = Math.max(
    0,
    ...(content.match(/`+/g)?.map((segment) => segment.length) || []),
  );
  const fence = '`'.repeat(Math.max(3, maxBacktickRun + 1));
  return `${fence}${props.language || 'plaintext'}\n${content}\n${fence}`;
});

const renderedHtml = computed(() => {
  return DOMPurify.sanitize(md.render(fencedMarkdown.value));
});
</script>

<template>
  <div
    class="markdown-code-block"
    :class="{ 'markdown-code-block--with-toolbar': hasToolbar }"
  >
    <div v-if="hasToolbar" class="markdown-code-block__toolbar">
      <slot name="toolbar"></slot>
    </div>
    <div class="markdown-code-block__scroller">
      <div
        class="markdown-body markdown-code-block__body"
        :data-theme="theme"
        v-html="renderedHtml"
      ></div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.markdown-code-block {
  position: relative;
  display: flex;
  flex: 1;
  min-width: 0;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.markdown-code-block__toolbar {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 1;
  display: flex;
  gap: 8px;
  align-items: center;
}

.markdown-code-block__scroller {
  flex: 1;
  min-width: 0;
  height: 100%;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}

.markdown-code-block__body {
  width: 100%;
  min-width: 0;
  min-height: 100%;
  background: transparent;
}

.markdown-code-block__body :deep(> *:first-child) {
  margin-top: 0;
}

.markdown-code-block__body :deep(> *:last-child) {
  margin-bottom: 0;
}

.markdown-code-block__body :deep(pre) {
  margin: 0;
  overflow: auto;
  border-radius: calc(var(--radius) * 0.94);
}

.markdown-code-block__body :deep(pre > code) {
  display: block;
  min-width: max-content;
}
</style>
