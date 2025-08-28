import type { Directive, Plugin } from 'vue';

import copy from './copyText';

// 定义具体指令对象
const directives: Record<string, Directive> = {
  copy,
};

// 定义插件对象
const plugin: Plugin = {
  install(app) {
    Object.keys(directives).forEach((key) => {
      app.directive(key, directives[key] as Directive);
    });
  },
};

export default plugin;
