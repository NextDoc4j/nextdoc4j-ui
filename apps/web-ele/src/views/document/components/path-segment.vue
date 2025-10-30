<script setup lang="ts">
import type { CSSProperties } from 'vue';

import { computed } from 'vue';

interface Segment {
  isParam: boolean;
  text: string;
}

const props = defineProps<{
  paramStyle?: CSSProperties | string;
  path: string;
}>();

const pathSegments = computed(() => {
  if (!props.path) return [];

  const segments: Array<Segment> = [];
  const parts = props.path.split('/');

  parts.forEach((part, index) => {
    if (index > 0) {
      segments.push({ text: '/', isParam: false });
    }

    if (part) {
      const isParam = /^\{.+\}$/.test(part);
      segments.push({ text: part, isParam });
    }
  });
  return segments;
});
</script>

<template>
  <span class="inline-flex flex-wrap items-center">
    <span
      v-for="(segment, index) in pathSegments"
      :key="index"
      class="cursor-pointer transition-all duration-200"
      :class="[
        {
          'text-sm text-gray-400': segment.text === '/',
          'mx-1.5 rounded-lg border-2 border-solid p-1 font-bold':
            segment.isParam,
          'p-1 font-medium': !segment.isParam && segment.text !== '/',
        },
      ]"
      :style="segment.isParam ? paramStyle : ''"
    >
      {{ segment.text }}
    </span>
  </span>
</template>
