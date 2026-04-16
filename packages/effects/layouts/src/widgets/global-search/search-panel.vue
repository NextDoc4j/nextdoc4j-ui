<script setup lang="ts">
import type { MenuRecordRaw, TabDefinition } from '@vben/types';

import { computed, nextTick, onMounted, ref, shallowRef, watch } from 'vue';
import { useRouter } from 'vue-router';

import { SearchX, X } from '@vben/icons';
import { $t } from '@vben/locales';
import { useTabbarStore } from '@vben/stores';
import { isString } from '@vben/utils';

import { VbenIcon, VbenScrollbar } from '@vben-core/shadcn-ui';
import { isHttpUrl } from '@vben-core/shared/utils';

import { onKeyStroke, useLocalStorage, useThrottleFn } from '@vueuse/core';

import { methodType } from '../../../../../../apps/web-ele/src/constants/methods';
import { useAggregationStore } from '../../../../../../apps/web-ele/src/store/aggregation';

defineOptions({
  name: 'SearchPanel',
});

const props = withDefaults(
  defineProps<{ keyword?: string; menus?: MenuRecordRaw[] }>(),
  {
    keyword: '',
    menus: () => [],
  },
);
const emit = defineEmits<{ close: [] }>();

const router = useRouter();
const tabbarStore = useTabbarStore();
const aggregationStore = useAggregationStore();
const currentService = computed(() => aggregationStore.currentService);
const isAggregation = computed(() => aggregationStore.isAggregation);
const serviceCache = computed(() => aggregationStore.serviceCache);
const services = computed(() => aggregationStore.services);

type SearchCategory = 'api' | 'entity' | 'markdown' | 'system';
type SearchFilter = 'all' | SearchCategory;
type SearchSource = 'all' | 'group' | 'none';
const HTTP_METHODS = new Set([
  'delete',
  'get',
  'head',
  'options',
  'patch',
  'post',
  'put',
  'trace',
]);

interface SearchItem {
  apiPath?: string;
  breadcrumb: string;
  category: SearchCategory;
  description?: string;
  icon?: MenuRecordRaw['icon'];
  method?: string;
  operationId?: string;
  path: string;
  searchText?: string;
  searchIndex?: SearchItemIndex;
  serviceName?: string;
  serviceUrl?: string;
  source: SearchSource;
  title: string;
}

interface SearchItemIndex {
  compactApiPath: string;
  compactSearchText: string;
  compactTitle: string;
  lowerApiPath: string;
  lowerBreadcrumb: string;
  lowerDescription: string;
  lowerMethod: string;
  lowerOperationId: string;
  lowerPath: string;
  lowerSearchText: string;
  lowerTitle: string;
  normalizedApiPath: string;
  normalizedRequestLine: string;
  normalizedRoutePath: string;
  normalizedSearchText: string;
}

interface SearchHistoryItem {
  apiPath?: string;
  breadcrumb: string;
  category: SearchCategory;
  description?: string;
  icon?: MenuRecordRaw['icon'];
  method?: string;
  operationId?: string;
  path: string;
  searchText?: string;
  serviceName?: string;
  serviceUrl?: string;
  source: SearchSource;
  title: string;
}

interface GroupedSearchItem {
  category: SearchCategory;
  items: Array<SearchItem & { displayIndex: number }>;
}

const searchHistory = useLocalStorage<SearchHistoryItem[]>(
  `__search-history-${location.hostname}__`,
  [],
);
const activeIndex = ref(-1);
const selectedFilter = ref<SearchFilter>('all');
const searchItems = shallowRef<SearchItem[]>([]);
const searchResults = ref<SearchItem[]>([]);
const aggregationIndexAttempts = shallowRef<Record<string, boolean>>({});
let aggregationIndexWarmToken = 0;
const servicesSignature = computed(() => {
  return services.value
    .map(
      (service) => `${service.url}:${service.name}:${service.disabled ? 1 : 0}`,
    )
    .join('|');
});
const serviceCacheSignature = computed(() => {
  return services.value
    .map((service) => {
      const cache = serviceCache.value.get(service.url);
      return [
        service.url,
        cache?.openApi ? 1 : 0,
        cache?.config ? 1 : 0,
        cache?.groupDocs?.size ?? 0,
      ].join(':');
    })
    .join('|');
});

const filterOptions = computed<Array<{ label: string; value: SearchFilter }>>(
  () => [
    { value: 'all', label: $t('ui.widgets.search.filterAll') },
    { value: 'api', label: $t('ui.widgets.search.filterApi') },
    { value: 'entity', label: $t('ui.widgets.search.filterEntity') },
    { value: 'markdown', label: $t('ui.widgets.search.filterMarkdown') },
    { value: 'system', label: $t('ui.widgets.search.filterSystem') },
  ],
);

const handleSearch = useThrottleFn(search, 200);

// 搜索函数，用于根据搜索关键词查找匹配的菜单项
function search(searchKey: string) {
  // 去除搜索关键词的前后空格
  searchKey = searchKey.trim();

  // 如果搜索关键词为空，清空搜索结果并返回
  if (!searchKey) {
    searchResults.value = [];
    return;
  }

  // 使用搜索关键词创建正则表达式
  const reg = createSearchReg(searchKey);
  const currentServiceUrl = currentService.value?.url;

  const lowerKey = searchKey.toLowerCase();
  const compactKey = normalizeLooseText(lowerKey);
  const normalizedPathKey = normalizePathLike(lowerKey);
  const isPathQuery = isPathLikeKeyword(lowerKey);
  const scored = searchItems.value
    .map((item) => {
      const index = item.searchIndex || createSearchItemIndex(item);
      let score = 0;

      if (isPathQuery) {
        if (index.normalizedRequestLine.includes(normalizedPathKey)) {
          score += 240;
        }
        if (index.normalizedApiPath.includes(normalizedPathKey)) {
          score += 200;
        }
        if (index.normalizedRoutePath.includes(normalizedPathKey)) {
          score += 120;
        }
        if (index.normalizedSearchText.includes(normalizedPathKey)) {
          score += 80;
        }

        // 路径检索只保留 API 结果，避免实体/系统项噪声
        if (item.category !== 'api') {
          score = 0;
        }
      } else {
        score += getTextMatchScore(index.lowerTitle, lowerKey, reg, {
          equal: 140,
          fuzzy: 60,
          includes: 90,
          prefix: 120,
        });
        score += getTextMatchScore(index.lowerBreadcrumb, lowerKey, reg, {
          fuzzy: 18,
          includes: 30,
        });
        score += getTextMatchScore(index.lowerPath, lowerKey, reg, {
          fuzzy: 12,
          includes: 20,
        });
        score += getTextMatchScore(index.lowerApiPath, lowerKey, reg, {
          fuzzy: 40,
          includes: 80,
        });
        score += getTextMatchScore(index.lowerDescription, lowerKey, reg, {
          fuzzy: 28,
          includes: 45,
        });
        score += getTextMatchScore(index.lowerSearchText, lowerKey, reg, {
          fuzzy: 38,
          includes: 55,
        });
        score += getTextMatchScore(index.lowerMethod, lowerKey, reg, {
          includes: 25,
        });
        score += getTextMatchScore(index.lowerOperationId, lowerKey, reg, {
          fuzzy: 20,
          includes: 35,
        });
        score += getCompactMatchScore(
          index.compactTitle,
          compactKey,
          lowerKey,
          45,
        );
        score += getCompactMatchScore(
          index.compactApiPath,
          compactKey,
          lowerKey,
          35,
        );
        score += getCompactMatchScore(
          index.compactSearchText,
          compactKey,
          lowerKey,
          28,
        );
      }

      // 聚合模式下优先展示当前服务命中项，减少跨服务同名干扰
      if (
        score > 0 &&
        isAggregation.value &&
        currentServiceUrl &&
        item.serviceUrl === currentServiceUrl
      ) {
        score += 40;
      }
      // 同名接口优先展示分组路由，降低 all 兜底路由排序
      if (item.category === 'api' && item.source === 'all') {
        score -= 5;
      }
      return { item, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      const current = currentServiceUrl || '';
      const aCurrent = a.item.serviceUrl === current ? 1 : 0;
      const bCurrent = b.item.serviceUrl === current ? 1 : 0;
      if (aCurrent !== bCurrent) {
        return bCurrent - aCurrent;
      }

      return a.item.title.localeCompare(b.item.title, 'zh-Hans-CN');
    });

  searchResults.value = deduplicateApiResults(
    scored.map((entry) => entry.item),
  );
}

// When the keyboard up and down keys move to an invisible place
// the scroll bar needs to scroll automatically
function scrollIntoView() {
  const element = document.querySelector(
    `[data-search-item="${activeIndex.value}"]`,
  );

  if (element) {
    element.scrollIntoView({ block: 'nearest' });
  }
}

// enter keyboard event
async function handleEnter(index = activeIndex.value) {
  const result = renderedItems.value;
  if (result.length === 0 || index < 0) {
    return;
  }
  const to = result[index];
  if (to) {
    addSearchHistory(to);
    handleClose();
    await nextTick();
    if (isHttpUrl(to.path)) {
      window.open(to.path, '_blank');
    } else {
      if (
        isAggregation.value &&
        to.serviceUrl &&
        to.serviceUrl !== currentService.value?.url
      ) {
        const targetService = services.value.find(
          (service) => service.url === to.serviceUrl,
        );
        if (targetService) {
          aggregationStore.saveCurrentTabsState(
            tabbarStore.getTabs as TabDefinition[],
            router.currentRoute.value.fullPath,
          );
          aggregationStore.setServiceCurrentTab(targetService.url, to.path);
          aggregationStore.switchService(targetService);
          return;
        }
      }
      router.push({ path: to.path, replace: true });
    }
  }
}

// Arrow key up
function handleUp() {
  if (renderedItems.value.length === 0) {
    return;
  }
  activeIndex.value--;
  if (activeIndex.value < 0) {
    activeIndex.value = renderedItems.value.length - 1;
  }
  scrollIntoView();
}

// Arrow key down
function handleDown() {
  if (renderedItems.value.length === 0) {
    return;
  }
  activeIndex.value++;
  if (activeIndex.value > renderedItems.value.length - 1) {
    activeIndex.value = 0;
  }
  scrollIntoView();
}

// close search modal
function handleClose() {
  searchResults.value = [];
  emit('close');
}

// Activate when the mouse moves to a certain line
function handleMouseenter(index: number) {
  activeIndex.value = index;
}

function removeItem(index: number) {
  const currentItem = renderedItems.value[index];
  if (!currentItem) return;
  const itemKey = getItemKey(currentItem);

  searchHistory.value = searchHistory.value.filter(
    (item) => getItemKey(item) !== itemKey,
  );
  searchResults.value = searchResults.value.filter(
    (item) => getItemKey(item) !== itemKey,
  );

  activeIndex.value = Math.max(activeIndex.value - 1, 0);
  scrollIntoView();
}

function addSearchHistory(item: SearchItem) {
  const historyItem: SearchHistoryItem = {
    apiPath: item.apiPath,
    breadcrumb: item.breadcrumb,
    category: item.category,
    description: item.description,
    icon: item.icon,
    method: item.method,
    operationId: item.operationId,
    path: item.path,
    searchText: item.searchText,
    serviceName: item.serviceName,
    serviceUrl: item.serviceUrl,
    source: item.source,
    title: item.title,
  };

  const nextHistory = searchHistory.value.filter(
    (history) => getItemKey(history) !== getItemKey(historyItem),
  );
  nextHistory.unshift(historyItem);
  searchHistory.value = nextHistory.slice(0, 20);
}

function clearSearchHistory() {
  searchHistory.value = [];
  if (!isSearching.value) {
    searchResults.value = [];
  }
}

// 存储所有需要转义的特殊字符
const code = new Set([
  '$',
  '(',
  ')',
  '*',
  '+',
  '.',
  '?',
  '[',
  '\\',
  ']',
  '^',
  '{',
  '|',
  '}',
]);

// 转换函数，用于转义特殊字符
function transform(c: string) {
  // 如果字符在特殊字符列表中，返回转义后的字符
  // 如果不在，返回字符本身
  return code.has(c) ? `\\${c}` : c;
}

// 创建搜索正则表达式
function createSearchReg(key: string) {
  // 将输入的字符串拆分为单个字符
  // 对每个字符进行转义
  // 然后用'.*'连接所有字符，创建正则表达式
  const keys = [...key].map((item) => transform(item)).join('.*');
  // 返回创建的正则表达式
  return new RegExp(`.*${keys}.*`);
}

function getTextMatchScore(
  value: string,
  lowerKey: string,
  reg: RegExp,
  weights: {
    equal?: number;
    fuzzy?: number;
    includes?: number;
    prefix?: number;
  },
) {
  if (!value) {
    return 0;
  }

  let score = 0;
  if (weights.equal && value === lowerKey) {
    score += weights.equal;
  }
  if (weights.prefix && value.startsWith(lowerKey)) {
    score += weights.prefix;
  }

  const contains = value.includes(lowerKey);
  if (weights.includes && contains) {
    score += weights.includes;
  } else if (weights.fuzzy && reg.test(value)) {
    score += weights.fuzzy;
  }

  return score;
}

function normalizeLooseText(value: string) {
  return value.replaceAll(/[\s/_.:-]+/g, '');
}

function createSearchItemIndex(item: SearchItem): SearchItemIndex {
  const lowerTitle = item.title.toLowerCase();
  const lowerBreadcrumb = item.breadcrumb.toLowerCase();
  const lowerPath = item.path.toLowerCase();
  const lowerApiPath = (item.apiPath || '').toLowerCase();
  const lowerDescription = (item.description || '').toLowerCase();
  const lowerSearchText = (item.searchText || '').toLowerCase();
  const lowerMethod = (item.method || '').toLowerCase();
  const lowerOperationId = (item.operationId || '').toLowerCase();

  return {
    compactApiPath: normalizeLooseText(lowerApiPath),
    compactSearchText: normalizeLooseText(lowerSearchText),
    compactTitle: normalizeLooseText(lowerTitle),
    lowerApiPath,
    lowerBreadcrumb,
    lowerDescription,
    lowerMethod,
    lowerOperationId,
    lowerPath,
    lowerSearchText,
    lowerTitle,
    normalizedApiPath: normalizePathLike(lowerApiPath),
    normalizedRequestLine: normalizePathLike(`${lowerMethod} ${lowerApiPath}`),
    normalizedRoutePath: normalizePathLike(lowerPath),
    normalizedSearchText: normalizePathLike(lowerSearchText),
  };
}

function prepareSearchItem(item: SearchItem): SearchItem {
  return {
    ...item,
    searchIndex: createSearchItemIndex(item),
  };
}

function prepareSearchItems(items: SearchItem[]) {
  return items.map((item) => prepareSearchItem(item));
}

function getCompactMatchScore(
  value: string,
  compactKey: string,
  lowerKey: string,
  score: number,
) {
  if (!value || !compactKey || compactKey === lowerKey) {
    return 0;
  }
  return normalizeLooseText(value).includes(compactKey) ? score : 0;
}

function getPathSegments(path: string) {
  return path.split('/').filter(Boolean);
}

function resolveCategory(path: string): SearchCategory {
  if (path.startsWith('/document')) return 'api';
  if (path.startsWith('/entity')) return 'entity';
  if (path.startsWith('/markdown')) return 'markdown';
  return 'system';
}

function resolveSearchSource(path: string): {
  operationId?: string;
  source: SearchSource;
} {
  const segments = getPathSegments(path);
  if (segments[0] === 'entity' && segments.length >= 3) {
    return {
      source: segments[1] === 'all' ? 'all' : 'group',
    };
  }
  if (segments[0] !== 'document' || segments.length < 4) {
    return { source: 'none' };
  }
  return {
    source: segments[1] === 'all' ? 'all' : 'group',
    operationId: segments[segments.length - 1],
  };
}

function normalizeMenuName(name: string) {
  return isString(name) ? $t(name) : String(name ?? '');
}

function getItemKey(item: { path: string; serviceUrl?: string }) {
  return `${item.serviceUrl || '__single__'}::${item.path}`;
}

function buildSearchIndex(
  menus: MenuRecordRaw[],
  parents: string[] = [],
): SearchItem[] {
  const items: SearchItem[] = [];

  menus.forEach((menu) => {
    const title = normalizeMenuName(menu.name);
    const breadcrumbParts = [...parents, title].filter(Boolean);
    const path = menu.path || '';
    const category = resolveCategory(path);
    const { source, operationId } = resolveSearchSource(path);
    const hasChildren = Boolean(menu.children?.length);

    // 仅索引末级菜单，避免出现“接口文档/所有接口/用户管理”这类上级项
    if (path && !hasChildren) {
      items.push({
        apiPath: menu.apiPath,
        breadcrumb: breadcrumbParts.join(' / '),
        category,
        description: menu.description,
        icon: menu.icon,
        method: menu.method,
        operationId,
        path,
        searchText: menu.searchText,
        source,
        title,
      });
    }

    if (menu.children?.length) {
      items.push(...buildSearchIndex(menu.children, breadcrumbParts));
    }
  });

  return items;
}

function parseGroupCode(url: string) {
  const segments = url.split('/').filter(Boolean);
  return segments[segments.length - 1] || 'all';
}

function buildServiceGroupDocUrl(serviceUrl: string, groupUrl: string) {
  const servicePrefix = serviceUrl.replace('/v3/api-docs', '');
  return `${servicePrefix}${groupUrl}`;
}

function resolveServiceGroupName(
  serviceUrl: string,
  groupCode: string,
): string {
  const cache = serviceCache.value.get(serviceUrl);
  const configUrls = cache?.config?.urls || [];
  return (
    configUrls
      .find((item) => parseGroupCode(item.url) === groupCode)
      ?.name?.trim() || groupCode
  );
}

function buildSearchText(...parts: Array<null | string | undefined>) {
  return parts.filter(Boolean).join(' ');
}

function buildOpenApiSearchIndex(
  service: { name: string; url: string },
  openApi: Record<string, any>,
  source: SearchSource,
  groupCode = 'all',
): SearchItem[] {
  const items: SearchItem[] = [];
  const groupLabel =
    source === 'all'
      ? '所有接口'
      : resolveServiceGroupName(service.url, groupCode);
  const entityLabel = source === 'all' ? '所有实体' : groupLabel;

  Object.entries(openApi.paths ?? {}).forEach(([apiPath, methods]) => {
    Object.entries((methods || {}) as Record<string, any>).forEach(
      ([method, operation]) => {
        const methodName = method.toLowerCase();
        if (!HTTP_METHODS.has(methodName)) return;

        const operationId = operation?.operationId;
        if (!operationId) return;

        const tags =
          Array.isArray(operation?.tags) && operation.tags.length > 0
            ? operation.tags
            : ['default'];
        const title = operation?.summary || operationId || apiPath;
        const description = operation?.description || '';
        const searchText = buildSearchText(
          service.name,
          groupLabel,
          title,
          description,
          operationId,
          apiPath,
          ...tags,
        );

        tags.forEach((tag: string) => {
          items.push({
            apiPath,
            breadcrumb: `${service.name} / 接口文档 / ${groupLabel} / ${tag}`,
            category: 'api',
            description,
            method: methodName,
            operationId,
            path:
              source === 'all'
                ? `/document/all/${tag}/${operationId}`
                : `/document/${groupCode}/${tag}/${operationId}`,
            searchText,
            serviceName: service.name,
            serviceUrl: service.url,
            source,
            title,
          });
        });
      },
    );
  });

  Object.entries(openApi.components?.schemas ?? {}).forEach(
    ([schemaName, schema]) => {
      const schemaDescription = (schema as any)?.description || '';
      items.push({
        breadcrumb: `${service.name} / 实体模型 / ${entityLabel}`,
        category: 'entity',
        description: schemaDescription,
        path:
          source === 'all'
            ? `/entity/all/${schemaName}`
            : `/entity/${groupCode}/${schemaName}`,
        searchText: buildSearchText(
          service.name,
          entityLabel,
          schemaName,
          schemaDescription,
        ),
        serviceName: service.name,
        serviceUrl: service.url,
        source,
        title: schemaName,
      });
    },
  );

  return items;
}

function buildAggregationSearchIndex(): SearchItem[] {
  const items: SearchItem[] = [];

  services.value.forEach((service) => {
    const cache = serviceCache.value.get(service.url);
    const openApi = cache?.openApi;
    if (!openApi) return;

    items.push(...buildOpenApiSearchIndex(service, openApi, 'all'));

    cache?.groupDocs?.forEach((groupOpenApi, groupUrl) => {
      const groupCode = parseGroupCode(groupUrl);
      if (!groupCode || groupCode === 'all') {
        return;
      }
      items.push(
        ...buildOpenApiSearchIndex(service, groupOpenApi, 'group', groupCode),
      );
    });
  });

  return items;
}

function deduplicateApiResults(results: SearchItem[]) {
  const output: SearchItem[] = [];
  const apiSeen = new Map<string, SearchItem>();
  const entitySeen = new Map<string, SearchItem>();
  const seenKey = new Set<string>();

  results.forEach((item) => {
    if (!item.path) return;

    if (item.category === 'api' && item.operationId) {
      const apiKey = [
        item.serviceUrl || '__single__',
        (item.method || '').toLowerCase(),
        item.apiPath || item.path,
        item.operationId || item.path,
      ].join(':');
      const existing = apiSeen.get(apiKey);

      if (!existing) {
        apiSeen.set(apiKey, item);
        output.push(item);
        return;
      }

      if (existing.source === 'all' && item.source === 'group') {
        const index = output.findIndex(
          (entry) => getItemKey(entry) === getItemKey(existing),
        );
        if (index !== -1) {
          output[index] = item;
        }
        apiSeen.set(apiKey, item);
      }
      return;
    }

    if (item.category === 'entity') {
      const entityKey = [
        item.serviceUrl || '__single__',
        item.category,
        item.title.toLowerCase(),
      ].join(':');
      const existing = entitySeen.get(entityKey);

      if (!existing) {
        entitySeen.set(entityKey, item);
        output.push(item);
        return;
      }

      if (existing.source === 'all' && item.source === 'group') {
        const index = output.findIndex(
          (entry) => getItemKey(entry) === getItemKey(existing),
        );
        if (index !== -1) {
          output[index] = item;
        }
        entitySeen.set(entityKey, item);
      }
      return;
    }

    const itemKey = getItemKey(item);
    if (seenKey.has(itemKey)) {
      return;
    }
    seenKey.add(itemKey);
    output.push(item);
  });

  return output;
}

function normalizeHistoryItems(items: SearchHistoryItem[]) {
  return items
    .map((item) => {
      const legacyItem = item as SearchHistoryItem & { name?: string };
      const title = item.title || normalizeMenuName(legacyItem.name || '');
      const sourceInfo = resolveSearchSource(item.path || '');
      return {
        apiPath: item.apiPath,
        breadcrumb: item.breadcrumb || title,
        category: item.category || resolveCategory(item.path || ''),
        description: item.description,
        icon: item.icon,
        method: item.method,
        operationId: item.operationId || sourceInfo.operationId,
        path: item.path,
        searchText: item.searchText,
        serviceName: item.serviceName,
        serviceUrl: item.serviceUrl,
        source: item.source || sourceInfo.source,
        title,
      } as SearchHistoryItem;
    })
    .filter((item) => Boolean(item.path));
}

const searchableItemKeySet = computed(() => {
  return new Set(searchItems.value.map((item) => getItemKey(item)));
});

const sourceItems = computed(() => {
  if (props.keyword?.trim()) {
    return searchResults.value;
  }
  const validPaths = searchableItemKeySet.value;
  return normalizeHistoryItems(searchHistory.value).filter((item) =>
    validPaths.has(getItemKey(item)),
  );
});

const displayItems = computed(() => {
  if (selectedFilter.value === 'all') {
    return sourceItems.value;
  }
  return sourceItems.value.filter(
    (item) => item.category === selectedFilter.value,
  );
});

const filterCount = computed(() => {
  const source = sourceItems.value;
  return {
    all: source.length,
    api: source.filter((item) => item.category === 'api').length,
    entity: source.filter((item) => item.category === 'entity').length,
    markdown: source.filter((item) => item.category === 'markdown').length,
    system: source.filter((item) => item.category === 'system').length,
  };
});

const isSearching = computed(() => Boolean(props.keyword?.trim()));

const groupedDisplayItems = computed<GroupedSearchItem[]>(() => {
  const items = displayItems.value;
  if (items.length === 0) {
    return [];
  }

  const order: SearchCategory[] = ['api', 'entity', 'markdown', 'system'];
  let displayIndex = 0;

  const categories =
    selectedFilter.value === 'all' ? order : [selectedFilter.value];

  return categories
    .map((category) => {
      const categoryItems = items
        .filter((item) => item.category === category)
        .map((item) => ({ ...item, displayIndex: displayIndex++ }));

      return {
        category,
        items: categoryItems,
      };
    })
    .filter((group) => group.items.length > 0);
});

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function highlightText(value: string) {
  const keyword = props.keyword?.trim();
  const raw = value || '';
  if (!keyword) {
    return escapeHtml(raw);
  }

  const escapedKeyword = keyword.replaceAll(
    /[.*+?^${}()|[\]\\]/g,
    String.raw`\$&`,
  );
  const reg = new RegExp(escapedKeyword, 'gi');

  let output = '';
  let lastIndex = 0;
  let hasMatch = false;

  while (true) {
    const match = reg.exec(raw);
    if (!match || match.index === undefined) break;

    hasMatch = true;
    output += escapeHtml(raw.slice(lastIndex, match.index));
    output += `<mark class="search-hit">${escapeHtml(match[0])}</mark>`;
    lastIndex = match.index + match[0].length;

    if (match.index === reg.lastIndex) {
      reg.lastIndex += 1;
    }
  }

  if (!hasMatch) {
    if (isPathLikeKeyword(keyword)) {
      return highlightPathSegments(raw, keyword);
    }
    return escapeHtml(raw);
  }
  output += escapeHtml(raw.slice(lastIndex));
  return output;
}

function highlightPathSegments(raw: string, keyword: string) {
  const segments = [...new Set(keyword.split('/').map((s) => s.trim()))].filter(
    Boolean,
  );
  if (segments.length === 0) {
    return escapeHtml(raw);
  }
  const escapedSegments = segments
    .map((segment) =>
      segment.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`),
    )
    .sort((a, b) => b.length - a.length);
  const reg = new RegExp(escapedSegments.join('|'), 'gi');

  let output = '';
  let lastIndex = 0;
  let hasMatch = false;

  while (true) {
    const match = reg.exec(raw);
    if (!match || match.index === undefined) break;

    hasMatch = true;
    output += escapeHtml(raw.slice(lastIndex, match.index));
    output += `<mark class="search-hit">${escapeHtml(match[0])}</mark>`;
    lastIndex = match.index + match[0].length;

    if (match.index === reg.lastIndex) {
      reg.lastIndex += 1;
    }
  }

  if (!hasMatch) {
    return escapeHtml(raw);
  }
  output += escapeHtml(raw.slice(lastIndex));
  return output;
}

function isPathLikeKeyword(keyword: string) {
  return keyword.includes('/');
}

function normalizePathLike(value: string) {
  return value.replaceAll(/\s+/g, '').replaceAll(/\/+/g, '/');
}

const getCategoryLabel = (category: SearchCategory) => {
  if (category === 'api') return $t('ui.widgets.search.filterApi');
  if (category === 'entity') return $t('ui.widgets.search.filterEntity');
  if (category === 'markdown') return $t('ui.widgets.search.filterMarkdown');
  return $t('ui.widgets.search.filterSystem');
};

const getDisplayTitle = (item: SearchItem) => {
  if (item.category === 'entity' && item.description) {
    return `${item.title} (${item.description})`;
  }
  return item.title;
};

const getApiGroupLabel = (item: SearchItem) => {
  if (item.category !== 'api') return '';
  const segments = getPathSegments(item.path);
  if (segments[0] !== 'document') return '';
  if (segments[1] === 'all') {
    return $t('ui.widgets.search.groupAll');
  }
  return segments[1] || '';
};

const getMethodStyle = (method?: string) => {
  if (!method) return undefined;
  return methodType[method.toUpperCase()] || undefined;
};

function rebuildSearchItems() {
  const currentMenuItems = deduplicateApiResults(
    buildSearchIndex(props.menus ?? []),
  );

  if (!isAggregation.value) {
    searchItems.value = prepareSearchItems(currentMenuItems);
    return;
  }

  const activeService = currentService.value;
  const serviceAwareMenus = currentMenuItems.map((item) => ({
    ...item,
    searchText: buildSearchText(
      activeService?.name,
      item.title,
      item.description,
      item.apiPath,
      item.searchText,
      item.operationId,
    ),
    serviceName: activeService?.name,
    serviceUrl: activeService?.url,
  }));

  const merged = [...buildAggregationSearchIndex(), ...serviceAwareMenus];
  searchItems.value = prepareSearchItems(deduplicateApiResults(merged));
}

async function warmAggregationSearchIndex() {
  if (!isAggregation.value) {
    return;
  }

  const candidateServices = services.value.filter(
    (service) =>
      !service.disabled && !aggregationIndexAttempts.value[service.url],
  );
  if (candidateServices.length <= 0) {
    return;
  }

  aggregationIndexAttempts.value = {
    ...aggregationIndexAttempts.value,
    ...Object.fromEntries(
      candidateServices.map((service) => [service.url, true]),
    ),
  };

  const currentToken = ++aggregationIndexWarmToken;
  await Promise.allSettled(
    candidateServices.map(async (service) => {
      const { config } = await aggregationStore.getServiceData(service);
      const groupUrls = (config.urls || [])
        .map((item) => item.url)
        .filter((url) => parseGroupCode(url) !== 'all');

      await Promise.allSettled(
        groupUrls.map((url) =>
          aggregationStore.getServiceGroupDoc(
            service,
            buildServiceGroupDocUrl(service.url, url),
          ),
        ),
      );
    }),
  );

  if (currentToken !== aggregationIndexWarmToken) {
    return;
  }

  rebuildSearchItems();
  if (props.keyword?.trim()) {
    handleSearch(props.keyword);
  }
}

const renderedItems = computed(() => {
  return groupedDisplayItems.value.flatMap((group) => group.items);
});

watch(
  () => props.keyword,
  (val) => {
    if (val?.trim()) {
      void warmAggregationSearchIndex();
      handleSearch(val);
    } else {
      searchResults.value = [];
    }
  },
);

watch(
  () => [isAggregation.value, servicesSignature.value],
  () => {
    aggregationIndexAttempts.value = {};
    aggregationIndexWarmToken += 1;
  },
  { immediate: true },
);

watch(
  () => [
    props.menus,
    isAggregation.value,
    currentService.value?.url,
    servicesSignature.value,
    serviceCacheSignature.value,
  ],
  () => {
    rebuildSearchItems();
    if (props.keyword?.trim()) {
      void warmAggregationSearchIndex();
      handleSearch(props.keyword);
    }
  },
  { immediate: true },
);

watch(
  renderedItems,
  (items) => {
    if (items.length === 0) {
      activeIndex.value = -1;
      return;
    }

    if (activeIndex.value < 0 || activeIndex.value >= items.length) {
      activeIndex.value = 0;
    }
  },
  { immediate: true },
);

onMounted(() => {
  // enter search
  onKeyStroke('Enter', () => {
    void handleEnter();
  });
  // Monitor keyboard arrow keys
  onKeyStroke('ArrowUp', handleUp);
  onKeyStroke('ArrowDown', handleDown);
  // esc close
  onKeyStroke('Escape', handleClose);
});
</script>

<template>
  <div
    class="flex h-[70vh] max-h-[520px] min-h-[340px] min-w-0 flex-col overflow-hidden px-2"
  >
    <div class="bg-background sticky top-0 z-10 shrink-0 py-1">
      <div v-if="sourceItems.length > 0" class="mb-2 flex flex-wrap gap-2 px-1">
        <button
          v-for="option in filterOptions"
          :key="option.value"
          :class="
            selectedFilter === option.value
              ? 'bg-primary text-primary-foreground'
              : 'bg-accent text-muted-foreground hover:text-foreground'
          "
          class="rounded-full px-2 py-1 text-xs"
          @click="selectedFilter = option.value"
        >
          {{ option.label }} ({{ filterCount[option.value] }})
        </button>
      </div>

      <div v-if="!isSearching && displayItems.length > 0" class="mb-2 px-1">
        <div class="flex items-center justify-between">
          <span class="text-muted-foreground text-xs">
            {{ $t('ui.widgets.search.recent') }}
          </span>
          <button
            class="text-muted-foreground hover:text-foreground text-xs"
            @click="clearSearchHistory"
          >
            {{ $t('ui.widgets.search.clearRecent') }}
          </button>
        </div>
      </div>
    </div>

    <VbenScrollbar class="min-h-0 flex-1">
      <div class="w-full pb-2">
        <!-- 无搜索结果 -->
        <div
          v-if="isSearching && displayItems.length === 0"
          class="text-muted-foreground text-center"
        >
          <SearchX class="mx-auto mt-4 size-12" />
          <p class="mb-10 mt-6 text-xs">
            {{ $t('ui.widgets.search.noResults') }}
            <span class="text-foreground text-sm font-medium">
              "{{ keyword }}"
            </span>
          </p>
        </div>
        <!-- 历史搜索记录 & 没有搜索结果 -->
        <div
          v-if="!isSearching && displayItems.length === 0"
          class="text-muted-foreground text-center"
        >
          <p class="my-10 text-xs">
            {{ $t('ui.widgets.search.noRecent') }}
          </p>
        </div>

        <ul v-show="displayItems.length > 0" class="w-full">
          <template v-for="group in groupedDisplayItems" :key="group.category">
            <li class="text-muted-foreground mb-2 px-1 text-xs">
              {{ getCategoryLabel(group.category) }} ({{ group.items.length }})
            </li>
            <li
              v-for="item in group.items"
              :key="`${getItemKey(item)}-${item.displayIndex}`"
              :class="
                activeIndex === item.displayIndex
                  ? 'active search-item-active'
                  : 'bg-accent'
              "
              :data-index="item.displayIndex"
              :data-search-item="item.displayIndex"
              class="group mb-3 w-full cursor-pointer rounded-lg border border-transparent px-4 py-3"
              @click="handleEnter(item.displayIndex)"
              @mouseenter="handleMouseenter(item.displayIndex)"
            >
              <div class="flex items-start gap-2">
                <VbenIcon
                  v-if="item.icon"
                  :icon="item.icon"
                  class="mt-0.5 size-4 flex-shrink-0"
                  fallback
                />
                <span
                  v-else
                  class="bg-muted-foreground/50 mt-1 inline-block size-2 rounded-full"
                ></span>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span
                      class="truncate text-sm font-medium"
                      v-html="highlightText(getDisplayTitle(item))"
                    ></span>
                    <span
                      v-if="item.serviceName"
                      class="rounded border border-[--el-border-color] px-1 py-0.5 text-[10px]"
                    >
                      {{ item.serviceName }}
                    </span>
                    <span
                      class="rounded border border-[--el-border-color] px-1 py-0.5 text-[10px]"
                    >
                      {{ getCategoryLabel(item.category) }}
                    </span>
                    <span
                      v-if="item.category === 'api' && item.source !== 'none'"
                      class="rounded border border-[--el-border-color] px-1 py-0.5 text-[10px]"
                    >
                      {{
                        item.source === 'all'
                          ? $t('ui.widgets.search.sourceAll')
                          : $t('ui.widgets.search.sourceGroup')
                      }}
                    </span>
                    <span
                      v-if="item.category === 'api' && getApiGroupLabel(item)"
                      class="rounded border border-[--el-border-color] px-1 py-0.5 text-[10px]"
                    >
                      {{ $t('ui.widgets.search.groupLabel') }}:
                      {{ getApiGroupLabel(item) }}
                    </span>
                  </div>
                  <div
                    v-if="item.apiPath"
                    class="mt-1 flex items-center gap-2 overflow-hidden"
                  >
                    <span
                      v-if="item.method"
                      class="inline-flex flex-shrink-0 items-center rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold uppercase"
                      :style="getMethodStyle(item.method)"
                      v-html="highlightText(item.method.toUpperCase())"
                    ></span>
                    <span
                      :class="
                        activeIndex === item.displayIndex
                          ? 'text-foreground'
                          : 'text-foreground/90'
                      "
                      class="truncate font-mono text-[14px] font-semibold tracking-[0.01em]"
                      v-html="highlightText(item.apiPath)"
                    ></span>
                  </div>
                  <p
                    :class="
                      activeIndex === item.displayIndex
                        ? 'text-foreground/80'
                        : 'text-muted-foreground'
                    "
                    class="mt-1 truncate text-[11px]"
                    v-html="highlightText(item.breadcrumb)"
                  ></p>
                </div>

                <div
                  class="flex-center dark:hover:bg-accent hover:text-primary-foreground rounded-full p-1 hover:scale-110"
                  @click.stop="removeItem(item.displayIndex)"
                >
                  <X class="size-4" />
                </div>
              </div>
            </li>
          </template>
        </ul>
      </div>
    </VbenScrollbar>
  </div>
</template>

<style scoped>
.search-hit {
  padding: 0 2px;
  background: color-mix(in oklab, var(--el-color-warning-light-7), #fff 45%);
  border-radius: 2px;
}

.search-item-active {
  background: color-mix(
    in oklab,
    var(--el-color-primary) 18%,
    var(--el-bg-color) 82%
  );
  border-color: color-mix(in oklab, var(--el-color-primary) 45%, transparent);
}
</style>
