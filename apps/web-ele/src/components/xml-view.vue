<script lang="ts" setup>
import { computed } from 'vue';

import XmlNode from './xml-node.vue';

// XML 树节点：element 保留标签与属性，leaf 直接携带文本内容
export interface XmlTreeNode {
  attrs: Array<{ name: string; value: string }>;
  children: XmlTreeNode[];
  // 该节点对应的原始 XML 片段，供逐节点复制使用
  copyXml: string;
  leaf: boolean;
  tag: string;
  text: string;
}

const props = withDefaults(
  defineProps<{
    dark?: boolean;
    xml: string;
  }>(),
  {
    dark: false,
  },
);

/**
 * 将单个 DOM 元素转换为 XML 树节点。
 * 含子元素时作为可折叠容器（忽略纯空白文本），否则作为携带文本的叶子节点。
 */
const elementToNode = (el: Element): XmlTreeNode => {
  const attrs = [...el.attributes].map((attr) => ({
    name: attr.name,
    value: attr.value,
  }));
  const copyXml = new XMLSerializer().serializeToString(el);
  const elementChildren = [...el.children];

  if (elementChildren.length > 0) {
    return {
      attrs,
      children: elementChildren.map((child) => elementToNode(child)),
      copyXml,
      leaf: false,
      tag: el.tagName,
      text: '',
    };
  }

  return {
    attrs,
    children: [],
    copyXml,
    leaf: true,
    tag: el.tagName,
    text: el.textContent?.trim() ?? '',
  };
};

// 解析结果：提取 XML 声明（prolog）单独展示，其余转换为树
const parsed = computed<{
  error: null | string;
  prolog: string;
  root: null | XmlTreeNode;
}>(() => {
  const source = props.xml || '';
  const prolog = source.match(/<\?xml[^>]*\?>/i)?.[0] ?? '';

  try {
    const doc = new DOMParser().parseFromString(source, 'application/xml');
    if (doc.querySelector('parsererror')) {
      return { error: 'XML 解析失败', prolog, root: null };
    }
    const rootEl = doc.documentElement;
    if (!rootEl) {
      return { error: 'XML 内容为空', prolog, root: null };
    }
    return { error: null, prolog, root: elementToNode(rootEl) };
  } catch {
    return { error: 'XML 解析失败', prolog, root: null };
  }
});
</script>

<template>
  <div
    class="xml-view font-mono text-sm"
    :class="dark ? 'theme-dark' : 'theme-light'"
  >
    <!-- 解析失败时回退展示原始文本，避免丢失响应内容 -->
    <pre v-if="parsed.error" class="xml-view__raw">{{ xml }}</pre>
    <template v-else>
      <div v-if="parsed.prolog" class="xml-view__prolog">
        {{ parsed.prolog }}
      </div>
      <XmlNode v-if="parsed.root" :node="parsed.root" />
    </template>
  </div>
</template>

<style scoped>
.xml-view {
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 12px 16px;
  overflow: auto;
  line-height: 1.6;
  background: transparent;
}

.xml-view__prolog {
  margin-bottom: 2px;
  color: var(--el-text-color-placeholder);
}

.xml-view__raw {
  margin: 0;
  overflow-x: auto;
  word-break: break-all;
  white-space: pre-wrap;
}
</style>
