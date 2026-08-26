// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // eslint-config-expo's flat preset replaces its TypeScript resolver with
    // the Node resolver. Workspace packages expose their TypeScript sources
    // through `exports`, so restore the resolver for this pnpm app.
    settings: {
      'import/resolver': {
        typescript: { project: './tsconfig.json' },
        node: { extensions: ['.js', '.jsx', '.ts', '.tsx'] },
      },
    },
  },
  {
    ignores: ["dist/*"],
  }
]);
