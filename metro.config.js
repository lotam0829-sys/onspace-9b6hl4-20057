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

// Fix for pnpm: metro/src/DeltaBundler/getTransformCacheKey.js does
// require('../../package.json') which resolves to the virtual store root
// (node_modules/.pnpm/metro@x/node_modules/package.json) — a path that
// doesn't exist in pnpm's non-hoisted layout. Intercept and redirect to
// the actual metro package.json one level up.
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName === '../../package.json' &&
    context.originModulePath.includes('/metro/src/DeltaBundler/')
  ) {
    const metroRoot = context.originModulePath.split('/metro/src/')[0] + '/metro';
    return { type: 'sourceFile', filePath: path.join(metroRoot, 'package.json') };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
