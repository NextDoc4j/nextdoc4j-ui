import type { Directive, DirectiveBinding } from 'vue';

import { ElMessage } from 'element-plus';

import { copyText } from '#/utils/clipboard';

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
  const copied = await copyText(this.copyData);
  if (copied) {
    ElMessage.success('复制成功');
    return;
  }
  ElMessage.error('复制失败');
}

export default copy;
