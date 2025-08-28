<script lang="ts" setup>
import { ElCard } from 'element-plus';

import { useApiStore } from '#/store';

defineOptions({ name: 'Home' });

const apiStore = useApiStore();
const { info, openapi } = apiStore.swaggerConfig;
</script>

<template>
  <div class="h-full w-full p-5">
    <ElCard
      class="flex h-full w-full flex-col items-center justify-center"
      shadow="never"
    >
      <p class="mb-20 text-center text-3xl">{{ info?.title }}</p>
      <p class="text-l mb-4"><strong>描述：</strong> {{ info?.description }}</p>
      <div class="mb-8">
        <p class="text-l mb-2">
          <strong>联系人：</strong> {{ info?.contact?.name }}
        </p>
        <p class="text-l mb-2">
          <strong>网址：</strong>
          <a
            target="_blank"
            :href="info?.contact?.url"
            class="text-blue-600 underline"
          >
            {{ info?.contact?.url }}
          </a>
        </p>
        <p class="text-l mb-2">
          <strong>邮箱：</strong> {{ info?.contact?.email }}
        </p>
      </div>
      <p class="text-l mb-4">
        <strong>开源协议：</strong>
        <a
          target="_blank"
          :href="info?.license?.url"
          class="text-blue-600 underline"
          >{{ info?.license?.name }}
        </a>
      </p>
      <p class="text-l mb-4"><strong>版本：</strong>{{ info?.version }}</p>
      <p class="text-l mb-4">
        <strong>OpenAPI 规范：</strong> {{ openapi ?? '' }}
      </p>
    </ElCard>
  </div>
</template>
