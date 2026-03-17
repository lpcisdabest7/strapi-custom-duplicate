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
  let dir = resolve(__dirname, '..');
  const root = dirname(dir); // stop guard

  while (dir !== root) {
    const candidate = join(dir, 'node_modules');
    if (existsSync(join(candidate, '@strapi', 'content-manager'))) {
      return candidate;
    }
    dir = dirname(dir);
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

const src = resolve(__dirname, '..', 'src', 'Repeatable.mjs');
const dest = join(nodeModules, TARGET_REL);

if (!existsSync(src)) {
  console.error(`[strapi-custom-duplicate] Source file not found: ${src}`);
  process.exit(1);
}

try {
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  console.log(`[strapi-custom-duplicate] Patched Repeatable.mjs -> ${dest}`);
} catch (err) {
  console.error(`[strapi-custom-duplicate] Failed to copy Repeatable.mjs: ${err.message}`);
  process.exit(1);
}
