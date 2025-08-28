<script setup lang="ts">
import { onBeforeMount, ref } from 'vue';
import { useRoute } from 'vue-router';

import { useApiStore } from '#/store';
import { processSchema } from '#/utils/schema';

import entityTr from './components/entity-tr.vue';

const route = useRoute();
const entityInfo = ref();
const apiStore = useApiStore();

const treeData = ref();
const fold = ref(false);
onBeforeMount(() => {
  const [, entityName] = (route.name as string).split('*') ?? [];
  if (entityName) {
    entityInfo.value = {
      name: entityName,
      ...apiStore.swaggerConfig.components.schemas[entityName],
    };
  }
  const data = processSchema(entityInfo.value);
  treeData.value = data;
});
</script>
<template>
  <div class="relative box-border h-full w-full overflow-y-auto p-5">
    <h3 class="text-xl">{{ entityInfo.name }}</h3>
    <h4 class="mt-4 text-sm">{{ entityInfo.description }}</h4>
    <table class="entity-table">
      <thead>
        <th width="20%">属性名</th>
        <th width="25%">类型</th>
        <th width="20%">示例</th>
        <th width="35%">描述</th>
      </thead>
      <tbody>
        <entityTr v-if="!fold" :tree-data="treeData" />
      </tbody>
    </table>
  </div>
</template>
<style lang="scss">
.entity-table {
  thead {
    @apply border-b text-start;

    th {
      @apply px-6 py-3 text-sm;
    }
  }
}
</style>
