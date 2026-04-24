<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';

import { useClipboard } from '@vueuse/core';
import { ElMessage } from 'element-plus';

import { $t } from '#/locales';
import { parseExtendedEnum } from '#/utils/enumexpand';

const props = withDefaults(
  defineProps<{
    autoExpandDepth?: number;
    defaultExpanded: boolean;
    depth: number;
    enableChunkedRender?: boolean;
    initialRenderCount?: number;
    isLastItem?: boolean;
    keyName: null | number | string;
    parentSchema?: any;
    renderChunkSize?: number;
    schema?: any;
    value: unknown;
  }>(),
  {
    autoExpandDepth: Number.POSITIVE_INFINITY,
    enableChunkedRender: false,
    initialRenderCount: 120,
    isLastItem: false,
    parentSchema: undefined,
    renderChunkSize: 120,
    schema: undefined,
  },
);

const childNodes = ref<any[]>([]);
const isExpanded = ref(
  props.defaultExpanded && props.depth <= props.autoExpandDepth,
);
const { copy, copied } = useClipboard({ legacy: true });

const valueType = computed(() => {
  if (props.value === null) {
    return 'null';
  }
  if (Array.isArray(props.value)) {
    return 'array';
  }
  return typeof props.value;
});

const isComplex = computed(
  () => valueType.value === 'object' || valueType.value === 'array',
);

const itemCount = computed(() => {
  if (valueType.value === 'array') {
    return (props.value as unknown[]).length;
  }
  if (valueType.value === 'object') {
    return Object.keys(props.value as object).length;
  }
  return 0;
});

const countLabel = computed(() => {
  if (!isExpanded.value || itemCount.value === 0) {
    return '';
  }
  const count = itemCount.value;
  return valueType.value === 'array'
    ? `${count} element${count === 1 ? '' : 's'}`
    : `${count} entr${count === 1 ? 'y' : 'ies'}`;
});

const openBracket = computed(() => (valueType.value === 'array' ? '[' : '{'));
const closeBracket = computed(() => (valueType.value === 'array' ? ']' : '}'));

const currentFieldSchema = computed(() => {
  if (!props.parentSchema || props.keyName === null) {
    return props.schema;
  }

  if (props.parentSchema.type === 'array' && props.parentSchema.items) {
    return props.parentSchema.items;
  }

  if (
    props.parentSchema.properties &&
    props.parentSchema.properties[props.keyName]
  ) {
    return props.parentSchema.properties[props.keyName];
  }

  return null;
});

// 获取字段描述(包含枚举信息)
const fieldDescription = computed(() => {
  const schema = currentFieldSchema.value;
  if (!schema) return null;

  const originalDesc = schema.description || '';
  const enumInfo = parseExtendedEnum(schema);

  if (enumInfo) {
    return originalDesc ? `${originalDesc} (${enumInfo})` : `(${enumInfo})`;
  }

  return originalDesc || null;
});

// 数字每3位添加分隔符，包括小数
function formatNumber(num: number): string {
  const str = String(num);
  const [integer, decimal] = str.split('.');
  const formatted = integer!.replaceAll(
    /\B(?=(\d{3})+(?!\d))/g,
    '<span class="num-delim"></span>',
  );
  return decimal ? `${formatted}.${decimal}` : formatted;
}

// 最外层展示格式化
function formatValueForPreview(val: unknown, isNested = false) {
  if (val === null) {
    return { text: 'null', class: 'value-null' };
  }
  if (val === undefined) {
    return { text: 'undefined', class: 'value-undefined' };
  }
  if (typeof val === 'string') {
    return { text: `"${val}"`, class: 'value-string' };
  }
  if (typeof val === 'boolean') {
    return { text: String(val), class: 'value-boolean' };
  }
  if (typeof val === 'number') {
    return {
      text: formatNumber(val),
      class: 'value-number',
      isHtml: true,
    };
  }

  // 如果是数组结构则判断是否为嵌套，并填充为 {...} 模式
  if (Array.isArray(val)) {
    if (isNested && val.length > 0) {
      const displayCount = Math.min(val.length, 4);
      const items = Array.from({ length: displayCount }).fill('{…}');
      const suffix = val.length > 4 ? `, … ${val.length - 4} more` : '';
      return {
        text: `[${items.join(', ')}${suffix}]`,
        class: 'value-array',
      };
    }
    return { text: '[…]', class: 'value-array' };
  }
  if (typeof val === 'object') {
    return { text: '{…}', class: 'value-object' };
  }
  return { text: String(val), class: '' };
}

const arrayCollapsedPreview = computed(() => {
  if (valueType.value !== 'array' || itemCount.value === 0) {
    return [];
  }

  const count = itemCount.value;
  const displayCount = Math.min(count, 4);
  const items = Array.from({ length: displayCount })
    .fill(null)
    .map(() => ({ text: '{…}', class: 'value-object' }));

  if (count > 4) {
    items.push({
      text: `… ${count - 4} more`,
      class: 'preview-more',
      isMore: true,
    } as any);
  }
  return items;
});

const objectCollapsedPreview = computed(() => {
  if (valueType.value !== 'object') {
    return [];
  }

  const obj = props.value as Record<string, unknown>;
  const keys = Object.keys(obj);

  if (keys.length === 0) {
    return [];
  }

  const items = keys.slice(0, 4).map((key) => ({
    key,
    value: formatValueForPreview(obj[key], true),
    isMore: null,
  }));

  if (keys.length > 4) {
    items.push({
      key: '',
      value: { text: `… ${keys.length - 4} more`, class: 'preview-more' },
      isMore: true,
    } as any);
  }
  return items;
});

// 基本数据格式化
const formattedValue = computed(() => {
  const val = props.value;
  if (val === null) {
    return 'null';
  }
  if (val === undefined) {
    return 'undefined';
  }
  if (typeof val === 'string') {
    return `"${val}"`;
  }
  if (typeof val === 'boolean') {
    return String(val);
  }
  if (typeof val === 'number') {
    return formatNumber(val);
  }
  return String(val);
});

const valueClass = computed(() => `value-${valueType.value}`);
const keyClass = computed(() =>
  typeof props.keyName === 'number' ? 'key-index' : 'key-name',
);

// 获取键列表
const entryKeys = computed(() => {
  if (valueType.value === 'array') {
    return Array.from({ length: itemCount.value }, (_, i) => i);
  }
  if (valueType.value === 'object') {
    return Object.keys(props.value as object);
  }
  return [];
});

const CHUNK_PREFETCH_COUNT = 1;
const CHUNK_ROOT_MARGIN = '900px 0px';
const DEFAULT_CHUNK_PLACEHOLDER_HEIGHT = 640;

const nodeRootRef = ref<HTMLElement | null>(null);
const childrenVisible = ref(false);
const chunkElements = ref<(HTMLElement | null)[]>([]);
const chunkPlaceholderHeights = ref<number[]>([]);
const loadedChunkIndexes = ref<Set<number>>(new Set());
const visibleChunkIndexes = ref<Set<number>>(new Set());

let childrenVisibilityObserver: IntersectionObserver | null = null;
let chunkObserver: IntersectionObserver | null = null;
let chunkMeasureRaf: null | number = null;

const shouldLazyMountChildren = computed(() => {
  return Boolean(
    props.enableChunkedRender && props.depth > 0 && isComplex.value,
  );
});

const chunkRenderEnabled = computed(() => {
  return Boolean(
    props.enableChunkedRender &&
      entryKeys.value.length > props.initialRenderCount,
  );
});

const safeChunkSize = computed(() => {
  return Math.max(props.renderChunkSize, 1);
});

const entryKeyChunks = computed<Array<Array<number | string>>>(() => {
  if (!chunkRenderEnabled.value) {
    return entryKeys.value.length > 0 ? [entryKeys.value] : [];
  }
  const chunks: Array<Array<number | string>> = [];
  for (
    let index = 0;
    index < entryKeys.value.length;
    index += safeChunkSize.value
  ) {
    chunks.push(entryKeys.value.slice(index, index + safeChunkSize.value));
  }
  return chunks;
});

const totalChunkCount = computed(() => {
  return entryKeyChunks.value.length;
});

const isChunkLoaded = (chunkIndex: number) => {
  if (!chunkRenderEnabled.value) {
    return true;
  }
  return loadedChunkIndexes.value.has(chunkIndex);
};

const getChunkPlaceholderStyle = (chunkIndex: number) => {
  const height =
    chunkPlaceholderHeights.value[chunkIndex] ||
    DEFAULT_CHUNK_PLACEHOLDER_HEIGHT;
  return {
    minHeight: `${Math.max(height, 84)}px`,
  };
};

const isLastItemInNode = (chunkIndex: number, itemIndex: number) => {
  const globalIndex = chunkIndex * safeChunkSize.value + itemIndex;
  return globalIndex === entryKeys.value.length - 1;
};

const createAllChunkIndexSet = (chunkCount: number) => {
  const all = new Set<number>();
  for (let index = 0; index < chunkCount; index += 1) {
    all.add(index);
  }
  return all;
};

const isSameNumberSet = (a: Set<number>, b: Set<number>) => {
  if (a.size !== b.size) {
    return false;
  }
  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }
  return true;
};

const initLoadedChunkIndexes = (chunkCount: number) => {
  if (chunkCount <= 0) {
    loadedChunkIndexes.value = new Set();
    return;
  }
  if (!chunkRenderEnabled.value) {
    loadedChunkIndexes.value = createAllChunkIndexSet(chunkCount);
    return;
  }
  const initialItemCount = Math.max(props.initialRenderCount, 1);
  const initialChunkCount = Math.max(
    1,
    Math.ceil(initialItemCount / safeChunkSize.value),
  );
  const loaded = new Set<number>();
  for (
    let index = 0;
    index < Math.min(chunkCount, initialChunkCount);
    index += 1
  ) {
    loaded.add(index);
  }
  loadedChunkIndexes.value = loaded;
};

const updateLoadedChunkIndexesByVisible = () => {
  const chunkCount = totalChunkCount.value;
  if (chunkCount <= 0) {
    loadedChunkIndexes.value = new Set();
    return;
  }
  if (!chunkRenderEnabled.value) {
    loadedChunkIndexes.value = createAllChunkIndexSet(chunkCount);
    return;
  }
  if (visibleChunkIndexes.value.size <= 0) {
    initLoadedChunkIndexes(chunkCount);
    return;
  }

  const nextLoaded = new Set<number>();
  visibleChunkIndexes.value.forEach((chunkIndex) => {
    const startIndex = Math.max(0, chunkIndex - CHUNK_PREFETCH_COUNT);
    const endIndex = Math.min(
      chunkCount - 1,
      chunkIndex + CHUNK_PREFETCH_COUNT,
    );
    for (let index = startIndex; index <= endIndex; index += 1) {
      nextLoaded.add(index);
    }
  });

  if (!isSameNumberSet(nextLoaded, loadedChunkIndexes.value)) {
    loadedChunkIndexes.value = nextLoaded;
  }
};

const syncChunkPlaceholderHeights = () => {
  const nextHeights = [...chunkPlaceholderHeights.value];
  let changed = false;
  loadedChunkIndexes.value.forEach((chunkIndex) => {
    const element = chunkElements.value[chunkIndex];
    if (!element) {
      return;
    }
    const height = Math.ceil(element.getBoundingClientRect().height);
    if (height <= 0) {
      return;
    }
    const currentHeight = nextHeights[chunkIndex] || 0;
    if (Math.abs(currentHeight - height) > 12) {
      nextHeights[chunkIndex] = height;
      changed = true;
    }
  });
  if (changed) {
    chunkPlaceholderHeights.value = nextHeights;
  }
};

const scheduleSyncChunkPlaceholderHeights = () => {
  if (typeof window === 'undefined') {
    syncChunkPlaceholderHeights();
    return;
  }
  if (chunkMeasureRaf) {
    return;
  }
  chunkMeasureRaf = window.requestAnimationFrame(() => {
    chunkMeasureRaf = null;
    syncChunkPlaceholderHeights();
  });
};

const stopChunkObserver = () => {
  chunkObserver?.disconnect();
  chunkObserver = null;
};

const setChunkRef = (element: Element | null, index: number) => {
  chunkElements.value[index] = (element as HTMLElement) || null;
  if (chunkObserver && chunkElements.value[index]) {
    chunkObserver.observe(chunkElements.value[index]!);
  }
};

const forceLoadChunk = (chunkIndex: number) => {
  if (!chunkRenderEnabled.value) {
    return;
  }
  if (chunkIndex < 0 || chunkIndex >= totalChunkCount.value) {
    return;
  }
  if (loadedChunkIndexes.value.has(chunkIndex)) {
    return;
  }
  const nextLoaded = new Set(loadedChunkIndexes.value);
  nextLoaded.add(chunkIndex);
  loadedChunkIndexes.value = nextLoaded;
  scheduleSyncChunkPlaceholderHeights();
};

const stopChildrenVisibilityObserver = () => {
  childrenVisibilityObserver?.disconnect();
  childrenVisibilityObserver = null;
};

const syncChildrenVisibilityObserver = async () => {
  stopChildrenVisibilityObserver();
  if (
    !shouldLazyMountChildren.value ||
    !isExpanded.value ||
    typeof window === 'undefined' ||
    typeof IntersectionObserver === 'undefined'
  ) {
    childrenVisible.value = true;
    return;
  }

  await nextTick();
  if (!nodeRootRef.value) {
    return;
  }

  const scrollRoot = nodeRootRef.value.closest('.json-viewer-scroll-host');
  childrenVisibilityObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((item) => item.isIntersecting)) {
        childrenVisible.value = true;
        stopChildrenVisibilityObserver();
      }
    },
    {
      root: scrollRoot instanceof HTMLElement ? scrollRoot : null,
      rootMargin: '420px 0px 420px 0px',
      threshold: 0,
    },
  );

  childrenVisibilityObserver.observe(nodeRootRef.value);
};

const syncChunkObserver = async () => {
  stopChunkObserver();
  if (
    !childrenVisible.value ||
    !isExpanded.value ||
    totalChunkCount.value <= 0
  ) {
    return;
  }

  if (
    !chunkRenderEnabled.value ||
    typeof window === 'undefined' ||
    typeof IntersectionObserver === 'undefined'
  ) {
    loadedChunkIndexes.value = createAllChunkIndexSet(totalChunkCount.value);
    return;
  }

  await nextTick();
  if (!nodeRootRef.value) {
    return;
  }

  const scrollRoot = nodeRootRef.value.closest('.json-viewer-scroll-host');
  chunkObserver = new IntersectionObserver(
    (entries) => {
      const nextVisible = new Set(visibleChunkIndexes.value);
      let changed = false;
      entries.forEach((entry) => {
        const chunkIndex = Number.parseInt(
          (entry.target as HTMLElement).dataset.nodeChunkIndex || '-1',
          10,
        );
        if (chunkIndex < 0 || chunkIndex >= totalChunkCount.value) {
          return;
        }
        if (entry.isIntersecting) {
          if (!nextVisible.has(chunkIndex)) {
            nextVisible.add(chunkIndex);
            changed = true;
          }
        } else if (nextVisible.delete(chunkIndex)) {
          changed = true;
        }
      });
      if (!changed) {
        return;
      }
      visibleChunkIndexes.value = nextVisible;
      updateLoadedChunkIndexesByVisible();
      void nextTick().then(() => {
        scheduleSyncChunkPlaceholderHeights();
      });
    },
    {
      root: scrollRoot instanceof HTMLElement ? scrollRoot : null,
      rootMargin: CHUNK_ROOT_MARGIN,
      threshold: 0,
    },
  );

  chunkElements.value.forEach((element) => {
    if (element) {
      chunkObserver?.observe(element);
    }
  });
};

watch(
  () => shouldLazyMountChildren.value,
  () => {
    if (!shouldLazyMountChildren.value) {
      childrenVisible.value = true;
      stopChildrenVisibilityObserver();
      return;
    }
    childrenVisible.value = false;
    void syncChildrenVisibilityObserver();
  },
  { immediate: true },
);

watch(
  () => isExpanded.value,
  () => {
    if (!isExpanded.value) {
      stopChildrenVisibilityObserver();
      stopChunkObserver();
      return;
    }
    void syncChildrenVisibilityObserver();
  },
);

watch(
  [
    () => isExpanded.value,
    () => childrenVisible.value,
    () => totalChunkCount.value,
    () => chunkRenderEnabled.value,
  ],
  () => {
    if (!isExpanded.value || !childrenVisible.value) {
      visibleChunkIndexes.value = new Set();
      loadedChunkIndexes.value = new Set();
      stopChunkObserver();
      return;
    }
    initLoadedChunkIndexes(totalChunkCount.value);
    void syncChunkObserver();
    void nextTick().then(() => {
      scheduleSyncChunkPlaceholderHeights();
    });
  },
  { immediate: true },
);

watch(
  () => totalChunkCount.value,
  () => {
    chunkElements.value = Array.from(
      { length: totalChunkCount.value },
      (_, index) => chunkElements.value[index] || null,
    );
    chunkPlaceholderHeights.value = Array.from(
      { length: totalChunkCount.value },
      (_, index) => chunkPlaceholderHeights.value[index] || 0,
    );
    const normalizedVisible = new Set(
      [...visibleChunkIndexes.value].filter(
        (index) => index >= 0 && index < totalChunkCount.value,
      ),
    );
    if (!isSameNumberSet(normalizedVisible, visibleChunkIndexes.value)) {
      visibleChunkIndexes.value = normalizedVisible;
    }
    const normalizedLoaded = new Set(
      [...loadedChunkIndexes.value].filter(
        (index) => index >= 0 && index < totalChunkCount.value,
      ),
    );
    if (!isSameNumberSet(normalizedLoaded, loadedChunkIndexes.value)) {
      loadedChunkIndexes.value = normalizedLoaded;
    }
    void syncChunkObserver();
  },
  { immediate: true },
);

const showCollapseButton = computed(() => {
  return isComplex.value && isExpanded.value && itemCount.value > 0;
});

function toggleExpand() {
  isExpanded.value = !isExpanded.value;
  if (!isExpanded.value) {
    stopChunkObserver();
  }
}

function expandAll() {
  if (isComplex.value) {
    isExpanded.value = true;
    childNodes.value.forEach((child) => child.expandAll?.());
  }
}

function collapseAll() {
  if (isComplex.value) {
    if (props.depth > 0) isExpanded.value = false;
    childNodes.value.forEach((child) => child.collapseAll?.());
  }
}

async function copyToClipboard() {
  const jsonString = JSON.stringify(props.value, null, 2);
  await copy(jsonString);
  if (copied.value) {
    ElMessage({
      duration: 1500,
      type: 'success',
      message: `${$t('common.copySuccess')}`,
    });
  } else {
    ElMessage({
      duration: 1500,
      type: 'error',
      message: `${$t('common.copyFailed')}`,
    });
  }
}

defineExpose({ expandAll, collapseAll });

onBeforeUnmount(() => {
  stopChunkObserver();
  stopChildrenVisibilityObserver();
  if (chunkMeasureRaf && typeof window !== 'undefined') {
    window.cancelAnimationFrame(chunkMeasureRaf);
    chunkMeasureRaf = null;
  }
});
</script>

<template>
  <div
    ref="nodeRootRef"
    class="json-node"
    :class="{ 'has-collapse-btn': showCollapseButton }"
  >
    <template v-if="isComplex">
      <div class="node-header">
        <div
          v-if="keyName !== null && typeof keyName !== 'number'"
          class="key-wrapper"
          :class="keyClass"
        >
          <span>{{ keyName }}</span>
          <span class="preview-colon">: </span>
        </div>

        <span class="bracket" @click="toggleExpand">{{ openBracket }}</span>

        <template v-if="isExpanded && itemCount > 0">
          <button
            class="json-btn-collapse collapse-btn"
            @click="toggleExpand"
          ></button>
          <button
            class="json-btn-copy collapse-btn"
            @click="copyToClipboard"
          ></button>
          <span class="count-label">{{ countLabel }}</span>
        </template>

        <template v-if="!isExpanded">
          <template v-if="valueType === 'array'">
            <span class="preview-container" @click="toggleExpand">
              <template
                v-for="(item, index) in arrayCollapsedPreview"
                :key="index"
              >
                <span :class="item.class">{{ item.text }}</span>
                <span
                  v-if="index < arrayCollapsedPreview.length - 1"
                  class="preview-separator"
                  >,
                </span>
              </template>
            </span>
          </template>

          <template v-else-if="valueType === 'object'">
            <span class="preview-container" @click="toggleExpand">
              <template v-if="objectCollapsedPreview.length === 0">
                <span class="preview-empty">empty</span>
              </template>
              <template v-else>
                <template
                  v-for="(item, index) in objectCollapsedPreview"
                  :key="index"
                >
                  <template v-if="!item.isMore">
                    <span class="key-name">{{ item.key }}</span>
                    <span class="preview-colon">: </span>
                    <span
                      v-if="item.value.isHtml"
                      :class="item.value.class"
                      v-html="item.value.text"
                    ></span>
                    <span v-else :class="item.value.class">{{
                      item.value.text
                    }}</span>
                  </template>
                  <template v-else>
                    <span :class="item.value.class">{{ item.value.text }}</span>
                  </template>
                  <span
                    v-if="index < objectCollapsedPreview.length - 1"
                    class="preview-separator"
                    >,
                  </span>
                </template>
              </template>
            </span>
          </template>

          <span class="bracket" @click="toggleExpand">{{ closeBracket }}</span>
          <span v-if="!isLastItem && depth > 0" class="comma">,</span>
        </template>

        <span
          v-if="fieldDescription && (isExpanded || itemCount === 0)"
          class="field-description"
        >
          <span class="comment-prefix">//</span>
          <span class="comment-content">{{ fieldDescription }}</span>
        </span>
      </div>

      <div v-if="isExpanded" class="node-content">
        <div class="vertical-line"></div>
        <template v-if="childrenVisible">
          <section
            v-for="(chunkKeys, chunkIndex) in entryKeyChunks"
            :key="`chunk-${chunkIndex}`"
            :ref="(el) => setChunkRef(el as Element | null, chunkIndex)"
            :data-node-chunk-index="chunkIndex"
            class="node-virtual-block"
            style="padding-left: 32px"
          >
            <template v-if="isChunkLoaded(chunkIndex)">
              <JsonNode
                v-for="(key, index) in chunkKeys"
                :key="key"
                ref="childNodes"
                :value="
                  valueType === 'array'
                    ? (value as unknown[])[key as number]
                    : (value as Record<string, unknown>)[key]
                "
                :key-name="key"
                :depth="depth + 1"
                :default-expanded="defaultExpanded"
                :auto-expand-depth="autoExpandDepth"
                :enable-chunked-render="enableChunkedRender"
                :initial-render-count="initialRenderCount"
                :render-chunk-size="renderChunkSize"
                :is-last-item="isLastItemInNode(chunkIndex, index)"
                :parent-schema="currentFieldSchema"
              />
            </template>
            <div
              v-else
              class="node-virtual-placeholder"
              :style="getChunkPlaceholderStyle(chunkIndex)"
            >
              <button
                type="button"
                class="node-virtual-placeholder__button"
                @click="forceLoadChunk(chunkIndex)"
              >
                加载该区域
              </button>
            </div>
          </section>
        </template>
        <div v-else class="node-lazy-placeholder" style="padding-left: 32px">
          <button
            type="button"
            class="node-lazy-placeholder__button"
            @click="childrenVisible = true"
          >
            加载子节点
          </button>
        </div>
        <div class="node-footer">
          <span class="bracket">{{ closeBracket }}</span>
          <span v-if="!isLastItem && depth > 0" class="comma">,</span>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="node-primitive">
        <span v-if="keyName !== null" class="key-wrapper" :class="keyClass">
          <span>{{ keyName }}</span>
          <span>:&nbsp;</span>
        </span>
        <span :class="valueClass" v-html="formattedValue"></span>
        <span v-if="!isLastItem" class="comma">,</span>
        <span v-if="fieldDescription" class="field-description">
          <span class="comment-prefix">//</span>
          <span class="comment-content">{{ fieldDescription }}</span>
        </span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.json-node {
  position: relative;
  margin: 2px 0;
}

.json-node:not(.has-collapse-btn) .node-header:hover {
  background-color: rgb(187 187 187 / 25%);
}

.node-header {
  display: flex;
  gap: 4px;
  align-items: center;
  border-radius: 4px;
}

.node-content {
  position: relative;
  padding-left: 0;
}

.node-content > .json-node {
  position: relative;
  z-index: 1;
}

.vertical-line {
  position: absolute;
  top: 0;
  bottom: 24px;
  left: 4px;
  width: 1px;
}

.theme-dark .vertical-line {
  background: linear-gradient(to bottom, #bbbbbb26, #bbbbbb26);
}

.theme-light .vertical-line {
  background: linear-gradient(to bottom, #bbbbbb26, #bbbbbb26);
}

.node-footer,
.node-primitive {
  display: flex;
  align-items: center;
}

.key-wrapper {
  display: flex;
}

:deep(.num-delim) {
  padding-left: 2px;
}

.count-label {
  margin-left: 4px;
  font-size: 11px;
}

.node-virtual-block {
  position: relative;
  min-width: 0;
}

.node-virtual-placeholder {
  display: flex;
  align-items: center;
  min-height: 48px;
}

.node-lazy-placeholder {
  display: flex;
  align-items: center;
  min-height: 26px;
}

.node-virtual-placeholder__button {
  height: 24px;
  padding: 0 10px;
  font-size: 11px;
  line-height: 24px;
  cursor: pointer;
  border-radius: 999px;
}

.node-lazy-placeholder__button {
  height: 22px;
  padding: 0 10px;
  font-size: 11px;
  line-height: 22px;
  cursor: pointer;
  border-radius: 999px;
}

.theme-dark .count-label {
  color: #99999980;
}

.theme-dark .node-virtual-placeholder__button {
  color: #9fb3d1;
  background: rgb(87 114 157 / 16%);
  border: 1px solid rgb(116 147 196 / 36%);
}

.theme-dark .node-lazy-placeholder__button {
  color: #9fb3d1;
  background: rgb(87 114 157 / 10%);
  border: 1px dashed rgb(116 147 196 / 30%);
}

.theme-dark .node-virtual-placeholder__button:hover {
  background: rgb(87 114 157 / 24%);
}

.theme-dark .node-lazy-placeholder__button:hover {
  background: rgb(87 114 157 / 18%);
}

.theme-light .count-label {
  color: #99999980;
}

.theme-light .node-virtual-placeholder__button {
  color: #2d4f87;
  background: #edf3ff;
  border: 1px solid #bfd1f3;
}

.theme-light .node-lazy-placeholder__button {
  color: #2d4f87;
  background: #f4f7ff;
  border: 1px dashed #bfd1f3;
}

.theme-light .node-virtual-placeholder__button:hover {
  background: #e2ecff;
}

.theme-light .node-lazy-placeholder__button:hover {
  background: #edf3ff;
}

.preview-container {
  cursor: pointer;
  user-select: none;
}

.preview-separator,
.preview-colon {
  user-select: none;
}

.theme-dark .preview-separator,
.theme-dark .preview-colon {
  color: #d4d4d4;
}

.theme-light .preview-separator,
.theme-light .preview-colon {
  color: #24292e;
}

.theme-dark .preview-empty,
.theme-dark .preview-more {
  color: #858585;
}

.theme-light .preview-empty,
.theme-light .preview-more {
  color: #6a737d;
}

.comma {
  margin-left: 0;
}

.theme-dark .comma {
  color: #d4d4d4;
}

.theme-light .comma {
  color: #24292e;
}

.collapse-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 4px;
  font-size: 12px;
  cursor: pointer;
  background: none;
  border: none;
  border-radius: 4px;
}

.theme-dark .collapse-btn {
  color: #858585;
  border: 1px solid #4a4a4a;
}

.theme-dark .collapse-btn:hover {
  color: #fff;
  background: rgb(255 255 255 / 10%);
  border-color: #858585;
}

.theme-light .collapse-btn {
  color: #6a737d;
  border: 1px solid #d1d5da;
}

.theme-light .collapse-btn:hover {
  color: #24292e;
  background: rgb(0 0 0 / 5%);
  border-color: #959da5;
}

.collapse-icon {
  display: inline-block;
  user-select: none;
}

.theme-dark .key-name {
  color: #9cdcfe;
}

.theme-dark .key-index {
  font-weight: 400;
  color: #858585;
}

.theme-light .key-name {
  color: #bd6476;
}

.theme-light .key-index {
  color: #6a737d;
}

.bracket {
  user-select: none;
}

.theme-dark .bracket {
  color: #d4d4d4;
}

.theme-light .bracket {
  color: #24292e;
}

.theme-dark .value-string {
  color: #ce9178;
}

.theme-dark .value-number {
  color: #b5cea8;
}

.theme-dark .value-boolean {
  color: #569cd6;
}

.theme-dark .value-null,
.theme-dark .value-undefined {
  color: #569cd6;
}

.theme-dark .value-array,
.theme-dark .value-object {
  color: #858585;
}

.theme-light .value-string {
  color: #690;
}

.theme-light .value-number {
  color: #07a;
}

.theme-light .value-boolean {
  color: #07a;
}

.theme-light .value-null,
.theme-light .value-undefined {
  color: #6f42c1;
}

.theme-light .value-array,
.theme-light .value-object {
  color: #6a737d;
}

.json-btn-collapse::before {
  content: '\2013';
}

.json-btn-copy::before {
  content: '\0192';
}

.field-description {
  display: inline-flex;
  flex: none;
  gap: 8px;
  align-items: center;
  margin-left: 12px;
  font-size: 12px;
  white-space: nowrap;
  user-select: none;
}

.comment-prefix {
  flex-shrink: 0;
}

.comment-content {
  white-space: nowrap;
}

.theme-dark .field-description {
  color: #6a9955;
}

.theme-light .field-description {
  color: #008000;
}
</style>
