<script setup lang="ts">
import type { ApiInfo } from '#/typings/openApi';
import type { CodeExampleLanguage } from '#/utils/api-code-example';

import { computed, ref } from 'vue';

import { SvgApiPrefixIcon, SvgCopyIcon } from '@vben/icons';
import { usePreferences } from '@vben/preferences';

import {
  ElButton,
  ElEmpty,
  ElMessage,
  ElRadioButton,
  ElRadioGroup,
  ElTooltip,
} from 'element-plus';

import MarkdownCodeBlock from '#/components/markdown-code-block.vue';
import { getMethodStyle } from '#/constants/methods';
import { useApiStore } from '#/store';
import {
  buildCodeExampleContext,
  renderCodeExample,
} from '#/utils/api-code-example';
import { copyText } from '#/utils/clipboard';

import PathSegment from './path-segment.vue';

const props = defineProps<{
  info: ApiInfo;
  requestBodyType?: string;
  requestBodyVariantState?: Record<string, number>;
}>();

const { isDark } = usePreferences();
const apiStore = useApiStore();
const activeLanguage = ref<CodeExampleLanguage>('javascript');

const codeContext = computed(() => {
  return buildCodeExampleContext({
    info: props.info,
    requestBodyType: props.requestBodyType,
    requestBodyVariantState: props.requestBodyVariantState || {},
    schemaMap: apiStore.openApi?.components?.schemas || {},
  });
});

const generatedCode = computed(() => {
  return renderCodeExample(codeContext.value, activeLanguage.value);
});

const methodLabel = computed(() => {
  return props.info?.method?.toUpperCase?.() || 'GET';
});

const methodStyle = computed(() => {
  return getMethodStyle(methodLabel.value, isDark.value);
});

const pathLabel = computed(() => props.info?.path || '/');
const baseUrl = computed(() => apiStore.openApi?.servers?.[0]?.url || '');

async function handleCopyBaseUrl() {
  if (!baseUrl.value) return;
  const copied = await copyText(baseUrl.value);
  if (copied) {
    ElMessage.success('Base URL 已复制');
    return;
  }
  ElMessage.error('Base URL 复制失败');
}

async function handleCopyPath() {
  if (!pathLabel.value) return;
  const copied = await copyText(pathLabel.value);
  if (copied) {
    ElMessage.success('Path 已复制');
    return;
  }
  ElMessage.error('Path 复制失败');
}

async function handleCopyCode() {
  const copied = await copyText(generatedCode.value || '');
  if (copied) {
    ElMessage.success('代码已复制');
    return;
  }
  ElMessage.error('代码复制失败');
}
</script>

<template>
  <div class="code-example-page" :class="{ 'code-example-page--dark': isDark }">
    <div v-if="info" class="code-example-page__shell">
      <div class="code-example-page__header">
        <div class="code-example-page__endpoint">
          <span class="endpoint-method" :style="methodStyle">
            {{ methodLabel }}
          </span>

          <ElTooltip v-if="baseUrl" :content="baseUrl" placement="top">
            <button class="endpoint-prefix" @click="handleCopyBaseUrl">
              <SvgApiPrefixIcon class="endpoint-prefix__icon" />
            </button>
          </ElTooltip>

          <div class="endpoint-path-wrap">
            <button class="endpoint-path" @click="handleCopyPath">
              <PathSegment
                :path="pathLabel"
                :param-style="{
                  ...methodStyle,
                  borderColor: methodStyle.color,
                }"
              />
            </button>
          </div>
        </div>

        <div class="code-example-page__toolbar">
          <ElTooltip content="复制代码" placement="top">
            <ElButton
              text
              class="code-example-page__copy-button"
              @click="handleCopyCode"
            >
              <SvgCopyIcon class="size-4" />
            </ElButton>
          </ElTooltip>
          <ElRadioGroup v-model="activeLanguage" size="small">
            <ElRadioButton value="javascript">JavaScript</ElRadioButton>
            <ElRadioButton value="typescript">TypeScript</ElRadioButton>
          </ElRadioGroup>
        </div>
      </div>

      <div class="code-example-page__editor">
        <MarkdownCodeBlock
          class="code-example-page__viewer"
          :code="generatedCode"
          :dark="isDark"
          :language="activeLanguage"
        />
      </div>
    </div>

    <div v-else class="code-example-page__empty">
      <ElEmpty description="未获取到当前接口信息，暂时无法生成代码示例" />
    </div>
  </div>
</template>

<style scoped lang="scss">
.code-example-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 8px 0 0;
}

.code-example-page__shell {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: var(--el-bg-color);
  border: 1px solid color-mix(in srgb, var(--el-border-color) 92%, transparent);
  border-radius: calc(var(--radius) * 1.1);
  box-shadow: 0 10px 24px
    color-mix(in srgb, var(--el-text-color-primary) 4%, transparent);
}

.code-example-page--dark .code-example-page__shell {
  box-shadow: 0 14px 30px color-mix(in srgb, #000 28%, transparent);
}

.code-example-page__header {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  justify-content: space-between;
  padding: 18px 20px 16px;
  border-bottom: 1px solid
    color-mix(in srgb, var(--el-border-color) 86%, transparent);
}

.code-example-page__endpoint {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  min-width: 0;
}

.code-example-page__toolbar {
  display: inline-flex;
  flex: none;
  gap: 6px;
  align-items: center;
}

.code-example-page__copy-button {
  color: var(--el-text-color-secondary);
}

.code-example-page__copy-button:hover {
  color: var(--el-color-primary);
}

.endpoint-method {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 72px;
  height: 32px;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 800;
  border-radius: calc(var(--radius) * 0.62);
}

.endpoint-prefix,
.endpoint-path {
  display: inline-flex;
  align-items: center;
  background: transparent;
  border: none;
}

.endpoint-prefix {
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  border-radius: calc(var(--radius) * 0.62);
  box-shadow: none;
  transition: all 0.16s ease;
}

.endpoint-prefix__icon {
  width: 16px;
  height: 16px;
}

.endpoint-path-wrap {
  display: flex;
  flex: 1;
  min-width: min(100%, 360px);
}

.endpoint-path {
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  cursor: pointer;
  background: color-mix(
    in srgb,
    var(--el-bg-color) 84%,
    var(--el-fill-color-light) 16%
  );
  border-radius: calc(var(--radius) * 0.56);
  transition: all 0.2s ease;
}

.endpoint-prefix:hover,
.endpoint-path:hover {
  background: color-mix(
    in srgb,
    var(--el-bg-color) 72%,
    var(--el-color-primary-light-9) 28%
  );
}

.endpoint-prefix:hover {
  color: var(--el-color-primary);
  background: color-mix(
    in srgb,
    var(--el-color-primary-light-9) 65%,
    transparent
  );
  transform: none;
}

.code-example-page__editor {
  display: flex;
  flex: 1;
  min-height: 0;
  padding: 12px 14px 14px;
  overflow: auto;
}

.code-example-page__viewer {
  flex: 1;
  min-height: 0;
}

.code-example-page__empty {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  min-height: 0;
}

@media (width <= 768px) {
  .code-example-page__header {
    flex-direction: column;
    align-items: stretch;
  }

  .code-example-page__endpoint {
    align-items: stretch;
  }

  .endpoint-path-wrap {
    min-width: 100%;
  }

  .code-example-page__toolbar {
    width: 100%;
  }

  .code-example-page__toolbar :deep(.el-radio-group) {
    display: flex;
    width: 100%;
  }

  .code-example-page__toolbar :deep(.el-radio-button) {
    flex: 1;
  }
}
</style>
