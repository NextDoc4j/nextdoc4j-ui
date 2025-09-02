<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue';

import { SvgCopyIcon, SvgFormatLeftIcon } from '@vben/icons';
import { preferences } from '@vben/preferences';

import { ElMessage, ElTooltip } from 'element-plus';

import monaco from '#/monaco';

const props = withDefaults(
  defineProps<{
    copyable?: boolean;
    data: any;
    descriptions?: Record<string, string>;
    language?: string;
    oneOf?: boolean;
    readOnly?: boolean;
  }>(),
  {
    copyable: true,
    readOnly: true,
    oneOf: false,
    language: 'json',
    descriptions: () => ({}),
  },
);
defineEmits<{
  change: [];
}>();
const id = `json-viewer-${Date.now()}`;
let editor: any = null;
// 处理 HTML 标签
const processDescription = (desc: string) => {
  if (desc === undefined) {
    return '';
  } else if (desc.includes('<span')) {
    return desc.match(/\{([^}]+)\}/g);
  } else {
    return desc;
  }
};
// 格式化 JSON 并添加注释
const formatJsonWithComments = (data: any) => {
  const jsonStr = JSON.stringify(data, null, 2);
  const lines = jsonStr.split('\n');

  // 获取字段的完整路径
  const getFieldPath = (lineIndex: number): string[] => {
    const line = lines[lineIndex] ?? '';
    const indentation = line.match(/^\s*/)?.[0].length || 0;
    const level = indentation / 2;
    const currentKey = line.match(/"([^"]+)":/)?.[1] ?? '';
    const pathParts = [];
    if (currentKey) {
      pathParts.unshift(currentKey);
    }
    let currentLevel = level;
    while (lineIndex > 0) {
      lineIndex--;
      const parentLine = lines[lineIndex] ?? '';
      const parentIndent = parentLine.match(/^\s*/)?.[0].length || 0;
      const parentLevel = parentIndent / 2;
      if (parentLevel < currentLevel) {
        const parentKey = parentLine.match(/"([^"]+)":/)?.[1] ?? '';
        if (parentKey) {
          pathParts.unshift(
            parentLine?.includes('[') ? `${parentKey}[]` : parentKey,
          );
        }
        currentLevel = parentLevel;
      }
    }
    return pathParts;
  };

  // 处理每一行
  return lines
    .map((line, index) => {
      const keyMatch = line.match(/"([^"]+)":\s*([^,}\]]*)/);
      const key = keyMatch?.[1];
      const fullPath = getFieldPath(index);
      // 尝试获取描述（按优先级：完整路径 > 父路径+当前字段 > 当前字段）
      const desc =
        props.descriptions?.[fullPath.join('.')] ||
        props.descriptions?.[key] ||
        props.descriptions?.[fullPath?.slice(-2).join('.')];

      if (desc) {
        return `${line} ${line.trim() === '}' || line.trim() === ']' ? '' : `// ${processDescription(desc)}`}`;
      }

      return line;
    })
    .join('\n');
};

// 创建自定义主题
const createCustomTheme = () => {
  monaco.editor.defineTheme('jsonCustomTheme', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'string.key.json', foreground: '333333', fontStyle: 'bold' },
      { token: 'string.value.json', foreground: 'c41d7f' },
      { token: 'number.json', foreground: '1890ff' },
      { token: 'keyword.json', foreground: 'd32029' },
      { token: 'delimiter.bracket.json', foreground: '666666' },
      { token: 'delimiter.comma.json', foreground: '666666' },
      { token: 'comment.json', foreground: '666666', fontStyle: 'italic' },
    ],
    colors: {
      'editor.background': '#ffffff',
      'editor.lineHighlightBackground': '#000000',
    },
  });
  monaco.editor.defineTheme('jsonCustomDarkTheme', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'string.key.json', foreground: '666666', fontStyle: 'bold' },
      { token: 'string.value.json', foreground: 'c41d7f' },
      { token: 'number.json', foreground: '1890ff' },
      { token: 'keyword.json', foreground: 'd32029' },
      { token: 'delimiter.bracket.json', foreground: '666666' },
      { token: 'delimiter.comma.json', foreground: '666666' },
      { token: 'comment.json', foreground: '666666', fontStyle: 'italic' },
    ],
    colors: {
      'editor.lineHighlightBackground': '#000000',
    },
  });
};
onMounted(() => {
  const editorContainer = document.querySelector(`#${id}`) as HTMLElement;
  if (!editorContainer) return;
  createCustomTheme();
  editor = monaco.editor.create(editorContainer, {
    value: formatJsonWithComments(props.data),
    language: props.language,
    theme:
      preferences.theme.mode === 'dark'
        ? 'jsonCustomDarkTheme'
        : 'jsonCustomTheme',
    readOnly: props.readOnly,
    minimap: { enabled: false },
    tabSize: 2,
    insertSpaces: false,
    formatOnType: true,
    formatOnPaste: true,
    folding: true,
    lineNumbers: 'off',
    fontSize: 13,
    lineHeight: 1.6,
    renderLineHighlight: 'none',
    showFoldingControls: 'always',
    scrollBeyondLastLine: false,
    automaticLayout: true,
    wordWrap: 'on',
    wrappingStrategy: 'advanced',
    padding: { top: 8, bottom: 8 },
    scrollbar: {
      vertical: 'hidden',
      horizontal: 'hidden',
      useShadows: false,
      alwaysConsumeMouseWheel: false,
      verticalScrollbarSize: 0,
      horizontalScrollbarSize: 0,
    },
    overviewRulerBorder: false,
    fixedOverflowWidgets: true,
    foldingStrategy: 'indentation',
    contextmenu: false,
  });
  // 添加高度自适应
  const updateEditorHeight = () => {
    if (!editorContainer) return;
    const contentHeight = editor.getContentHeight();
    editorContainer.style.height = `${contentHeight}px`;
    editor.layout();
  };

  editor.onDidContentSizeChange(updateEditorHeight);

  // 初始化高度
  requestAnimationFrame(() => {
    updateEditorHeight();
    requestAnimationFrame(updateEditorHeight);
  });
});
const getEditorValue = () => {
  return editor.getValue();
};
const handleFormat = () => {
  try {
    // 验证JSON有效性
    JSON.parse(editor.getValue());
    // 执行格式化
    editor.getAction('editor.action.formatDocument').run();
  } catch (error) {
    ElMessage.error(`无效的JSON: ${error.message}`);
  }
};

// 监听数据变化
watch(
  () => props.data,
  (newData) => {
    if (editor) {
      editor.setValue(formatJsonWithComments(newData));
    }
  },
  { deep: true },
);

watch(
  () => preferences.theme.mode,
  (newData) => {
    monaco.editor.setTheme(
      newData === 'dark' ? 'jsonCustomDarkTheme' : 'jsonCustomTheme',
    );
  },
);

// 清理
onBeforeUnmount(() => {
  if (editor) {
    editor.dispose();
  }
});
defineExpose({
  getEditorValue,
});
</script>

<template>
  <div class="group relative">
    <div
      class="absolute right-0 top-0 z-[2] hidden cursor-pointer group-hover:flex"
    >
      <ElTooltip content="复制" placement="top" v-if="copyable">
        <div v-copy="JSON.stringify(data)" class="mx-2 size-4">
          <SvgCopyIcon />
        </div>
      </ElTooltip>
      <ElTooltip content="格式化" placement="top" v-if="!readOnly">
        <div @click="handleFormat" class="mx-2 size-4">
          <SvgFormatLeftIcon />
        </div>
      </ElTooltip>
    </div>
    <div :id="id"></div>
  </div>
</template>

<style scoped lang="scss"></style>
