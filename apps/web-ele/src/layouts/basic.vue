<script lang="ts" setup>
import { watch } from 'vue';

import { useWatermark } from '@vben/hooks';
import { BasicLayout, LockScreen } from '@vben/layouts';
import { preferences } from '@vben/preferences';

const { destroyWatermark, updateWatermark } = useWatermark();

watch(
  () => preferences.app.watermark,
  async (enable) => {
    if (enable) {
      await updateWatermark({
        content: preferences.app.watermarkContent,
      });
    } else {
      destroyWatermark();
    }
  },
  {
    immediate: true,
  },
);
</script>

<template>
  <BasicLayout>
    <template #lock-screen>
      <LockScreen />
    </template>
  </BasicLayout>
</template>
