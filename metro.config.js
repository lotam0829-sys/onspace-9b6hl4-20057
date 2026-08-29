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

// Pin metro-transform-worker to a single copy so Metro's "expected one
// Expo template package, found 2" check never triggers. pnpm's virtual
// store can surface the same package via both the top-level node_modules
// symlink and the .pnpm store path; extraNodeModules forces one winner.
config.resolver.extraNodeModules = {
  'metro-transform-worker': path.resolve(projectRoot, 'node_modules/metro-transform-worker'),
};

module.exports = config;
