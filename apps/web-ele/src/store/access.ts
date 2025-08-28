import { acceptHMRUpdate, defineStore } from 'pinia';

export const useTokenStore = defineStore('token', {
  actions: {
    setToken(token: null | string) {
      this.token = token;
    },
  },
  persist: {
    // 持久化
    pick: ['token'],
  },
  state: (): { token: null | string } => ({
    token: null,
  }),
});

// 解决热更新问题
const hot = import.meta.hot;
if (hot) {
  hot.accept(acceptHMRUpdate(useTokenStore, hot));
}
