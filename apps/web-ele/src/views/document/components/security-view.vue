<script setup lang="ts">
import { computed, ref } from 'vue';

import { ElButton } from 'element-plus';

interface AuthInfo {
  mode: string;
  orType?: string;
  orValues?: string[];
  type?: string;
  values: string[];
}

interface AuthMethod {
  detail?: string;
  label: string;
}

interface SecurityMetadata {
  permissions?: AuthInfo[];
  roles?: AuthInfo[];
  ignore?: boolean;
}

defineOptions({ name: 'SecurityView' });

const props = withDefaults(
  defineProps<{
    authMethods?: AuthMethod[];
    metadata?: null | SecurityMetadata;
  }>(),
  {
    authMethods: () => [],
    metadata: null,
  },
);

const expanded = ref(false);

const isIgnored = computed(() => props.metadata?.ignore || false);

const permissionGroups = computed(() => {
  return (props.metadata?.permissions || []).filter(
    (item) => Array.isArray(item.values) && item.values.length > 0,
  );
});

const fallbackRoleGroups = computed(() => {
  return (props.metadata?.permissions || []).filter(
    (item) => Array.isArray(item.orValues) && item.orValues.length > 0,
  );
});

const roleGroups = computed(() => {
  return (props.metadata?.roles || []).filter(
    (item) => Array.isArray(item.values) && item.values.length > 0,
  );
});

const hasPermissionPayload = computed(() => {
  return (
    permissionGroups.value.length > 0 ||
    fallbackRoleGroups.value.length > 0 ||
    roleGroups.value.length > 0
  );
});

const permissionCount = computed(() => {
  return permissionGroups.value.reduce((total, item) => {
    return total + item.values.length;
  }, 0);
});

const roleCount = computed(() => {
  return (
    roleGroups.value.reduce((total, item) => total + item.values.length, 0) +
    fallbackRoleGroups.value.reduce(
      (total, item) => total + (item.orValues?.length || 0),
      0,
    )
  );
});

const formatMode = (mode: string) => {
  const modeMap: Record<string, string> = {
    AND: 'AND',
    OR: 'OR',
    and: 'AND',
    or: 'OR',
  };
  return modeMap[mode] || mode;
};
</script>

<template>
  <div class="security-view">
    <section class="security-strip">
      <div class="security-strip__label">认证方式</div>
      <div class="security-strip__content">
        <div
          v-for="item in authMethods"
          :key="`${item.label}-${item.detail}`"
          class="auth-chip"
        >
          <span class="auth-chip__title">{{ item.label }}</span>
          <span v-if="item.detail" class="auth-chip__detail">
            {{ item.detail }}
          </span>
        </div>
      </div>
    </section>

    <section class="security-strip">
      <div class="security-strip__label">权限码</div>
      <div class="security-strip__content security-strip__content--column">
        <div class="permission-summary">
          <div class="permission-summary__chips">
            <span v-if="isIgnored" class="summary-chip">跳过校验</span>
            <template v-else-if="hasPermissionPayload">
              <span v-if="permissionCount > 0" class="summary-chip">
                权限 {{ permissionCount }}
              </span>
              <span v-if="roleCount > 0" class="summary-chip">
                角色 {{ roleCount }}
              </span>
            </template>
            <span v-else class="summary-chip">无</span>
          </div>

          <ElButton
            v-if="!isIgnored && hasPermissionPayload"
            text
            size="small"
            @click="expanded = !expanded"
          >
            {{ expanded ? '收起规则' : '展开规则' }}
          </ElButton>
        </div>

        <div
          v-if="expanded && !isIgnored && hasPermissionPayload"
          class="permission-detail"
        >
          <div
            v-for="(group, index) in permissionGroups"
            :key="`permission-${index}`"
            class="permission-row"
          >
            <div class="permission-row__title">权限</div>
            <div class="permission-row__values">
              <template
                v-for="(value, valueIndex) in group.values"
                :key="value"
              >
                <span class="value-chip value-chip--permission">{{
                  value
                }}</span>
                <span
                  v-if="valueIndex < group.values.length - 1"
                  class="connector-chip"
                >
                  {{ formatMode(group.mode) }}
                </span>
              </template>
            </div>
          </div>

          <div
            v-for="(group, index) in fallbackRoleGroups"
            :key="`fallback-${index}`"
            class="permission-row"
          >
            <div class="permission-row__title">角色兜底</div>
            <div class="permission-row__values">
              <template
                v-for="(value, valueIndex) in group.orValues"
                :key="`fallback-role-${value}`"
              >
                <span class="value-chip value-chip--role">{{ value }}</span>
                <span
                  v-if="valueIndex < (group.orValues?.length || 0) - 1"
                  class="connector-chip"
                >
                  OR
                </span>
              </template>
            </div>
          </div>

          <div
            v-for="(group, index) in roleGroups"
            :key="`role-${index}`"
            class="permission-row"
          >
            <div class="permission-row__title">角色</div>
            <div class="permission-row__values">
              <template
                v-for="(value, valueIndex) in group.values"
                :key="value"
              >
                <span class="value-chip value-chip--role">{{ value }}</span>
                <span
                  v-if="valueIndex < group.values.length - 1"
                  class="connector-chip"
                >
                  {{ formatMode(group.mode) }}
                </span>
              </template>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.security-view {
  --doc-chip-radius: calc(var(--radius) * 999);
  --doc-radius-sm: calc(var(--radius) * 2);

  display: grid;
  gap: 8px;
}

.security-strip {
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
}

.security-strip__label {
  padding-top: 3px;
  font-size: 12px;
  font-weight: 700;
  color: var(--el-text-color-secondary);
}

.security-strip__content {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.security-strip__content--column {
  display: grid;
  gap: 8px;
}

.auth-chip,
.summary-chip,
.value-chip,
.connector-chip {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 8px;
  font-size: 11px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--doc-chip-radius);
}

.auth-chip {
  flex-wrap: wrap;
  gap: 6px;
  background: var(--el-fill-color-light);
}

.auth-chip__title {
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.auth-chip__detail {
  color: var(--el-text-color-secondary);
}

.permission-summary {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
}

.permission-summary__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.summary-chip {
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
}

.permission-detail {
  display: grid;
  gap: 8px;
  padding: 10px;
  background: color-mix(
    in srgb,
    var(--el-bg-color) 76%,
    var(--el-fill-color-light) 24%
  );
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--doc-radius-sm);
}

.permission-row {
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
}

.permission-row__title {
  padding-top: 4px;
  font-size: 11px;
  font-weight: 700;
  color: var(--el-text-color-secondary);
}

.permission-row__values {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  align-items: center;
}

.value-chip--permission {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary-light-7);
}

.value-chip--role {
  color: var(--el-color-warning-dark-2);
  background: var(--el-color-warning-light-9);
  border-color: var(--el-color-warning-light-7);
}

.connector-chip {
  justify-content: center;
  min-width: 34px;
  font-weight: 700;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
}

@media (max-width: 768px) {
  .security-strip,
  .permission-row {
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
  }

  .security-strip__label,
  .permission-row__title {
    padding-top: 0;
  }

  .permission-summary {
    align-items: flex-start;
  }
}
</style>
