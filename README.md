# strapi-custom-duplicate

All-in-one Strapi v5 enhancement library -- replaces patch-package with a clean npm dependency.

## Features

- **Repeatable component** -- cross-record duplication, search/filter, smart display labels
- **component-preview** -- auto-compute `_preview` labels for style-blocks and banners
- **list-flatten middleware** -- flattens component fields in list views so columns show meaningful data
- **bootstrap helper** -- auto-detects and configures `mainField` for every component

## Installation

```bash
yarn add strapi-custom-duplicate@git+https://github.com/lpcisdabest7/strapi-custom-duplicate.git
```

The **postinstall** script automatically patches `Repeatable.mjs` inside `@strapi/content-manager` -- no patch-package needed.

## Usage

### 1. Vite alias (admin panel)

Create or update `src/admin/vite.config.ts`:

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

### 2. component-preview (lifecycle hooks)

```ts
import { computePreviewLabels } from 'strapi-custom-duplicate/component-preview';

// Inside a lifecycle beforeCreate / beforeUpdate:
await computePreviewLabels(data, strapi, 'api::my-style.my-style');
```

### 3. list-flatten middleware

Register in `config/middlewares.ts`:

```ts
export default [
  // ... other middlewares
  'strapi-custom-duplicate/list-flatten',
];
```

Or use it programmatically:

```ts
import listFlatten from 'strapi-custom-duplicate/list-flatten';

// In register():
strapi.server.use(listFlatten());
```

### 4. bootstrap helper (auto mainField)

```ts
import { configureComponentMainFields } from 'strapi-custom-duplicate/bootstrap';

export default {
  async bootstrap({ strapi }) {
    await configureComponentMainFields(strapi);
  },
};
```

This scans all components and sets `mainField` to the best available string field (`_preview` > `name` > `title` > ... > first string field).

## License

MIT
