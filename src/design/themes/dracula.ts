/**
 * Dracula Theme
 *
 * The classic dark theme with purple and pink accents.
 * https://draculatheme.com/
 */

import type { Theme } from '../tokens';

export const draculaTheme: Theme = {
  id: 'dracula',
  name: 'Dracula',
  dark: {
    seeds: {
      neutral: '#282a36',
      primary: '#bd93f9',
      success: '#50fa7b',
      warning: '#ffb86c',
      error: '#ff5555',
      info: '#8be9fd',
    },
    overrides: {
      bgBase: '#282a36',
      bgSurface: '#1e1f29',
      bgInput: '#343746',
      borderBase: '#44475a',
      borderMuted: '#383a46',
      textBase: '#f8f8f2',
      textMuted: '#6272a4',
      // Dracula-specific syntax colors
      syntaxKeyword: '#ff79c6',
      syntaxString: '#f1fa8c',
      syntaxNumber: '#bd93f9',
      syntaxFunction: '#50fa7b',
      syntaxProperty: '#8be9fd',
      syntaxType: '#8be9fd',
      syntaxConstant: '#bd93f9',
      syntaxComment: '#6272a4',
      syntaxOperator: '#ff79c6',
      // Diff colors
      diffAdd: '#50fa7b',
      diffAddBg: '#2d4737',
      diffDelete: '#ff5555',
      diffDeleteBg: '#4d2d37',
    },
  },
  light: {
    seeds: {
      neutral: '#f8f8f2',
      primary: '#7c6bf5',
      success: '#2fbf71',
      warning: '#f7a14d',
      error: '#d9536f',
      info: '#1d7fc5',
    },
    overrides: {
      bgBase: '#f8f8f2',
      bgSurface: '#ffffff',
      bgInput: '#ffffff',
      borderBase: '#e2e3da',
      textBase: '#1f1f2f',
      textMuted: '#52526b',
    },
  },
};
