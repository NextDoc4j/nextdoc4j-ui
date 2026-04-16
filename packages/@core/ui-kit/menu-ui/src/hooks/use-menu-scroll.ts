import type { Ref } from 'vue';

import { useDebounceFn } from '@vueuse/core';

interface UseMenuScrollOptions {
  delay?: number;
  enable?: boolean | Ref<boolean>;
}

export function useMenuScroll(options: UseMenuScrollOptions = {}) {
  const { enable = true, delay = 120 } = options;

  const scrollToActiveItem = useDebounceFn(() => {
    const isEnabled = typeof enable === 'boolean' ? enable : enable.value;
    if (!isEnabled) return;

    const activeElement = document.querySelector(
      `aside li[role=menuitem].is-active`,
    );
    if (activeElement) {
      activeElement.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'center',
      });
    }
  }, delay);

  return {
    scrollToActiveItem,
  };
}
