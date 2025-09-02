import { defineConfig } from '@vben/vite-config';

import AutoImport from 'unplugin-auto-import/vite';
import ElementPlus from 'unplugin-element-plus/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';
import Components from 'unplugin-vue-components/vite';

export default defineConfig(async () => {
  return {
    application: {},
    vite: {
      plugins: [
        ElementPlus({
          format: 'esm',
        }),
        AutoImport({
          imports: ['vue', 'vue-router'],
          resolvers: [ElementPlusResolver({ importStyle: 'sass' })],
          dts: 'types/auto-import.d.ts',
        }),
        Components({
          resolvers: [ElementPlusResolver({ importStyle: 'sass' })],
          dts: 'types/auto-components.d.ts',
        }),
      ],
      server: {
        proxy: {
          '/api': {
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api/, ''),
            // target: 'http://192.168.20.95:50012',
            target: 'https://demo-api.dockit4j.top',
            ws: true,
          },
        },
      },
    },
  };
});
