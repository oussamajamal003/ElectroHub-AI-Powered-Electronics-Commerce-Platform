import type { Preview } from '@storybook/react-vite';
import { createElement } from 'react';
import '../src/styles/main.scss';

const preview: Preview = {
  decorators: [Story => createElement('main', { style: { display: 'contents' } }, createElement(Story))],
  parameters: {
    backgrounds: {
      options: [
        { name: 'White', value: '#ffffff' },
        { name: 'Catalog surface', value: '#f8fafc' },
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
