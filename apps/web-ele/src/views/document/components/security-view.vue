<script setup lang="ts">
import { computed, ref } from 'vue';

import { ElButton, ElTooltip } from 'element-plus';

interface AuthInfo {
  mode: string;
  orType?: string;
  orValues?: string[];
  type?: string;
  values: string[];
}

interface AuthMethod {
  description?: string;
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

const authMethods = computed(() => {
  return (props.authMethods || []).filter((item) => {
    return `${item.label || ''}`.trim().length > 0;
  });
});

const permissionGroups = computed(() => {
  return (props.metadata?.permissions || []).filter(
    (item) =>
      (Array.isArray(item.values) && item.values.length > 0) ||
      (Array.isArray(item.orValues) && item.orValues.length > 0),
  );
});

const roleGroups = computed(() => {
  return (props.metadata?.roles || []).filter(
    (item) => Array.isArray(item.values) && item.values.length > 0,
  );
});

const hasPermissionPayload = computed(() => {
  return permissionGroups.value.length > 0 || roleGroups.value.length > 0;
});

const showAuthStrip = computed(() => {
  return authMethods.value.length > 0;
});

const showPermissionStrip = computed(() => {
  return isIgnored.value || hasPermissionPayload.value;
});

const showSecurityView = computed(() => {
  return showAuthStrip.value || showPermissionStrip.value;
});

const summaryMode = computed(() => {
  const permissionMode = permissionGroups.value[0]?.mode;
  if (permissionMode) {
    return normalizeMode(permissionMode);
  }
  const roleMode = roleGroups.value[0]?.mode;
  if (roleMode) {
    return normalizeMode(roleMode);
  }
  return 'OR';
});

const hasOrValues = computed(() => {
  return permissionGroups.value.some((group) => {
    return Array.isArray(group.orValues) && group.orValues.length > 0;
  });
});

const normalizeMode = (mode?: string) => {
  const currentMode = `${mode || 'OR'}`.toUpperCase();
  return currentMode === 'AND' ? 'AND' : 'OR';
};

const formatModeConnector = (mode?: string) => {
  return normalizeMode(mode) === 'AND' ? '&' : '/';
};

const formatRuleValues = (values: string[] = [], mode?: string) => {
  if (!Array.isArray(values) || values.length <= 0) {
    return '';
  }
  const connector = ` ${formatModeConnector(mode)} `;
  return values.join(connector);
};

const resolveOrRuleTitle = (orType?: string) => {
  const normalized = `${orType || ''}`.toLowerCase();
  if (normalized === 'role') {
    return '角色校验';
  }
  if (normalized === 'permission') {
    return '权限校验';
  }
  return '规则校验';
};

const formatOrTypeLabel = (orType?: string) => {
  const normalized = `${orType || ''}`.toLowerCase();
  if (normalized === 'role') {
    return '角色';
  }
  if (normalized === 'permission') {
    return '权限';
  }
  return '规则';
};
</script>

<template>
  <div v-if="showSecurityView" class="security-view">
    <section v-if="showAuthStrip" class="security-strip">
      <div class="security-strip__label">认证方式</div>
      <div class="security-strip__content">
        <ElTooltip
          v-for="item in authMethods"
          :key="`${item.label}-${item.detail}-${item.description}`"
          :content="item.description"
          :disabled="!item.description"
          effect="dark"
          placement="top"
        >
          <div class="auth-chip">
            <span class="auth-chip__title">{{ item.label }}</span>
            <span v-if="item.detail" class="auth-chip__detail">
              {{ item.detail }}
            </span>
          </div>
        </ElTooltip>
      </div>
    </section>

    <section v-if="showPermissionStrip" class="security-strip">
      <div class="security-strip__label">权限码</div>
      <div class="security-strip__content security-strip__content--column">
        <div class="permission-summary">
          <div class="permission-summary__chips">
            <span v-if="isIgnored" class="value-chip value-chip--ignore">
              跳过校验
            </span>
            <template v-else>
              <span class="mode-chip">模式 {{ summaryMode }}</span>
              <span v-if="hasOrValues" class="or-prefix-chip">含备选</span>
            </template>
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

        <template v-if="expanded && !isIgnored">
          <template
            v-for="(group, index) in permissionGroups"
            :key="`permission-${index}`"
          >
            <div
              v-if="group.values && group.values.length > 0"
              class="rule-row"
            >
              <div class="rule-row__title">权限校验</div>
              <div class="rule-row__values">
                <span
                  class="rule-expression-chip rule-expression-chip--permission"
                >
                  {{ formatRuleValues(group.values, group.mode) }}
                </span>
              </div>
            </div>

            <div
              v-if="group.orValues && group.orValues.length > 0"
              class="rule-row"
            >
              <div class="rule-row__title">
                {{ resolveOrRuleTitle(group.orType) }}
              </div>
              <div class="rule-row__values">
                <span
                  class="rule-expression-chip rule-expression-chip--or"
                  :title="`备选${formatOrTypeLabel(group.orType)}`"
                >
                  {{ formatRuleValues(group.orValues, group.mode) }}
                </span>
              </div>
            </div>
          </template>

          <div
            v-for="(group, index) in roleGroups"
            :key="`role-${index}`"
            class="rule-row"
          >
            <div class="rule-row__title">角色校验</div>
            <div class="rule-row__values">
              <span class="rule-expression-chip rule-expression-chip--role">
                {{ formatRuleValues(group.values, group.mode) }}
              </span>
            </div>
          </div>
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
.security-view {
  --doc-chip-radius: calc(var(--radius) * 999);
  --doc-radius-sm: calc(var(--radius) * 2);

  display: grid;
  gap: 10px;
}

.security-strip {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
}

.security-strip__label {
  padding-top: 4px;
  font-size: 13px;
  font-weight: 800;
  color: var(--el-text-color-primary);
}

.security-strip__content {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.security-strip__content--column {
  display: grid;
  gap: 6px;
}

.permission-summary {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  min-height: 28px;
}

.permission-summary__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.auth-chip,
.value-chip {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0 9px;
  font-size: 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--doc-chip-radius);
}

.auth-chip {
  flex-wrap: wrap;
  gap: 5px;
  cursor: default;
  background: var(--el-fill-color-light);
}

.auth-chip__title {
  font-weight: 800;
  color: var(--el-text-color-primary);
}

.auth-chip__detail {
  font-weight: 600;
  color: var(--el-text-color-secondary);
}

.rule-row {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  padding: 8px 10px;
  background: color-mix(
    in srgb,
    var(--el-bg-color) 82%,
    var(--el-fill-color-light) 18%
  );
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--doc-radius-sm);
}

.rule-row__title {
  padding-top: 4px;
  font-size: 12px;
  font-weight: 800;
  color: var(--el-text-color-primary);
}

.rule-row__values {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

.mode-chip,
.or-prefix-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 24px;
  padding: 0 8px;
  font-size: 11px;
  font-weight: 700;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--doc-chip-radius);
}

.mode-chip {
  color: var(--el-color-primary-dark-2);
  background: color-mix(
    in srgb,
    var(--el-color-primary-light-9) 78%,
    var(--el-bg-color) 22%
  );
  border-color: var(--el-color-primary-light-6);
}

.or-prefix-chip {
  color: var(--el-color-info-dark-2);
}

.rule-expression-chip {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--doc-chip-radius);
}

.rule-expression-chip--permission {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary-light-7);
}

.rule-expression-chip--role {
  color: var(--el-color-warning-dark-2);
  background: var(--el-color-warning-light-9);
  border-color: var(--el-color-warning-light-7);
}

.rule-expression-chip--or {
  color: var(--el-color-info);
  background: color-mix(
    in srgb,
    var(--el-color-info-light-9) 82%,
    var(--el-bg-color) 18%
  );
  border-color: var(--el-color-info-light-6);
}

.value-chip--ignore {
  font-weight: 800;
  color: var(--el-color-success);
  background: var(--el-color-success-light-9);
  border-color: var(--el-color-success-light-7);
}

@media (max-width: 768px) {
  .security-strip,
  .rule-row {
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
  }

  .security-strip__label,
  .rule-row__title {
    padding-top: 0;
  }

  .permission-summary {
    align-items: flex-start;
  }
}
</style>
