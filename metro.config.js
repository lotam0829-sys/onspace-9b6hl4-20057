const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Required for pnpm's non-hoisted virtual store layout.
// Without this, Metro's internal getTransformCacheKey.js fails to resolve
// its own package.json via a relative path (../../package.json) because
// pnpm nests packages under .pnpm/<pkg>@version/node_modules/<pkg>/
// instead of the flat node_modules/<pkg>/ that Metro expects.
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
];

module.exports = config;
