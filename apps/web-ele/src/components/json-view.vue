<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue';

import { SvgCopyIcon, SvgFormatLeftIcon } from '@vben/icons';
import { preferences } from '@vben/preferences';

import { usePreferredDark } from '@vueuse/core';
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

const emit = defineEmits<{
  change: [value: string];
}>();

const GLOBAL_MONACO_THEME_STATE_KEY = '__NEXTDOC4J_MONACO_THEME_STATE__';
const globalMonacoThemeState = ((globalThis as any)[
  GLOBAL_MONACO_THEME_STATE_KEY
] || ((globalThis as any)[GLOBAL_MONACO_THEME_STATE_KEY] = {})) as {
  currentTheme?: string;
  themesInitialized?: boolean;
};

const findBase64Images = (obj: any): Array<{ key: string; value: string }> => {
  const images: Array<{ key: string; value: string }> = [];
  const seen = new Set();

  const traverse = (item: any, parentKey = '') => {
    if (item !== null && typeof item === 'object') {
      if (seen.has(item)) return;
      seen.add(item);
    }

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

const hasBase64Images = computed(() => base64Images.value.length > 0);
const base64Images = computed(() => findBase64Images(props.data));

const isBase64Image = (value: string): boolean => {
  return /^data:image\/(?:jpeg|jpg|png|gif|webp|svg\+xml);base64,/i.test(value);
};

const id = `json-viewer-${Math.random().toString(36).slice(2, 11)}`;
let editor: any = null;
let isDestroyed = false;
let resizeObserver: null | ResizeObserver = null;
let updateEditorHeight: (() => void) | null = null;
let themeSwitchFrame: null | number = null;
const preferredDark = usePreferredDark();

const processDescription = (desc: string) => {
  if (!desc) return '';
  if (desc.includes('<span')) {
    const matches = desc.match(/\{([^}]+)\}/g);
    return matches
      ? matches.map((m) => m.replaceAll(/[{}]/g, '')).join(' ')
      : desc;
  }
  return desc;
};

const formatJsonWithComments = (data: any) => {
  const jsonStr = JSON.stringify(data, null, 2);
  if (typeof jsonStr !== 'string') return '';

  const lines = jsonStr.split('\n');
  const getFieldPath = (lineIndex: number): string[] => {
    const line = lines[lineIndex] ?? '';
    const indentation = line.match(/^\s*/)?.[0].length || 0;
    const level = indentation / 2;
    const currentKey = line.match(/"([^"]+)":/)?.[1] ?? '';
    const pathParts = [];
    if (currentKey) pathParts.unshift(currentKey);

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

  return lines
    .map((line, index) => {
      const keyMatch = line.match(/"([^"]+)":\s*([^,}\]]*)/);
      const key = keyMatch?.[1] ?? '';
      const fullPath = getFieldPath(index);

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
  if (language === 'json') return formatJsonWithComments(data);
  if (typeof data === 'string') return data;
  try {
    return JSON.stringify(data, null, 2) ?? '';
  } catch {
    return String(data ?? '');
  }
};

const createCustomTheme = () => {
  if (globalMonacoThemeState.themesInitialized) return;

  monaco.editor.defineTheme('jsonCustomTheme', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'string.key.json', foreground: 'C41D7F' },
      { token: 'string.value.json', foreground: '008000' },
      { token: 'number.json', foreground: '1890FF' },
      { token: 'keyword.json', foreground: '722ED1' },
      { token: 'delimiter.bracket.json', foreground: '333333' },
      { token: 'delimiter.comma.json', foreground: '333333' },
      { token: 'comment.json', foreground: '008000' },
    ],
    colors: {
      'editor.background': '#00000000',
      'editorLineNumber.foreground': '#D9D9D9',
      'editor.lineHighlightBackground': '#00000000',
      'editor.lineHighlightBorder': '#00000000',
    },
  });

  monaco.editor.defineTheme('jsonCustomDarkTheme', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'string.key.json', foreground: 'E879F9' },
      { token: 'string.value.json', foreground: '4ADE80' },
      { token: 'number.json', foreground: '60A5FA' },
      { token: 'keyword.json', foreground: 'C084FC' },
      { token: 'delimiter.bracket.json', foreground: 'A3A3A3' },
      { token: 'delimiter.comma.json', foreground: 'A3A3A3' },
      { token: 'comment.json', foreground: '4ADE80', fontStyle: 'italic' },
    ],
    colors: {
      'editor.background': '#00000000',
      'editorLineNumber.foreground': '#525252',
      'editor.lineHighlightBackground': '#00000000',
      'editor.lineHighlightBorder': '#00000000',
    },
  });
  globalMonacoThemeState.themesInitialized = true;
};

const resolveThemeName = (mode: string) =>
  mode === 'dark' ? 'jsonCustomDarkTheme' : 'jsonCustomTheme';

const resolveThemeMode = (mode: string) => {
  if (mode === 'auto') return preferredDark.value ? 'dark' : 'light';
  return mode;
};

const applyTheme = (mode: string) => {
  const themeName = resolveThemeName(resolveThemeMode(mode));
  if (globalMonacoThemeState.currentTheme === themeName) return;
  monaco.editor.setTheme(themeName);
  globalMonacoThemeState.currentTheme = themeName;
};

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
    theme: resolveThemeName(resolveThemeMode(preferences.theme.mode)),
    readOnly: props.readOnly,
    minimap: { enabled: false },
    tabSize: 2,
    insertSpaces: true,
    formatOnType: true,
    formatOnPaste: true,
    folding: true,
    lineNumbers: 'on',
    lineNumbersMinChars: 3,
    lineDecorationsWidth: 0,
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.6,
    renderLineHighlight: 'none',
    showFoldingControls: 'mouseover',
    scrollBeyondLastLine: false,
    automaticLayout: false,
    wordWrap: 'on',
    // 关键修改 1：大幅增加 bottom padding，保证代码最后一行下面永远有足够大的空白属于编辑器可以点击
    padding: { top: 16, bottom: 80 },
    scrollbar: {
      vertical: 'hidden',
      horizontal: 'hidden',
      verticalScrollbarSize: 0,
      horizontalScrollbarSize: 0,
      alwaysConsumeMouseWheel: false,
      useShadows: false,
    },
    overviewRulerBorder: false,
    hideCursorInOverviewRuler: true,
    contextmenu: false,
    matchBrackets: 'never',
  });

  updateEditorHeight = () => {
    if (!editorContainer) return;
    const contentHeight = editor.getContentHeight();
    const containerHeight = editorContainer.parentElement?.clientHeight ?? 0;
    const defaultHeight = 200;
    const targetHeight = Math.max(
      defaultHeight,
      contentHeight,
      containerHeight,
    );
    const nextHeight = `${targetHeight}px`;
    if (editorContainer.style.height !== nextHeight) {
      editorContainer.style.height = nextHeight;
    }
    editor.layout();
  };

  editor.onDidContentSizeChange(() => updateEditorHeight?.());
  editor.onDidChangeModelContent(() => {
    emit('change', editor.getValue());
  });

  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      editor.layout();
    });
    resizeObserver.observe(editorContainer);
  }

  applyTheme(preferences.theme.mode);

  requestAnimationFrame(() => {
    updateEditorHeight?.();
    requestAnimationFrame(() => updateEditorHeight?.());
  });
});

const getEditorValue = () => editor?.getValue();
const setEditorValue = (value: string) => {
  if (!editor) return;
  editor.setValue(value ?? '');
  updateEditorHeight?.();
};

const prettyFormatXml = (xmlString: string) => {
  const compact = xmlString
    .replaceAll(/>\s+</g, '><')
    .replaceAll(/(>)(<)(\/*)/g, '$1\n$2$3')
    .trim();

  if (!compact) return '';

  const lines = compact
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  let indent = 0;
  const output: string[] = [];

  lines.forEach((line) => {
    if (/^<\//.test(line)) {
      indent = Math.max(indent - 1, 0);
    }

    output.push(`${'  '.repeat(indent)}${line}`);

    const isDeclaration = /^<\?xml/i.test(line);
    const isDocType = line.startsWith('<!');
    const isClosing = /^<\//.test(line);
    const isSelfClosing = /\/>$/.test(line);
    const hasInlinePair = /^<[^/!][^>]*>.*<\/[^>]+>$/.test(line);
    const isOpenTag = /^<[^!?/][^>]*>$/.test(line);

    if (
      !isDeclaration &&
      !isDocType &&
      !isClosing &&
      !isSelfClosing &&
      !hasInlinePair &&
      isOpenTag
    ) {
      indent += 1;
    }
  });

  return output.join('\n');
};

const formatXmlForEditor = (source: string) => {
  const raw = (source || '').trim();
  if (!raw) return '';

  const declaration = raw.match(/^<\?xml[^>]*\?>/i)?.[0] || '';

  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(raw, 'application/xml');
    const parserError = xmlDoc.querySelector('parsererror');

    if (parserError) {
      ElMessage.error('无效的 XML');
      return source;
    }

    const serialized = new XMLSerializer().serializeToString(xmlDoc);
    const formatted = prettyFormatXml(serialized);

    if (declaration && !formatted.startsWith('<?xml')) {
      return `${declaration}\n${formatted}`;
    }

    return formatted;
  } catch {
    ElMessage.error('XML 格式化失败');
    return source;
  }
};

const handleFormat = () => {
  if (!editor) return;
  if (props.language === 'xml') {
    const source = editor.getValue();
    const formatted = formatXmlForEditor(source);
    if (formatted !== source) {
      editor.setValue(formatted);
      updateEditorHeight?.();
    }
    return;
  }
  if (props.language !== 'json') {
    editor.getAction('editor.action.formatDocument').run();
    return;
  }
  try {
    JSON.parse(editor.getValue());
    editor.getAction('editor.action.formatDocument').run();
  } catch {
    ElMessage.error(`无效的 JSON`);
  }
};

const handleCopy = async () => {
  try {
    await navigator.clipboard.writeText(editor.getValue());
    ElMessage.success('复制成功');
  } catch {
    ElMessage.error('复制失败');
  }
};

// 关键修改 3：增加点击全区域聚焦功能
const focusEditor = () => {
  if (editor) {
    editor.focus();
  }
};

watch(
  () => props.data,
  (newData) => {
    if (!editor) return;
    const nextValue = resolveEditorValue(newData, props.language);
    if (editor.getValue() !== nextValue) {
      editor.setValue(nextValue);
    }
  },
);

watch(
  () => props.language,
  (newLanguage) => {
    if (!editor) return;
    const model = editor.getModel();
    if (model) {
      monaco.editor.setModelLanguage(model, newLanguage || 'plaintext');
    }
    const nextValue = resolveEditorValue(
      props.data,
      newLanguage || 'plaintext',
    );
    if (editor.getValue() !== nextValue) {
      editor.setValue(nextValue);
    }
  },
);

watch([() => preferences.theme.mode, () => preferredDark.value], ([mode]) => {
  if (!editor) return;
  if (themeSwitchFrame) cancelAnimationFrame(themeSwitchFrame);
  themeSwitchFrame = requestAnimationFrame(() => {
    applyTheme(mode);
    themeSwitchFrame = null;
  });
});

onBeforeUnmount(() => {
  isDestroyed = true;
  if (themeSwitchFrame) cancelAnimationFrame(themeSwitchFrame);
  if (resizeObserver) resizeObserver.disconnect();
  updateEditorHeight = null;
  if (editor) {
    editor.dispose();
    editor = null;
  }
});

defineExpose({ getEditorValue, setEditorValue, focusEditor });
</script>

<template>
  <div class="json-viewer-ultimate group relative w-full bg-transparent">
    <div class="absolute right-2 top-2 z-10 hidden gap-1.5 group-hover:flex">
      <ElTooltip content="复制" placement="top" v-if="copyable">
        <button
          @click="handleCopy"
          class="flex size-7 cursor-pointer items-center justify-center rounded border border-gray-100 bg-white/80 text-gray-400 shadow-sm backdrop-blur-sm transition-all hover:text-blue-500 dark:border-gray-800 dark:bg-black/50 dark:text-gray-300 dark:hover:text-blue-400"
        >
          <SvgCopyIcon class="size-3.5" />
        </button>
      </ElTooltip>
      <ElTooltip content="格式化" placement="top" v-if="!readOnly">
        <button
          @click="handleFormat"
          class="flex size-7 cursor-pointer items-center justify-center rounded border border-gray-100 bg-white/80 text-gray-400 shadow-sm backdrop-blur-sm transition-all hover:text-blue-500 dark:border-gray-800 dark:bg-black/50 dark:text-gray-300 dark:hover:text-blue-400"
        >
          <SvgFormatLeftIcon class="size-3.5" />
        </button>
      </ElTooltip>
    </div>

    <div class="flex w-full">
      <div class="relative w-full flex-1 cursor-text" @click="focusEditor">
        <div :id="id" class="json-editor-instance w-full"></div>

        <div
          v-if="loading"
          class="absolute inset-0 z-20 flex items-center justify-center bg-white/50 backdrop-blur-sm dark:bg-black/50"
        >
          <svg class="size-5 animate-spin text-blue-500" viewBox="0 0 24 24">
            <circle
              class="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              stroke-width="4"
              fill="none"
            />
            <path
              class="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        </div>
      </div>

      <div
        v-if="hasBase64Images && imageRender"
        class="w-64 flex-shrink-0 border-l border-gray-100 bg-transparent p-3 dark:border-gray-800"
      >
        <div class="space-y-3">
          <div v-for="(item, index) in base64Images" :key="index">
            <div class="mb-1 text-xs text-gray-400">{{ item.key }}</div>
            <ElImage
              :src="item.value"
              class="w-full rounded border border-gray-100 bg-gray-50 dark:border-gray-800 dark:bg-[#1A1A1A]"
              fit="contain"
              :preview-src-list="[item.value]"
              lazy
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss">
.json-viewer-ultimate {
  min-height: 0;

  &,
  &:focus-within,
  *:focus {
    outline: none !important;
    box-shadow: none !important;
  }

  .monaco-editor,
  .monaco-editor-background,
  .monaco-editor .inputarea.ime-input,
  .monaco-editor .margin,
  .monaco-editor .monaco-scrollable-element {
    outline: none !important;
    background-color: transparent !important;
    border: none !important;
    box-shadow: none !important;
  }

  .monaco-editor .margin-view-overlays .line-numbers {
    color: #d9d9d9 !important;
  }

  html.dark & .monaco-editor .margin-view-overlays .line-numbers {
    color: #404040 !important;
  }
}

.json-editor-instance {
  min-height: 100%;
}
</style>
