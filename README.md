# strapi-custom-duplicate

Enhanced Repeatable component for Strapi v5 content-manager.

## Features
- Cross-record component duplication
- Search/filter for repeatable component items
- Smart display labels (titles, subTitles, code, name fallback)

## Installation

```bash
yarn add strapi-custom-duplicate@git+https://github.com/lpcisdabest7/strapi-custom-duplicate.git
```

## Setup

Create or update `src/admin/vite.config.ts` in your Strapi project:

```ts
import { mergeConfig, type UserConfig } from 'vite';

export default (config: UserConfig) => {
  return mergeConfig(config, {
    resolve: {
      alias: {
        '@strapi/content-manager/dist/admin/pages/EditView/components/FormInputs/Component/Repeatable.mjs':
          require.resolve('strapi-custom-duplicate/Repeatable'),
      },
    },
  });
};
```

Then rebuild your admin panel:
```bash
yarn build
```
