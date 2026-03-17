const fs = require('fs');
const path = require('path');

const PATCHES = [
  {
    src: 'patches/content-manager/dist/admin/pages/EditView/components/FormInputs/Component/Repeatable.mjs',
    dest: '@strapi/content-manager/dist/admin/pages/EditView/components/FormInputs/Component/Repeatable.mjs',
  },
];

function findNodeModules() {
  // Walk up from this package's location to find the root node_modules
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    dir = path.resolve(dir, '..');
    const basename = path.basename(dir);
    if (basename === 'node_modules') {
      return dir;
    }
  }
  // Fallback: assume standard hoisted layout
  return path.resolve(__dirname, '..', '..', '..');
}

function apply() {
  const nodeModules = findNodeModules();
  let applied = 0;

  for (const patch of PATCHES) {
    const srcFile = path.resolve(__dirname, '..', patch.src);
    const destFile = path.resolve(nodeModules, patch.dest);

    if (!fs.existsSync(srcFile)) {
      console.warn(`[strapi-custom-duplicate] Source not found: ${srcFile}`);
      continue;
    }

    if (!fs.existsSync(path.dirname(destFile))) {
      console.warn(`[strapi-custom-duplicate] Target directory not found: ${path.dirname(destFile)}`);
      console.warn(`[strapi-custom-duplicate] Is @strapi/content-manager installed?`);
      continue;
    }

    fs.copyFileSync(srcFile, destFile);
    applied++;
    console.log(`[strapi-custom-duplicate] Patched: ${patch.dest}`);
  }

  if (applied === 0) {
    console.warn('[strapi-custom-duplicate] No patches applied. Ensure @strapi/content-manager is installed.');
  } else {
    console.log(`[strapi-custom-duplicate] ${applied} patch(es) applied successfully.`);
  }
}

apply();
