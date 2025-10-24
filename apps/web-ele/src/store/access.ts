import { acceptHMRUpdate, defineStore } from 'pinia';

export const useTokenStore = defineStore('token', {
  actions: {
    setToken(token: null | string, key: string) {
      this.token[key] = token;
      if (token === null) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete this.token[key];
      }
    },
  },
  persist: true,
  state: (): { token: Record<string, null | string> } => ({
    token: {},
  }),
});

// 解决热更新问题
const hot = import.meta.hot;
if (hot) {
  hot.accept(acceptHMRUpdate(useTokenStore, hot));
}
