<script lang="ts" setup>
import type { XmlTreeNode } from './xml-view.vue';

import { computed, ref } from 'vue';

import { useClipboard } from '@vueuse/core';
import { ElMessage } from 'element-plus';

const props = defineProps<{
  node: XmlTreeNode;
}>();

const isExpanded = ref(true);
const { copy } = useClipboard({ legacy: true });

// 开始标签的着色片段：空格已内联进 token 文本，避免依赖模板空白控制布局
const openTokens = computed(() => {
  const tokens: Array<{ cls: string; text: string }> = [
    { cls: 'xml-tag', text: `<${props.node.tag}` },
  ];
  props.node.attrs.forEach((attr) => {
    tokens.push(
      { cls: 'xml-attr-name', text: ` ${attr.name}` },
      { cls: 'xml-tag', text: '=' },
      { cls: 'xml-attr-value', text: `"${attr.value}"` },
    );
  });
  tokens.push({ cls: 'xml-tag', text: '>' });
  return tokens;
});

const closeTag = computed(() => `</${props.node.tag}>`);

const toggle = () => {
  isExpanded.value = !isExpanded.value;
};

/**
 * 复制当前节点对应的原始 XML 片段。
 */
const copyNode = async () => {
  try {
    await copy(props.node.copyXml);
    ElMessage.success('已复制 XML 节点');
  } catch {
    ElMessage.error('复制失败');
  }
};
</script>

<template>
  <div class="xml-node">
    <!-- 叶子节点：单行展示 <tag attr="v">text</tag> -->
    <div v-if="node.leaf" class="xml-node__line">
      <span class="xml-node__spacer"></span>
      <span
        v-for="(token, index) in openTokens"
        :key="index"
        :class="token.cls"
        v-text="token.text"
      ></span>
      <span v-if="node.text" class="xml-text">{{ node.text }}</span>
      <span class="xml-tag">{{ closeTag }}</span>
      <button type="button" class="xml-copy-btn" @click="copyNode">复制</button>
    </div>

    <!-- 容器节点：可折叠 -->
    <template v-else>
      <div class="xml-node__line">
        <button
          type="button"
          class="xml-toggle"
          :class="{ 'xml-toggle--collapsed': !isExpanded }"
          @click="toggle"
        ></button>
        <span
          v-for="(token, index) in openTokens"
          :key="index"
          :class="token.cls"
          v-text="token.text"
        ></span>
        <span v-if="!isExpanded" class="xml-ellipsis" @click="toggle">…</span>
        <span v-if="!isExpanded" class="xml-tag">{{ closeTag }}</span>
        <button type="button" class="xml-copy-btn" @click="copyNode">
          复制
        </button>
      </div>

      <div v-show="isExpanded" class="xml-node__children">
        <XmlNode
          v-for="(child, index) in node.children"
          :key="index"
          :node="child"
        />
      </div>

      <div v-show="isExpanded" class="xml-node__line">
        <span class="xml-node__spacer"></span>
        <span class="xml-tag">{{ closeTag }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.xml-node {
  min-width: max-content;
}

.xml-node__children {
  padding-left: 16px;
}

.xml-node__line {
  display: flex;
  align-items: center;
  white-space: pre;
}

/* 叶子/结束标签行左侧占位，与折叠按钮宽度对齐 */
.xml-node__spacer {
  display: inline-block;
  flex: none;
  width: 16px;
}

.xml-toggle {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  cursor: pointer;
  background: none;
  border: none;
}

.xml-toggle::before {
  content: '';
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  border-left: 5px solid currentcolor;
  transform: rotate(90deg);
  transition: transform 0.14s ease;
}

.xml-toggle--collapsed::before {
  transform: rotate(0deg);
}

.xml-ellipsis {
  padding: 0 4px;
  cursor: pointer;
}

.xml-copy-btn {
  visibility: hidden;
  flex: none;
  padding: 0 6px;
  margin-left: 8px;
  font-size: 11px;
  cursor: pointer;
  background: none;
  border: none;
  border-radius: 4px;
}

.xml-node__line:hover > .xml-copy-btn {
  visibility: visible;
}

.theme-dark .xml-toggle,
.theme-dark .xml-ellipsis {
  color: #858585;
}

.theme-dark .xml-tag {
  color: #569cd6;
}

.theme-dark .xml-attr-name {
  color: #9cdcfe;
}

.theme-dark .xml-attr-value {
  color: #ce9178;
}

.theme-dark .xml-text {
  color: #d4d4d4;
}

.theme-dark .xml-copy-btn {
  color: #858585;
}

.theme-dark .xml-copy-btn:hover {
  color: #fff;
  background: rgb(255 255 255 / 10%);
}

.theme-light .xml-toggle,
.theme-light .xml-ellipsis {
  color: #6a737d;
}

.theme-light .xml-tag {
  color: #22863a;
}

.theme-light .xml-attr-name {
  color: #6f42c1;
}

.theme-light .xml-attr-value {
  color: #032f62;
}

.theme-light .xml-text {
  color: #24292e;
}

.theme-light .xml-copy-btn {
  color: #6a737d;
}

.theme-light .xml-copy-btn:hover {
  color: #24292e;
  background: rgb(0 0 0 / 5%);
}
</style>
