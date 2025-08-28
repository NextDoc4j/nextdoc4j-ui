<script lang="ts" setup>
import { computed, ref } from 'vue';

import { useRefresh } from '@vben/hooks';

import {
  ElButton,
  ElCard,
  ElDescriptions,
  ElDescriptionsItem,
  ElInput,
} from 'element-plus';

import { useApiStore, useTokenStore } from '#/store';

defineOptions({ name: 'Authorize' });

const apiStore = useApiStore();
const tokenStore = useTokenStore();
const { refresh } = useRefresh();
const {
  components: { securitySchemes },
} = apiStore.swaggerConfig;
const key = computed(() => {
  return Object.keys(securitySchemes)[0] ?? '';
});
const value = ref(tokenStore.token);
const handleToken = (value: null | string) => {
  tokenStore.setToken(value);
  refresh();
};
</script>

<template>
  <div class="h-full w-full p-5">
    <ElCard class="h-full w-full" :style="{ border: 'none' }" shadow="never">
      <ElDescriptions :column="1" border label-width="120px">
        <ElDescriptionsItem label="参数Key" label-align="center">
          {{ key }}
        </ElDescriptionsItem>
        <ElDescriptionsItem label="参数名称" label-align="center">
          {{ securitySchemes[key].name ?? key }}
        </ElDescriptionsItem>
        <ElDescriptionsItem label="in" label-align="center">
          {{ securitySchemes[key].in ?? 'header' }}
        </ElDescriptionsItem>
        <ElDescriptionsItem label="参数值" label-align="center">
          <ElInput
            placeholder="请输入"
            v-model.trim="value"
            @change="handleToken"
          />
        </ElDescriptionsItem>
        <ElDescriptionsItem>
          <ElButton type="primary" @click.passive="handleToken(null)">
            注销
          </ElButton>
        </ElDescriptionsItem>
      </ElDescriptions>
    </ElCard>
  </div>
</template>
