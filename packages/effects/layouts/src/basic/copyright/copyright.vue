<script lang="ts" setup>
import { computed } from 'vue';

import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';

interface Props {
  companyName?: string;
  companySiteLink?: string;
  date?: string;
  icp?: string;
  icpLink?: string;
}

defineOptions({
  name: 'Copyright',
});

const props = withDefaults(defineProps<Props>(), {
  companyName: 'Nextdoc4j',
  companySiteLink: '',
  date: '2025',
  icp: '',
  icpLink: '',
});

const md = new MarkdownIt({
  html: false, // 禁止原始 HTML
  linkify: true, // 自动识别链接
  breaks: true, // 换行转 <br>
});

// 安全渲染函数
function renderMarkdown(text: string) {
  return DOMPurify.sanitize(md.renderInline(text));
}

// 计算渲染结果
const icpHtml = computed(() => (props.icp ? renderMarkdown(props.icp) : ''));
const dateHtml = computed(() => {
  const text = props.date.includes('Copyright')
    ? props.date
    : `Copyright © ${props.date}`;
  return renderMarkdown(text);
});
const companyHtml = computed(() =>
  props.companyName ? renderMarkdown(props.companyName) : '',
);
</script>

<template>
  <div class="text-md flex-center">
    <!-- ICP Link -->
    <a
      v-if="icpHtml"
      :href="icpLink || 'javascript:void(0)'"
      class="hover:text-primary-hover mx-1"
      target="_blank"
      v-html="icpHtml"
    ></a>

    <!-- Copyright Text -->
    <span v-html="dateHtml"></span>

    <!-- Company Link -->
    <a
      v-if="companyHtml"
      :href="companySiteLink || 'javascript:void(0)'"
      class="hover:text-primary-hover mx-1"
      target="_blank"
      v-html="companyHtml"
    ></a>
  </div>
</template>
