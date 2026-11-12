import type { Preview } from '@storybook/react-vite';
import { createElement } from 'react';
import '../src/styles/main.scss';

const preview: Preview = {
  // The "Theme" toolbar applies <html data-theme> exactly like the app (Radix portals included), so every story can be
  // reviewed in light and dark. Light stays the default.
  globalTypes: {
    theme: {
      description: 'ElectroHub colour theme',
      toolbar: { title: 'Theme', icon: 'mirror', items: [{ value: 'light', title: 'Light' }, { value: 'dark', title: 'Dark' }], dynamicTitle: true },
    },
  },
  initialGlobals: { theme: 'light' },
  decorators: [
    (Story, context) => {
      document.documentElement.setAttribute('data-theme', context.globals.theme === 'dark' ? 'dark' : 'light');
      return createElement(Story);
    },
    Story => createElement('main', { style: { display: 'contents' } }, createElement(Story)),
  ],
  parameters: {
    backgrounds: {
      options: [
        { name: 'White', value: '#ffffff' },
        { name: 'Catalog surface', value: '#f8fafc' },
        { name: 'Dark canvas', value: '#0b1220' },
      ],
    },
    viewport: {
      options: {
        mobile390: { name: 'Mobile 390', styles: { width: '390px', height: '844px' }, type: 'mobile' },
        tablet768: { name: 'Tablet 768', styles: { width: '768px', height: '1024px' }, type: 'tablet' },
        desktop1440: { name: 'Desktop 1440', styles: { width: '1440px', height: '900px' }, type: 'desktop' },
        largeDesktop1920: { name: 'Large Desktop 1920', styles: { width: '1920px', height: '1080px' }, type: 'desktop' },
      },
    },
    controls: { expanded: true },
  },
};

export default preview;
