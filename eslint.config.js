// SPDX-License-Identifier: AGPL-3.0-or-later
import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import vue from 'eslint-plugin-vue'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'dist',
      'dist-e2e',
      'coverage',
      'playwright-report',
      'test-results',
      'docs',
      '.claude/worktrees',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    // Base and shell components are named for what they are (Button, Tree, Navigator).
    files: ['src/components/ui/**/*.vue', 'src/components/shell/**/*.vue'],
    rules: { 'vue/multi-word-component-names': 'off' },
  },
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  prettier,
)
