import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-a11y'],
  framework: '@storybook/react-vite',
  staticDirs: ['../public'],
  async viteFinal(viteConfig) {
    const { mergeConfig } = await import('vite');

    return mergeConfig(viteConfig, {
      css: {
        preprocessorOptions: {
          scss: {
            loadPaths: [path.resolve(__dirname, '../src/styles')],
            importers: [
              {
                findFileUrl(url) {
                  if (!url.startsWith('@/')) return null;

                  return pathToFileURL(path.resolve(__dirname, '../src', url.slice(2)));
                },
              },
            ],
          },
        },
      },
    });
  },
};

export default config;
