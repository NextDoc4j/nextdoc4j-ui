<script lang="ts" setup>
import { ElEmpty } from 'element-plus';

defineOptions({ name: 'EmptyPage' });
defineProps({
  description: {
    type: String,
    default: '暂无数据',
  },
});
</script>

<template>
  <ElEmpty :description="description" />
</template>
