const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

// Fix for pnpm virtual store layout: Metro's getTransformCacheKey.js
// resolves ../../package.json relative to its own location inside
// .pnpm/metro@x.x.x/node_modules/metro/src/DeltaBundler/ which points
// outside the package in pnpm's non-hoisted structure.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
];

// Required for pnpm: ensure Metro watches the actual node_modules
// and not just symlinked paths from the virtual store.
config.watchFolders = [projectRoot];

// Enable package exports resolution — required for pnpm where packages
// use exports field in package.json instead of main.
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
