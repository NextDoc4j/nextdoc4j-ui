import type { Directive, DirectiveBinding } from 'vue';

import { ElMessage } from 'element-plus';

interface ElType extends HTMLElement {
  copyData: string;
  __handleClick__: any;
}

const copy: Directive = {
  mounted(el: ElType, binding: DirectiveBinding) {
    el.copyData = binding.value ?? el.innerText;
    el.addEventListener('click', handleClick);
  },
  updated(el: ElType, binding: DirectiveBinding) {
    el.copyData = binding.value;
  },
  beforeUnmount(el: ElType) {
    el.removeEventListener('click', el.__handleClick__);
  },
};

async function handleClick(this: ElType, e: Event) {
  e.stopPropagation();
  try {
    // 优先使用现代API
    await navigator.clipboard.writeText(this.copyData);
    ElMessage.success('复制成功');
  } catch {
    // 降级方案
    const textarea = document.createElement('textarea');
    textarea.value = this.copyData;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    document.execCommand('Copy');
    textarea.remove();
    ElMessage.success('复制成功');
  }
}

export default copy;
