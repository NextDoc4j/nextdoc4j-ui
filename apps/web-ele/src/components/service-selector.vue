<script lang="ts" setup>
import type { ServiceItem } from '#/store/aggregation';

import { computed, onMounted, onUnmounted, ref } from 'vue';

import { storeToRefs } from 'pinia';

import { useAggregationStore } from '#/store/aggregation';

const aggregationStore = useAggregationStore();

const { isAggregation, services, currentService } =
  storeToRefs(aggregationStore);

const isOpen = ref(false);
const dropdownRef = ref<HTMLDivElement | null>(null);

const currentLabel = computed(() => currentService.value?.name || '选择服务');

const toggleDropdown = () => {
  isOpen.value = !isOpen.value;
};

const closeDropdown = () => {
  isOpen.value = false;
};

const handleSelect = (service: ServiceItem) => {
  aggregationStore.switchService(service);
  closeDropdown();
  // 切换服务后刷新页面以重新加载路由
  window.location.reload();
};

// 点击外部关闭下拉框
const handleClickOutside = (event: MouseEvent) => {
  if (dropdownRef.value && !dropdownRef.value.contains(event.target as Node)) {
    closeDropdown();
  }
};

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});
</script>

<template>
  <div v-if="isAggregation" ref="dropdownRef" class="docs-selector">
    <button
      type="button"
      class="selector-button"
      :class="{ 'is-open': isOpen }"
      @click="toggleDropdown"
    >
      <span class="selector-label">{{ currentLabel }}</span>
      <svg
        class="selector-arrow"
        :class="{ 'rotate-180': isOpen }"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="2"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M19 9l-7 7-7-7"
        />
      </svg>
    </button>

    <Transition name="dropdown">
      <div v-if="isOpen" class="selector-dropdown">
        <div
          v-for="service in services"
          :key="service.url"
          class="selector-item"
          :class="{ 'is-active': currentService?.url === service.url }"
          @click="handleSelect(service)"
        >
          <span class="item-name">{{ service.name }}</span>
          <svg
            v-if="currentService?.url === service.url"
            class="item-check"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.docs-selector {
  position: relative;
  padding: 8px 12px;
  margin-bottom: 8px;
}

/* 按钮样式 - 简洁现代风格 */
.selector-button {
  display: flex;
  gap: 8px;
  align-items: center;
  width: 100%;
  height: 40px;
  padding: 0 12px;
  font-size: 14px;
  font-weight: 500;
  color: hsl(var(--foreground));
  cursor: pointer;
  outline: none;
  background-color: hsl(var(--muted) / 60%);
  border: 1px solid hsl(var(--border) / 80%);
  border-radius: 8px;
  transition: all 0.2s ease;
}

.selector-button:hover {
  background-color: hsl(var(--accent));
  border-color: hsl(var(--accent) / 60%);
}

.selector-button.is-open {
  background-color: hsl(var(--accent));
  border-color: hsl(var(--accent) / 60%);
}

.selector-button:active {
  transform: scale(0.99);
}

.selector-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
  white-space: nowrap;
}

.selector-arrow {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  opacity: 0.5;
  transition: transform 0.2s ease;
}

.selector-arrow.rotate-180 {
  transform: rotate(180deg);
}

/* 下拉面板样式 */
.selector-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  right: 12px;
  left: 12px;
  z-index: 1000;
  max-height: 280px;
  padding: 4px;
  overflow-y: auto;
  background-color: hsl(var(--background));
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  box-shadow: 0 4px 12px rgb(0 0 0 / 10%);
}

/* 下拉项样式 */
.selector-item {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 10px 12px;
  font-size: 14px;
  color: hsl(var(--foreground));
  white-space: nowrap;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.15s ease;
}

.selector-item:hover {
  background-color: hsl(var(--accent) / 80%);
}

.selector-item.is-active {
  font-weight: 500;
  color: hsl(var(--primary));
  background-color: hsl(var(--primary) / 10%);
}

.item-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-check {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
}

/* 过渡动画 */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.2s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* 滚动条样式 */
.selector-dropdown::-webkit-scrollbar {
  width: 6px;
}

.selector-dropdown::-webkit-scrollbar-track {
  background: transparent;
}

.selector-dropdown::-webkit-scrollbar-thumb {
  background: hsl(var(--border));
  border-radius: 3px;
}

.selector-dropdown::-webkit-scrollbar-thumb:hover {
  background: hsl(var(--muted-foreground) / 50%);
}
</style>
