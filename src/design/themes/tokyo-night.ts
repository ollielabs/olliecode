/**
 * Tokyo Night Theme
 *
 * A clean dark theme inspired by Tokyo city lights.
 * https://github.com/enkia/tokyo-night-vscode-theme
 */

import type { Theme } from '../tokens';

export const tokyoNightTheme: Theme = {
  id: 'tokyo-night',
  name: 'Tokyo Night',
  dark: {
    seeds: {
      neutral: '#1a1b26',
      primary: '#7aa2f7',
      success: '#9ece6a',
      warning: '#e0af68',
      error: '#f7768e',
      info: '#7dcfff',
    },
    overrides: {
      bgBase: '#1a1b26',
      bgSurface: '#24283b',
      bgInput: '#2f3447',
      borderBase: '#3b4261',
      borderMuted: '#292e42',
      textBase: '#c0caf5',
      textMuted: '#565f89',
      textSubtle: '#414868',
      // Tokyo Night specific syntax
      syntaxKeyword: '#9d7cd8',
      syntaxString: '#9ece6a',
      syntaxNumber: '#ff9e64',
      syntaxFunction: '#7aa2f7',
      syntaxProperty: '#73daca',
      syntaxType: '#2ac3de',
      syntaxConstant: '#ff9e64',
      syntaxComment: '#565f89',
      syntaxOperator: '#89ddff',
      syntaxVariable: '#c0caf5',
      // Diff colors
      diffAdd: '#9ece6a',
      diffAddBg: '#1a3d1a',
      diffDelete: '#f7768e',
      diffDeleteBg: '#3d1a1a',
    },
  },
  light: {
    seeds: {
      neutral: '#d5d6db',
      primary: '#2e7de9',
      success: '#587539',
      warning: '#8c6c3e',
      error: '#f52a65',
      info: '#007197',
    },
    overrides: {
      bgBase: '#d5d6db',
      bgSurface: '#e9e9ec',
      bgInput: '#f2f2f4',
      textBase: '#343b58',
      textMuted: '#6172b0',
    },
  },
};
