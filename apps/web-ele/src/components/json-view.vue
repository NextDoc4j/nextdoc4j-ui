<script setup lang="ts">
import {
  computed,
  onBeforeMount,
  onBeforeUnmount,
  onMounted,
  watch,
} from 'vue';

import { SvgCopyIcon, SvgFormatLeftIcon } from '@vben/icons';
import { preferences } from '@vben/preferences';

import { ElImage, ElMessage, ElTooltip } from 'element-plus';

import monaco from '#/monaco';

const props = withDefaults(
  defineProps<{
    copyable?: boolean;
    data: any;
    descriptions?: Record<string, string>;
    imageRender?: boolean;
    language?: string;
    loading?: boolean;
    oneOf?: boolean;
    readOnly?: boolean;
  }>(),
  {
    copyable: true,
    readOnly: true,
    oneOf: false,
    language: 'json',
    imageRender: false,
    loading: false,
    descriptions: () => ({}),
  },
);

defineEmits<{
  change: [];
}>();

// 递归查找所有 base64 图片及其 key
const findBase64Images = (obj: any): Array<{ key: string; value: string }> => {
  const images: Array<{ key: string; value: string }> = [];

  const traverse = (item: any, parentKey = '') => {
    if (typeof item === 'string' && isBase64Image(item)) {
      images.push({ key: parentKey, value: item });
    } else if (Array.isArray(item)) {
      item.forEach((subItem, index) => {
        const arrayKey = parentKey ? `${parentKey}[${index}]` : `[${index}]`;
        traverse(subItem, arrayKey);
      });
    } else if (typeof item === 'object' && item !== null) {
      Object.entries(item).forEach(([key, value]) => {
        const currentKey = parentKey ? `${parentKey}.${key}` : key;
        traverse(value, currentKey);
      });
    }
  };

  traverse(obj);
  return images;
};

// 计算属性：是否有 base64 图片
const hasBase64Images = computed(() => {
  return base64Images.value.length > 0;
});

// 计算属性：所有 base64 图片数据
const base64Images = computed(() => {
  return findBase64Images(props.data);
});

// 检测是否为 base64 图片
const isBase64Image = (value: string): boolean => {
  // 检查是否为 base64 编码的图片
  const base64ImageRegex =
    /^data:image\/(?:jpeg|jpg|png|gif|webp|svg\+xml);base64,/i;
  return base64ImageRegex.test(value);
};

const id = `json-viewer-${Math.random().toString(36).slice(2, 11)}-${Date.now()}`;
let editor: any = null;
let isDestroyed = false;

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
  if (typeof jsonStr !== 'string') {
    return '';
  }
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
      const key = keyMatch?.[1] ?? '';
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

const resolveEditorValue = (data: any, language: string) => {
  if (language === 'json') {
    return formatJsonWithComments(data);
  }

  if (typeof data === 'string') {
    return data;
  }

  try {
    return JSON.stringify(data, null, 2) ?? '';
  } catch {
    return String(data ?? '');
  }
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

onBeforeMount(() => {
  isDestroyed = false;
});

onMounted(() => {
  if (isDestroyed) return;

  const editorContainer = document.querySelector(`#${id}`) as HTMLElement;
  if (!editorContainer) return;

  if (editor) {
    editor.dispose();
    editor = null;
  }

  createCustomTheme();
  editor = monaco.editor.create(editorContainer, {
    value: resolveEditorValue(props.data, props.language),
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
  // 添加高度自适应，设置合理的默认高度
  const updateEditorHeight = () => {
    if (!editorContainer) return;
    const contentHeight = editor.getContentHeight();
    const defaultHeight = 500; // 默认高度，避免内容少时留白过多

    // 使用默认高度和内容高度的最大值，确保不会小于默认值
    const targetHeight = Math.max(defaultHeight, Math.min(contentHeight));
    editorContainer.style.height = `${targetHeight}px`;
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
  if (!editor) return;

  if (props.language !== 'json') {
    editor.getAction('editor.action.formatDocument').run();
    return;
  }

  try {
    // 验证JSON有效性
    JSON.parse(editor.getValue());
    // 执行格式化
    editor.getAction('editor.action.formatDocument').run();
  } catch (error: unknown) {
    if (error instanceof Error) {
      ElMessage.error(`无效的JSON: ${error.message}`);
    } else {
      ElMessage.error(`无效的JSON: ${String(error)}`);
    }
  }
};
const handleCopy = async () => {
  try {
    const value = editor.getValue();
    await navigator.clipboard.writeText(value);
    ElMessage.success('复制成功');
  } catch {
    ElMessage.error('复制失败');
  }
};

// 监听数据变化
watch(
  () => props.data,
  (newData) => {
    if (editor) {
      editor.setValue(resolveEditorValue(newData, props.language));
    }
  },
  { deep: true },
);

watch(
  () => props.language,
  (newLanguage) => {
    if (!editor) return;

    const model = editor.getModel();
    if (model) {
      monaco.editor.setModelLanguage(model, newLanguage || 'plaintext');
    }
    editor.setValue(resolveEditorValue(props.data, newLanguage || 'plaintext'));
  },
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
  isDestroyed = true;

  if (editor) {
    try {
      editor.onDidContentSizeChange(() => {});
      editor.dispose();
      editor = null;
    } catch (error) {
      console.warn('Editor disposal error:', error);
    }
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
        <div @click="handleCopy" class="mx-2 size-8">
          <SvgCopyIcon />
        </div>
      </ElTooltip>
      <ElTooltip content="格式化" placement="top" v-if="!readOnly">
        <div @click="handleFormat" class="mx-2 size-8">
          <SvgFormatLeftIcon />
        </div>
      </ElTooltip>
    </div>

    <!-- 主要内容区域：JSON 编辑器和图片预览并排显示 -->
    <div class="flex gap-4">
      <!-- JSON 编辑器 -->
      <div class="relative flex-1">
        <div :id="id"></div>
        <!-- Loading 覆盖层 -->
        <div
          v-if="loading"
          class="absolute inset-0 z-10 flex items-center justify-center bg-white bg-opacity-75"
        >
          <svg class="animate-spin" width="24" height="24" viewBox="0 0 24 24">
            <path
              fill="#409EFF"
              d="M12,4V2A10,10 0 0,0 2,12H4A8,8 0 0,1 12,4Z"
            />
          </svg>
        </div>
      </div>

      <!-- Base64 图片预览区域 -->
      <div
        v-if="hasBase64Images && imageRender"
        class="base64-images-preview w-64 flex-shrink-0"
      >
        <div class="sticky top-4">
          <h4 class="mb-3 text-sm font-medium text-gray-700">图片预览</h4>
          <div class="space-y-3">
            <div
              v-for="(imageItem, index) in base64Images"
              :key="index"
              class="base64-image-container"
            >
              <div class="image-key mb-2 text-xs font-medium text-gray-600">
                {{ imageItem.key }}
              </div>
              <ElImage
                :src="imageItem.value"
                :alt="`Base64 image: ${imageItem.key}`"
                class="base64-image"
                fit="contain"
                :preview-src-list="[imageItem.value]"
                :initial-index="0"
                preview-teleported
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss">
/* Base64 图片样式 */
.base64-images-preview {
  padding-left: 16px;
  border-left: 1px solid var(--el-border-color);
}

.base64-image-container {
  padding: 12px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-base);
  transition: all 0.3s ease;
}

.base64-image-container:hover {
  border-color: var(--el-color-primary);
  box-shadow: 0 2px 8px var(--el-color-primary-light-8);
}

.image-key {
  padding: 6px 8px;
  margin-bottom: 8px;
  font-size: var(--el-font-size-extra-small);
  font-weight: 500;
  color: var(--el-text-color-regular);
  word-break: break-all;
  background: var(--el-color-primary-light-9);
  border: 1px solid var(--el-color-primary-light-7);
  border-radius: var(--el-border-radius-base);
}

.base64-image {
  width: 100%;
  height: auto;
  border-radius: var(--el-border-radius-base);
}

.base64-image :deep(.el-image__inner) {
  border-radius: var(--el-border-radius-base);
}

.base64-images-preview h4 {
  padding-bottom: 8px;
  margin-bottom: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  border-bottom: 1px solid var(--el-border-color-lighter);
}
</style>
