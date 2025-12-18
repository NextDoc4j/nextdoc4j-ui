<script setup lang="ts">
import { computed } from 'vue';

import { ElDivider, ElTag } from 'element-plus';

interface AuthInfo {
  values: string[];
  mode: string;
  type?: string;
  orValues?: string[];
  orType?: string;
}

interface SecurityMetadata {
  permissions?: AuthInfo[];
  roles?: AuthInfo[];
  ignore?: boolean;
}

defineOptions({ name: 'SecurityView' });

const props = defineProps<{ metadata: SecurityMetadata }>();

const isIgnored = computed(() => props.metadata?.ignore || false);
const hasRequirements = computed(() => {
  if (isIgnored.value) return false;
  return (
    (props.metadata?.permissions?.length ?? 0) > 0 ||
    (props.metadata?.roles?.length ?? 0) > 0
  );
});

const formatMode = (mode: string) => {
  const modeMap: Record<string, string> = {
    AND: '&',
    OR: '|',
    and: '&',
    or: '|',
  };
  return modeMap[mode] || mode;
};
</script>

<template>
  <div class="security-view">
    <!-- 无权限要求 -->
    <div v-if="!hasRequirements" class="empty-state">
      <ElTag type="success" effect="light" size="default">
        {{ isIgnored ? '跳过权限校验' : '无权限要求' }}
      </ElTag>
    </div>

    <!-- 有权限要求 -->
    <div v-else class="security-content">
      <!-- 角色 -->
      <div v-if="metadata.roles?.length" class="security-item">
        <span class="label">角色校验：</span>
        <div class="value-content">
          <template v-for="(roleGroup, i) in metadata.roles" :key="i">
            <template v-for="(value, j) in roleGroup.values" :key="`${i}-${j}`">
              <ElTag type="primary" effect="light">{{ value }}</ElTag>
              <span
                v-if="j < roleGroup.values.length - 1"
                class="connector-badge"
              >
                {{ formatMode(roleGroup.mode) }}
              </span>
            </template>
            <span v-if="i < metadata.roles.length - 1" class="connector-badge">
              |
            </span>
          </template>
        </div>
      </div>

      <ElDivider
        v-if="metadata.roles?.length && metadata.permissions?.length"
      />

      <!-- 权限字符 -->
      <div v-if="metadata.permissions?.length" class="security-item">
        <span class="label">权限校验：</span>
        <div class="value-content">
          <template v-for="(permGroup, i) in metadata.permissions" :key="i">
            <template v-if="permGroup.values.length > 0">
              <template
                v-for="(value, j) in permGroup.values"
                :key="`perm-${i}-${j}`"
              >
                <ElTag type="success" effect="light">{{ value }}</ElTag>
                <span
                  v-if="j < permGroup.values.length - 1"
                  class="connector-badge"
                >
                  {{ formatMode(permGroup.mode) }}
                </span>
              </template>
            </template>
            <span
              v-if="i < metadata.permissions.length - 1"
              class="connector-badge"
            >
              |
            </span>
          </template>
        </div>
      </div>

      <!-- 角色校验 -->
      <div
        v-if="metadata.permissions?.some((p) => p.orValues?.length)"
        class="security-item"
      >
        <span class="label">角色校验：</span>
        <div class="value-content">
          <template v-for="(permGroup, i) in metadata.permissions" :key="i">
            <template v-if="permGroup.orValues?.length">
              <template
                v-for="(orValue, j) in permGroup.orValues"
                :key="`or-${i}-${j}`"
              >
                <ElTag type="primary" effect="light">{{ orValue }}</ElTag>
                <span
                  v-if="j < permGroup.orValues.length - 1"
                  class="connector-badge"
                >
                  |
                </span>
              </template>
            </template>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.security-view {
  width: 100%;
}

.empty-state {
  display: flex;
  justify-content: center;
  padding: 20px 0;
}

.security-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.security-item {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px 0;
}

.label {
  min-width: 70px;
  font-size: 14px;
  font-weight: 500;
  color: var(--el-text-color-regular);
  white-space: nowrap;
}

.value-content {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  gap: 2px;
  align-items: center;
}

.connector-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 20px;
  padding: 0 4px;
  font-size: 12px;
  font-weight: 500;
  color: var(--el-text-color-secondary);
  background-color: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
}

:deep(.el-divider--horizontal) {
  margin: 4px 0;
}
</style>
