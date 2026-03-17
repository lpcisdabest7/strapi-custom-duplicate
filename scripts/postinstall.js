import { existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TARGET_REL =
  '@strapi/content-manager/dist/admin/pages/EditView/components/FormInputs/Component/Repeatable.mjs';

/**
 * Walk up from __dirname to find the closest node_modules directory
 * that contains @strapi/content-manager.
 */
function findNodeModules() {
  // Start from the package root: scripts/ -> strapi-custom-duplicate/
  let dir = resolve(__dirname, '..');

  for (let i = 0; i < 10; i++) {
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root

    // Check if parent is node_modules containing @strapi/content-manager
    if (existsSync(join(parent, '@strapi', 'content-manager'))) {
      return parent;
    }
    // Check if parent has a node_modules/ with @strapi/content-manager
    const nmDir = join(parent, 'node_modules');
    if (existsSync(join(nmDir, '@strapi', 'content-manager'))) {
      return nmDir;
    }
    dir = parent;
  }
  return null;
}

const nodeModules = findNodeModules();

if (!nodeModules) {
  console.log(
    '[strapi-custom-duplicate] @strapi/content-manager not found in any parent node_modules — skipping postinstall.'
  );
  process.exit(0);
}

const PATCHES = [
  {
    src: resolve(__dirname, '..', 'src', 'Repeatable.mjs'),
    dest: join(nodeModules, '@strapi/content-manager/dist/admin/pages/EditView/components/FormInputs/Component/Repeatable.mjs'),
    label: 'Repeatable.mjs (duplicate/search/labels)',
  },
  {
    src: resolve(__dirname, '..', 'src', 'patches', 'CellContent.mjs'),
    dest: join(nodeModules, '@strapi/content-manager/dist/admin/pages/ListView/components/TableCells/CellContent.mjs'),
    label: 'CellContent.mjs (list view component flatten)',
  },
  {
    src: resolve(__dirname, '..', 'src', 'patches', 'collection-types.js'),
    dest: join(nodeModules, '@strapi/content-manager/dist/server/controllers/collection-types.js'),
    label: 'collection-types.js (server list flatten)',
  },
];

let applied = 0;
for (const patch of PATCHES) {
  if (!existsSync(patch.src)) {
    console.warn(`[strapi-custom-duplicate] Source not found: ${patch.src}`);
    continue;
  }
  try {
    mkdirSync(dirname(patch.dest), { recursive: true });
    copyFileSync(patch.src, patch.dest);
    applied++;
    console.log(`[strapi-custom-duplicate] ✔ ${patch.label}`);
  } catch (err) {
    console.error(`[strapi-custom-duplicate] ✖ ${patch.label}: ${err.message}`);
  }
}
console.log(`[strapi-custom-duplicate] ${applied}/${PATCHES.length} patches applied.`);
