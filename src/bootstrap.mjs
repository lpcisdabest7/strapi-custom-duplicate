/**
 * Auto-detect the best mainField for a component by scanning its attributes.
 * Priority: _preview > name > title > defaultName > code > content > label >
 * displayName > slug > role > action > placement > first string field
 */
const MAIN_FIELD_PRIORITY = [
  '_preview', 'name', 'title', 'defaultName', 'code', 'content',
  'label', 'displayName', 'slug', 'role', 'action', 'placement',
  'useCase', 'useCaseId', 'minVersion', 'minAppVersion',
];

function detectMainField(attributes) {
  // Check priority fields first
  for (const field of MAIN_FIELD_PRIORITY) {
    if (attributes[field] && attributes[field].type === 'string') {
      return field;
    }
  }
  // Fallback: first string field
  for (const [key, attr] of Object.entries(attributes)) {
    if (attr.type === 'string' && !key.startsWith('_')) {
      return key;
    }
  }
  return null;
}

export async function configureComponentMainFields(strapi) {
  const components = strapi.components;
  let configured = 0;

  for (const [uid, schema] of Object.entries(components)) {
    const attributes = schema.attributes;
    if (!attributes) continue;

    const mainField = detectMainField(attributes);
    if (!mainField) continue;

    const storeKey = `configuration_components::${uid}`;
    try {
      const existing = await strapi.store.get({
        type: 'plugin',
        name: 'content_manager',
        key: storeKey,
      });

      if (existing && typeof existing === 'object') {
        const config = existing;
        const currentMainField = config.settings?.mainField;
        if (currentMainField !== mainField) {
          config.settings = { ...config.settings, mainField };

          // Hide _preview from edit layout if it's the chosen mainField
          if (mainField === '_preview' && config.metadatas?._preview) {
            config.metadatas._preview = {
              ...config.metadatas._preview,
              edit: {
                ...config.metadatas._preview?.edit,
                visible: false,
                editable: false,
                description: 'Auto-computed preview label',
                label: 'Preview',
              },
              list: {
                ...config.metadatas._preview?.list,
                label: 'Preview',
              },
            };
          }

          await strapi.store.set({
            type: 'plugin',
            name: 'content_manager',
            key: storeKey,
            value: config,
          });
          configured++;
          strapi.log.debug(
            `[component-preview] Set mainField="${mainField}" for ${uid}`
          );
        }
      }
    } catch {
      // Silently skip - non-critical
    }
  }

  if (configured > 0) {
    strapi.log.info(
      `[component-preview] Configured mainField for ${configured} component(s)`
    );
  }
}
