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

const securitySchemes = computed(() => {
  return apiStore.openApi?.components?.securitySchemes ?? {};
});

const value = ref(tokenStore.token);
const handleToken = (value: null | string, key: string) => {
  tokenStore.setToken(value, key);
  refresh();
};
</script>

<template>
  <div class="h-full w-full overflow-y-auto p-5">
    <ElCard
      :style="{ border: 'none' }"
      shadow="never"
      v-for="(security, index) in securitySchemes"
      :key="index"
    >
      <ElDescriptions :column="1" border label-width="120px">
        <ElDescriptionsItem label="参数Key" label-align="center">
          {{ index }}
        </ElDescriptionsItem>
        <ElDescriptionsItem label="参数名称" label-align="center">
          {{ security.name ?? '' }}
        </ElDescriptionsItem>
        <ElDescriptionsItem label="in" label-align="center">
          {{ security.in ?? 'header' }}
        </ElDescriptionsItem>
        <ElDescriptionsItem label="参数值" label-align="center">
          <ElInput
            placeholder="请输入"
            v-model.trim="value[security.name]"
            @change="(val) => handleToken(val, security.name)"
          />
        </ElDescriptionsItem>
        <ElDescriptionsItem>
          <ElButton
            type="primary"
            @click.passive="handleToken(null, security.name)"
          >
            注销
          </ElButton>
        </ElDescriptionsItem>
      </ElDescriptions>
    </ElCard>
  </div>
</template>
