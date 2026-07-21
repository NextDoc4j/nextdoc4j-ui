import type { MenuRecordRaw } from '@vben/types';

import { computed, onBeforeMount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { preferences, usePreferences } from '@vben/preferences';
import { useAccessStore } from '@vben/stores';
import { findMenuByPath, findRootMenuByPath } from '@vben/utils';

import { useNavigation } from './use-navigation';

function useMixedMenu() {
  const { navigation, preloadRoute, willOpenedByWindow } = useNavigation();
  const accessStore = useAccessStore();
  const route = useRoute();
  const router = useRouter();
  const splitSideMenus = ref<MenuRecordRaw[]>([]);
  const rootMenuPath = ref<string>('');
  const mixedRootMenuPath = ref<string>('');
  const mixExtraMenus = ref<MenuRecordRaw[]>([]);
  /** 记录当前顶级菜单下哪个子菜单最后激活 */
  const defaultSubMap = new Map<string, string>();
  const { isMixedNav, isHeaderMixedNav } = usePreferences();

  const needSplit = computed(
    () =>
      (preferences.navigation.split && isMixedNav.value) ||
      isHeaderMixedNav.value,
  );

  const sidebarVisible = computed(() => {
    const enableSidebar = preferences.sidebar.enable;
    if (needSplit.value) {
      return enableSidebar && splitSideMenus.value.length > 0;
    }
    return enableSidebar;
  });
  const menus = computed(() => accessStore.accessMenus);

  /**
   * 头部菜单
   */
  const headerMenus = computed(() => {
    if (!needSplit.value) {
      return menus.value;
    }
    return menus.value.map((item) => {
      return {
        ...item,
        children: [],
      };
    });
  });

  /**
   * 侧边菜单
   */
  const sidebarMenus = computed(() => {
    return needSplit.value ? splitSideMenus.value : menus.value;
  });

  const mixHeaderMenus = computed(() => {
    return isHeaderMixedNav.value ? sidebarMenus.value : headerMenus.value;
  });

  /**
   * 侧边菜单激活路径
   */
  const sidebarActive = computed(() => {
    return (route?.meta?.activePath as string) ?? route.path;
  });

  /**
   * 头部菜单激活路径
   */
  const headerActive = computed(() => {
    if (!needSplit.value) {
      return route.meta?.activePath ?? route.path;
    }
    return rootMenuPath.value;
  });

  /**
   * 菜单点击事件处理
   * @param key 菜单路径
   * @param mode 菜单模式
   */
  const handleMenuSelect = (key: string, mode?: string) => {
    if (!needSplit.value || mode === 'vertical') {
      navigation(key);
      return;
    }
    const rootMenu = menus.value.find((item) => item.path === key);
    const _splitSideMenus = rootMenu?.children ?? [];

    if (!willOpenedByWindow(key)) {
      rootMenuPath.value = rootMenu?.path ?? '';
      splitSideMenus.value = _splitSideMenus;
    }

    if (_splitSideMenus.length === 0) {
      navigation(key);
    } else if (rootMenu && preferences.sidebar.autoActivateChild) {
      navigation(
        defaultSubMap.has(rootMenu.path)
          ? (defaultSubMap.get(rootMenu.path) as string)
          : rootMenu.path,
      );
    }
  };

  /**
   * 点击接口分组菜单时跳转到该分组的概览页。
   * 分组路由通过 meta 提供跳转目标和运行时开关，因此配置变更时无需重建菜单。
   * 未配置目标或开关关闭时，点击只展开/收起分组。
   *
   * 仅当 fromClick=true（用户亲手点击分组标题）时才跳转：点击接口详情或刷新页面会触发菜单
   * 自动展开祖先分组（fromClick=false），此时不应把用户从正在浏览的接口强制拉回概览页。
   * 由此用户在分组概览页/分组下接口详情页再次点击该分组标题，都能稳定回到该分组概览。
   * @param key 被点击分组的路由路径
   * @param fromClick 是否由用户点击触发（false 为 initMenu/hover 等程序自动展开）
   * @returns 是否已触发概览跳转
   */
  const navigateGroupOverview = (key: string, fromClick: boolean): boolean => {
    // 仅响应用户主动点击，忽略程序自动展开/收起
    if (!fromClick) {
      return false;
    }
    // 折叠态侧边菜单依靠悬浮展开，避免 hover 误触发跳转
    if (preferences.sidebar.collapsed) {
      return false;
    }
    const groupRoute = router.getRoutes().find((item) => item.path === key);
    const overviewPath = groupRoute?.meta.menuGroupTarget;
    const enabledOption = groupRoute?.meta.menuGroupTargetEnabled;
    const enabled =
      typeof enabledOption === 'function' ? enabledOption() : enabledOption;
    if (
      !enabled ||
      typeof overviewPath !== 'string' ||
      !router.getRoutes().some((item) => item.path === overviewPath)
    ) {
      return false;
    }
    // 直接进入隐藏概览路由，避免依赖父分组 redirect 在重复切换时再次解析。
    navigation(overviewPath);
    return true;
  };

  const preloadMenuChildren = (key: string) => {
    const menu = findMenuByPath(menus.value, key);
    const childPaths = (menu?.children ?? []).map((child) => child.path);
    void Promise.allSettled(childPaths.map((path) => preloadRoute(path)));
  };

  /**
   * 侧边菜单展开事件
   * @param key 路由路径
   * @param _parentsPath 父级路径
   * @param fromClick 是否由用户点击触发
   */
  const handleMenuOpen = (
    key: string,
    _parentsPath: string[],
    fromClick = false,
  ) => {
    if (fromClick && key === '/doc-manage') {
      preloadMenuChildren(key);
    }
    // 接口分组：仅在开启分组概览时跳转概览页，否则仅展开。
    // 顶级菜单（接口文档/实体模型/文档管理等）展开时只展开、不自动选中任何子项，
    // 保证「正常菜单展开、只有点击具体项才进入详情」的预期。
    navigateGroupOverview(key, fromClick);
  };

  /**
   * 用户收起接口分组时进入该分组概览；菜单组件会保留用户的收起状态。
   */
  const handleMenuClose = (
    key: string,
    _parentsPath: string[],
    fromClick = false,
  ) => {
    navigateGroupOverview(key, fromClick);
  };

  /**
   * 计算侧边菜单
   * @param path 路由路径
   */
  function calcSideMenus(path: string = route.path) {
    let { rootMenu } = findRootMenuByPath(menus.value, path);
    if (!rootMenu) {
      rootMenu = menus.value.find((item) => item.path === path);
    }
    const result = findRootMenuByPath(rootMenu?.children || [], path, 1);
    mixedRootMenuPath.value = result.rootMenuPath ?? '';
    mixExtraMenus.value = result.rootMenu?.children ?? [];
    rootMenuPath.value = rootMenu?.path ?? '';
    splitSideMenus.value = rootMenu?.children ?? [];
  }

  watch(
    () => route.path,
    (path) => {
      const currentPath = route?.meta?.activePath ?? route?.meta?.link ?? path;
      if (willOpenedByWindow(currentPath)) {
        return;
      }
      calcSideMenus(currentPath);
      if (rootMenuPath.value)
        defaultSubMap.set(rootMenuPath.value, currentPath);
    },
    { immediate: true },
  );

  // 初始化计算侧边菜单
  onBeforeMount(() => {
    calcSideMenus(route.meta?.activePath || route.path);
  });

  return {
    handleMenuSelect,
    handleMenuOpen,
    handleMenuClose,
    headerActive,
    headerMenus,
    sidebarActive,
    sidebarMenus,
    mixHeaderMenus,
    mixExtraMenus,
    sidebarVisible,
  };
}

export { useMixedMenu };
