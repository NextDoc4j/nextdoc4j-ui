<script lang="ts" setup>
import type { ComponentPublicInstance } from 'vue';

import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';

import { ElEmpty } from 'element-plus';

import JsonViewer from '#/components/json-viewer/index.vue';

// 单条 SSE 事件结构，与 api-test.vue 中的 SseEvent 保持一致
interface SseEvent {
  data: string;
  event: string;
  id?: string;
  parsed?: unknown;
  seq: number;
  time: string;
}

const props = defineProps<{
  events: SseEvent[];
  streaming: boolean;
}>();

// 单条卡片在测量到真实高度前的预估高度（px），用于撑起总高度占位
const ESTIMATED_ITEM_HEIGHT = 96;
// 可视区上下额外预渲染的缓冲高度（px），滚动时提前挂载，避免露白
const VIRTUAL_OVERSCAN = 600;

// 展示模式：pretty 结构化 / raw 原始文本，全局切换
const viewMode = ref<'pretty' | 'raw'>('pretty');

const scrollHostRef = ref<HTMLElement | null>(null);
// 用户上滑查看历史时暂停自动滚动，回到底部后恢复
const autoScroll = ref(true);
// 暂停自动滚动期间已读到的事件数，用于计算未读新事件
const seenCount = ref(0);

// 滚动容器状态：滚动位置与视口高度，驱动可视窗口计算
const scrollTop = ref(0);
const viewportHeight = ref(0);

// 每条事件测量到的真实高度缓存（seq -> 高度），未命中时回退预估高度
const heightCache = new Map<number, number>();
// 高度缓存版本号：测量结果变化时自增，触发布局重算
const measureVersion = ref(0);
// 可视卡片的 DOM 元素与其 seq 的双向映射，供 ResizeObserver 反查
const seqElementMap = new Map<number, HTMLElement>();
const elementSeqMap = new WeakMap<HTMLElement, number>();

let scrollRaf: null | number = null;
let itemResizeObserver: null | ResizeObserver = null;
let hostResizeObserver: null | ResizeObserver = null;

/**
 * 记录单条卡片测量到的真实高度，仅在与缓存值不同时自增版本触发重算。
 */
const recordItemHeight = (seq: number, height: number) => {
  if (height <= 0 || heightCache.get(seq) === height) {
    return;
  }
  heightCache.set(seq, height);
  measureVersion.value += 1;
};

/**
 * 挂载可视卡片时观察其尺寸，卸载时解除观察。
 * 通过双向映射在 ResizeObserver 回调中反查对应事件 seq。
 */
type ItemRefValue = ComponentPublicInstance | Element | null;

const setItemRef = (seq: number, el: ItemRefValue) => {
  const element = el instanceof HTMLElement ? el : null;
  const previous = seqElementMap.get(seq);
  if (previous && previous !== element) {
    itemResizeObserver?.unobserve(previous);
    seqElementMap.delete(seq);
  }

  if (element) {
    seqElementMap.set(seq, element);
    elementSeqMap.set(element, seq);
    recordItemHeight(seq, Math.round(element.getBoundingClientRect().height));
    itemResizeObserver?.observe(element);
  }
};

// 按 seq 缓存稳定的 ref 回调，避免内联箭头函数每次渲染都触发解绑/绑定抖动
const itemRefCallbacks = new Map<number, (el: ItemRefValue) => void>();
const getItemRef = (seq: number) => {
  let callback = itemRefCallbacks.get(seq);
  if (!callback) {
    callback = (el: ItemRefValue) => setItemRef(seq, el);
    itemRefCallbacks.set(seq, callback);
  }
  return callback;
};

// 累积偏移布局：tops[i] 为第 i 条卡片的顶部偏移，total 为列表总高度
const layout = computed(() => {
  // 显式依赖测量版本，卡片高度变化时重算
  void measureVersion.value;
  const events = props.events;
  const tops = Array.from({ length: events.length + 1 });
  tops[0] = 0;
  for (const [index, event_] of events.entries()) {
    const height = heightCache.get(event_!.seq) ?? ESTIMATED_ITEM_HEIGHT;
    tops[index + 1] = (tops[index] as number) + height;
  }
  return {
    tops: tops as number[],
    total: (tops[events.length] as number) || 0,
  };
});

/**
 * 二分查找首个底部超过 target 的卡片下标，用于快速定位可视窗口起点。
 */
const findFirstIndexBelow = (tops: number[], target: number) => {
  let low = 0;
  let high = tops.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((tops[mid + 1] ?? 0) <= target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
};

// 当前应渲染的卡片窗口（含 overscan），仅这部分进入 DOM
const visibleItems = computed(() => {
  const events = props.events;
  if (events.length === 0) {
    return [];
  }

  const { tops } = layout.value;
  const viewportTop = Math.max(scrollTop.value - VIRTUAL_OVERSCAN, 0);
  const viewportBottom =
    scrollTop.value + viewportHeight.value + VIRTUAL_OVERSCAN;

  const start = findFirstIndexBelow(tops, viewportTop);
  const rendered: Array<{
    index: number;
    isFirst: boolean;
    isLast: boolean;
    item: SseEvent;
    top: number;
  }> = [];

  for (let index = start; index < events.length; index += 1) {
    if ((tops[index] ?? 0) > viewportBottom) {
      break;
    }
    rendered.push({
      index,
      isFirst: index === 0,
      isLast: index === events.length - 1,
      item: events[index]!,
      top: tops[index] ?? 0,
    });
  }
  return rendered;
});

const totalHeight = computed(() => layout.value.total);

// 暂停跟随时积压的新事件数量（回底浮标用）
const pendingCount = computed(() =>
  autoScroll.value ? 0 : Math.max(0, props.events.length - seenCount.value),
);

// 判断滚动容器是否已接近底部（阈值 40px）
const isNearBottom = () => {
  const host = scrollHostRef.value;
  if (!host) {
    return true;
  }
  return host.scrollHeight - host.scrollTop - host.clientHeight <= 40;
};

const scrollToBottom = () => {
  const host = scrollHostRef.value;
  if (host) {
    host.scrollTop = host.scrollHeight;
    scrollTop.value = host.scrollTop;
  }
  seenCount.value = props.events.length;
};

// 点击浮标：回到底部并恢复自动跟随
const resumeAutoScroll = async () => {
  autoScroll.value = true;
  await nextTick();
  scrollToBottom();
};

const handleScroll = () => {
  if (scrollRaf !== null) {
    return;
  }
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = null;
    const host = scrollHostRef.value;
    if (!host) {
      return;
    }
    scrollTop.value = host.scrollTop;
    autoScroll.value = isNearBottom();
    if (autoScroll.value) {
      seenCount.value = props.events.length;
    }
  });
};

const updateViewportHeight = () => {
  viewportHeight.value = scrollHostRef.value?.clientHeight || 0;
};

/**
 * 绑定滚动容器与卡片尺寸观察，容器高度或卡片高度变化时刷新虚拟窗口布局。
 */
const bindObservers = () => {
  if (typeof ResizeObserver === 'undefined') {
    return;
  }
  itemResizeObserver = new ResizeObserver((entries) => {
    entries.forEach((entry) => {
      const seq = elementSeqMap.get(entry.target as HTMLElement);
      if (seq !== undefined) {
        recordItemHeight(
          seq,
          Math.round(
            (entry.target as HTMLElement).getBoundingClientRect().height,
          ),
        );
      }
    });
  });
  const host = scrollHostRef.value;
  if (host) {
    hostResizeObserver = new ResizeObserver(updateViewportHeight);
    hostResizeObserver.observe(host);
  }
};

// 新事件到达时，处于自动滚动状态则跟随到底部
watch(
  () => props.events.length,
  async () => {
    if (props.events.length === 0) {
      heightCache.clear();
      seqElementMap.clear();
      scrollTop.value = 0;
      seenCount.value = 0;
      autoScroll.value = true;
    }
    if (!autoScroll.value) {
      return;
    }
    await nextTick();
    updateViewportHeight();
    scrollToBottom();
  },
);

// 卡片高度重算后若仍处于跟随态，保持吸附底部，避免测量抖动导致露白
watch(measureVersion, async () => {
  if (!autoScroll.value) {
    return;
  }
  await nextTick();
  scrollToBottom();
});

// 切换展示模式后卡片高度整体变化，清空缓存重新测量
watch(viewMode, async () => {
  heightCache.clear();
  measureVersion.value += 1;
  await nextTick();
  updateViewportHeight();
  if (autoScroll.value) {
    scrollToBottom();
  }
});

// 容器挂载后再绑定观察器并初始化视口高度
watch(
  scrollHostRef,
  (host) => {
    if (host) {
      bindObservers();
      updateViewportHeight();
    }
  },
  { flush: 'post' },
);

onBeforeUnmount(() => {
  if (scrollRaf !== null) {
    cancelAnimationFrame(scrollRaf);
    scrollRaf = null;
  }
  itemResizeObserver?.disconnect();
  itemResizeObserver = null;
  hostResizeObserver?.disconnect();
  hostResizeObserver = null;
});

// 单条事件是否以结构化视图展示（pretty 且能解析为可结构化的对象/数组）
const isPrettyRenderable = (item: SseEvent) =>
  viewMode.value === 'pretty' &&
  typeof item.parsed === 'object' &&
  item.parsed !== null;
</script>

<template>
  <div class="sse-stream">
    <div class="sse-stream__toolbar">
      <div class="sse-stream__state">
        <span
          class="sse-stream__dot"
          :class="streaming ? 'sse-stream__dot--live' : 'sse-stream__dot--done'"
        ></span>
        <span class="sse-stream__state-text">
          {{ streaming ? '接收中' : '已结束' }}
        </span>
      </div>
      <div class="sse-stream__view-toggle">
        <button
          type="button"
          class="sse-stream__view-btn"
          :class="{ 'sse-stream__view-btn--active': viewMode === 'pretty' }"
          @click="viewMode = 'pretty'"
        >
          格式化
        </button>
        <button
          type="button"
          class="sse-stream__view-btn"
          :class="{ 'sse-stream__view-btn--active': viewMode === 'raw' }"
          @click="viewMode = 'raw'"
        >
          原始
        </button>
      </div>
    </div>

    <div
      v-if="events.length > 0"
      ref="scrollHostRef"
      class="sse-stream__scroll"
      @scroll="handleScroll"
    >
      <!-- 虚拟列表：外层撑满总高度占位，仅可视窗口内的卡片进入 DOM 并绝对定位 -->
      <ol class="sse-timeline" :style="{ height: `${totalHeight}px` }">
        <li
          v-for="row in visibleItems"
          :key="row.item.seq"
          :ref="getItemRef(row.item.seq)"
          class="sse-timeline__item"
          :class="{
            'sse-timeline__item--first': row.isFirst,
            'sse-timeline__item--last': row.isLast,
          }"
          :style="{ transform: `translateY(${row.top}px)` }"
        >
          <div class="sse-timeline__rail">
            <span class="sse-timeline__node"></span>
          </div>
          <div class="sse-card">
            <div class="sse-card__header">
              <span class="sse-card__seq">#{{ row.item.seq }}</span>
              <span
                v-if="row.item.event && row.item.event !== 'message'"
                class="sse-card__event"
              >
                {{ row.item.event }}
              </span>
              <span v-if="row.item.id" class="sse-card__id">
                id: {{ row.item.id }}
              </span>
              <span class="sse-card__time">{{ row.item.time }}</span>
            </div>
            <div
              class="sse-card__body"
              :class="{ 'sse-card__body--json': isPrettyRenderable(row.item) }"
            >
              <JsonViewer
                v-if="isPrettyRenderable(row.item)"
                :value="row.item.parsed"
                :default-expanded="true"
                class="sse-card__json app-json-schema-viewer"
              />
              <pre v-else class="sse-card__raw">{{ row.item.data }}</pre>
            </div>
          </div>
        </li>
      </ol>

      <button
        v-if="pendingCount > 0"
        type="button"
        class="sse-stream__jump"
        @click="resumeAutoScroll"
      >
        ↓ {{ pendingCount }} 条新事件
      </button>
    </div>

    <ElEmpty v-else :image-size="68">
      <template #description>
        <span class="text-sm">
          {{ streaming ? '正在等待事件推送…' : '暂无事件数据' }}
        </span>
      </template>
    </ElEmpty>
  </div>
</template>

<style scoped>
@keyframes sse-pulse {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.3;
  }
}

.sse-stream {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.sse-stream__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px 8px;
}

.sse-stream__state {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.sse-stream__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.sse-stream__dot--live {
  background: var(--el-color-success);
  animation: sse-pulse 1.2s ease-in-out infinite;
}

.sse-stream__dot--done {
  background: var(--el-text-color-placeholder);
}

.sse-stream__view-toggle {
  display: inline-flex;
  padding: 2px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
}

.sse-stream__view-btn {
  padding: 2px 12px;
  font-size: 12px;
  color: var(--el-text-color-regular);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 4px;
}

.sse-stream__view-btn--active {
  color: var(--el-color-primary);
  background: var(--el-bg-color);
  box-shadow: 0 1px 2px rgb(0 0 0 / 6%);
}

.sse-stream__scroll {
  position: relative;
  flex: 1;
  min-height: 0;
  padding: 4px;
  overflow-y: auto;
}

/* 虚拟列表容器：以总高度撑起滚动条，内部卡片绝对定位 */
.sse-timeline {
  position: relative;
  padding: 0;
  margin: 0;
  list-style: none;
}

.sse-timeline__item {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  gap: 10px;
  width: 100%;
}

.sse-timeline__rail {
  position: relative;
  display: flex;
  justify-content: center;
  width: 12px;
}

/* 竖向连接线：贯穿节点前后，形成时间轴 */
.sse-timeline__rail::before {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  content: '';
  background: var(--el-border-color-light);
}

.sse-timeline__item--first .sse-timeline__rail::before {
  top: 14px;
}

.sse-timeline__item--last .sse-timeline__rail::before {
  bottom: calc(100% - 18px);
}

.sse-timeline__node {
  position: relative;
  z-index: 1;
  width: 7px;
  height: 7px;
  margin-top: 12px;
  background: var(--el-color-primary);
  border-radius: 50%;
}

/* 事件卡片：头部带 primary tint，明暗模式下均可辨识 */
.sse-card {
  flex: 1;
  min-width: 0;
  margin-bottom: 12px;
  overflow: hidden;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
}

.sse-card__header {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  background: color-mix(
    in srgb,
    var(--el-color-primary) 8%,
    var(--el-bg-color)
  );
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.sse-card__seq {
  font-weight: 600;
  color: var(--el-color-primary);
}

.sse-card__event {
  padding: 0 6px;
  color: var(--el-color-primary);
  background: color-mix(
    in srgb,
    var(--el-color-primary) 14%,
    var(--el-bg-color)
  );
  border-radius: 4px;
}

.sse-card__id {
  font-family: var(--el-font-family-mono, monospace);
}

.sse-card__time {
  margin-left: auto;
  color: var(--el-text-color-placeholder);
}

.sse-card__body {
  padding: 8px 10px;
}

/* JSON 两段式：头部之下直接是 JSON，交由 JsonViewer 自身内边距处理 */
.sse-card__body--json {
  padding: 0;
}

.sse-card__raw {
  margin: 0;
  overflow-x: auto;
  font-family: var(--el-font-family-mono, monospace);
  font-size: 13px;
  line-height: 1.6;
  word-break: break-all;
  white-space: pre-wrap;
}

/* 去掉 JsonViewer 自带的边框与圆角，避免与卡片外框形成「框套框」 */
.sse-card__json.json-viewer-scroll-host,
.sse-card__json :deep(.json-viewer-scroll-host) {
  padding: 6px 10px;
}

.sse-card__json {
  border: none !important;
  border-radius: 0 !important;
}

.sse-stream__jump {
  position: sticky;
  bottom: 8px;
  z-index: 2;
  display: block;
  padding: 4px 14px;
  margin: 0 auto;
  font-size: 12px;
  color: var(--el-color-white);
  cursor: pointer;
  background: var(--el-color-primary);
  border: none;
  border-radius: 14px;
  box-shadow: 0 2px 8px rgb(0 0 0 / 15%);
}
</style>
