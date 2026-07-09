<script lang="ts" setup>
import { nextTick, ref, watch } from 'vue';

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

const scrollHostRef = ref<HTMLElement | null>(null);
// 用户上滑查看历史时暂停自动滚动，回到底部后恢复
const autoScroll = ref(true);

// 判断滚动容器是否已接近底部（阈值 40px）
const isNearBottom = () => {
  const host = scrollHostRef.value;
  if (!host) {
    return true;
  }
  return host.scrollHeight - host.scrollTop - host.clientHeight <= 40;
};

const handleScroll = () => {
  autoScroll.value = isNearBottom();
};

// 新事件到达时，若处于自动滚动状态则滚动到底部
watch(
  () => props.events.length,
  async () => {
    if (!autoScroll.value) {
      return;
    }
    await nextTick();
    const host = scrollHostRef.value;
    if (host) {
      host.scrollTop = host.scrollHeight;
    }
  },
);
</script>

<template>
  <div class="sse-event-list">
    <div
      v-if="events.length > 0"
      ref="scrollHostRef"
      class="sse-event-list__scroll"
      @scroll="handleScroll"
    >
      <div v-for="item in events" :key="item.seq" class="sse-event-card">
        <div class="sse-event-card__meta">
          <span class="sse-event-card__seq">#{{ item.seq }}</span>
          <span class="sse-event-card__event">{{ item.event }}</span>
          <template v-if="item.id">
            <span class="sse-event-card__id">id: {{ item.id }}</span>
          </template>
          <span class="sse-event-card__time">{{ item.time }}</span>
        </div>
        <JsonViewer
          v-if="item.parsed !== undefined"
          :value="item.parsed"
          :default-expanded="true"
          class="sse-event-card__body app-json-schema-viewer"
        />
        <pre v-else class="sse-event-card__raw">{{ item.data }}</pre>
      </div>
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
.sse-event-list {
  height: 100%;
}

.sse-event-list__scroll {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  padding: 4px;
  overflow-y: auto;
}

.sse-event-card {
  padding: 8px 10px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
}

.sse-event-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.sse-event-card__seq {
  font-weight: 600;
  color: var(--el-color-primary);
}

.sse-event-card__event {
  padding: 0 6px;
  color: var(--el-text-color-regular);
  background: var(--el-fill-color-light);
  border-radius: 4px;
}

.sse-event-card__body {
  padding: 0 !important;
}

.sse-event-card__raw {
  margin: 0;
  overflow-x: auto;
  font-family: var(--el-font-family-mono, monospace);
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
