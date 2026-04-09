import type { GraniteConfig } from '@apps-in-toss/web-framework';

const config: GraniteConfig = {
  brand: {
    displayName: '로드가드',
    primaryColor: '#FF3B3B',
  },
  navigationBar: {
    withBackButton: true,
    withHomeButton: true,
    initialAccessoryButton: {
      id: 'settings',
      title: 'Settings',
      icon: { name: 'icon-setting-mono' },
    },
  },
};

export default config;
