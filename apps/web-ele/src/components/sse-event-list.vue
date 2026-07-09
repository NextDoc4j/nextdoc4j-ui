<script lang="ts" setup>
import { computed, nextTick, ref, watch } from 'vue';

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

// 展示模式：pretty 结构化 / raw 原始文本，全局切换
const viewMode = ref<'pretty' | 'raw'>('pretty');

const scrollHostRef = ref<HTMLElement | null>(null);
// 用户上滑查看历史时暂停自动滚动，回到底部后恢复
const autoScroll = ref(true);
// 暂停自动滚动期间已读到的事件数，用于计算未读新事件
const seenCount = ref(0);

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
  autoScroll.value = isNearBottom();
  if (autoScroll.value) {
    seenCount.value = props.events.length;
  }
};

// 新事件到达时，处于自动滚动状态则跟随到底部
watch(
  () => props.events.length,
  async () => {
    if (!autoScroll.value) {
      return;
    }
    await nextTick();
    scrollToBottom();
  },
);

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
      <ol class="sse-timeline">
        <li v-for="item in events" :key="item.seq" class="sse-timeline__item">
          <div class="sse-timeline__rail">
            <span class="sse-timeline__node"></span>
          </div>
          <div class="sse-card">
            <div class="sse-card__header">
              <span class="sse-card__seq">#{{ item.seq }}</span>
              <span
                v-if="item.event && item.event !== 'message'"
                class="sse-card__event"
              >
                {{ item.event }}
              </span>
              <span v-if="item.id" class="sse-card__id">id: {{ item.id }}</span>
              <span class="sse-card__time">{{ item.time }}</span>
            </div>
            <div class="sse-card__body">
              <JsonViewer
                v-if="isPrettyRenderable(item)"
                :value="item.parsed"
                :default-expanded="true"
                class="sse-card__json app-json-schema-viewer"
              />
              <pre v-else class="sse-card__raw">{{ item.data }}</pre>
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

.sse-timeline {
  padding: 0;
  margin: 0;
  list-style: none;
}

.sse-timeline__item {
  display: flex;
  gap: 10px;
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

.sse-timeline__item:first-child .sse-timeline__rail::before {
  top: 14px;
}

.sse-timeline__item:last-child .sse-timeline__rail::before {
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

.sse-card__raw {
  margin: 0;
  overflow-x: auto;
  font-family: var(--el-font-family-mono, monospace);
  font-size: 13px;
  line-height: 1.6;
  word-break: break-all;
  white-space: pre-wrap;
}

.sse-card__json {
  padding: 0 !important;
}

.sse-stream__jump {
  position: sticky;
  bottom: 8px;
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
