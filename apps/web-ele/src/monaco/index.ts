import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';

// eslint-disable-next-line no-restricted-globals
self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === 'json') {
      return new JsonWorker();
    }
    return new EditorWorker();
  },
};

// 注册自定义的 JSON 语言
monaco.languages.register({ id: 'json-with-comments' });

// 定义语言规则
monaco.languages.setMonarchTokensProvider('json-with-comments', {
  tokenizer: {
    root: [
      // 处理注释
      [/\/\/.*$/, 'comment'],
      // JSON 语法
      [/"([^"\\]|\\.)*"(?=\s*:)/, 'key'],
      [/"([^"\\]|\\.)*"/, 'string'],
      [/true|false/, 'keyword'],
      [/null/, 'keyword'],
      [/-?\d+\.?\d*(e[+-]?\d+)?/i, 'number'],
      [/[{}[\],]/, 'delimiter'],
      [/:/, 'delimiter'],
    ],
  },
});

// 注册主题规则
monaco.editor.defineTheme('json-custom', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'key', foreground: '444444' },
    { token: 'string', foreground: '22863a' },
    { token: 'number', foreground: '005cc5' },
    { token: 'keyword', foreground: 'e36209' },
    { token: 'delimiter', foreground: '24292e' },
    { token: 'comment', foreground: '6a737d', fontStyle: 'italic' },
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#000000',
  },
});

export default monaco;
