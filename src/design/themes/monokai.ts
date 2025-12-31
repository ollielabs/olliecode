/**
 * Monokai Theme
 *
 * The classic warm theme with vibrant syntax colors.
 * Originally created for Sublime Text.
 */

import type { Theme } from "../tokens";

export const monokaiTheme: Theme = {
  id: "monokai",
  name: "Monokai",
  dark: {
    seeds: {
      neutral: "#272822",
      primary: "#a6e22e",
      success: "#a6e22e",
      warning: "#e6db74",
      error: "#f92672",
      info: "#66d9ef",
    },
    overrides: {
      bgBase: "#272822",
      bgSurface: "#1e1f1c",
      bgInput: "#3e3d32",
      bgSurfaceHover: "#3e3d32",
      borderBase: "#49483e",
      borderMuted: "#3e3d32",
      textBase: "#f8f8f2",
      textMuted: "#75715e",
      textSubtle: "#49483e",
      // Monokai signature colors
      syntaxKeyword: "#f92672",
      syntaxString: "#e6db74",
      syntaxNumber: "#ae81ff",
      syntaxFunction: "#a6e22e",
      syntaxProperty: "#66d9ef",
      syntaxType: "#66d9ef",
      syntaxConstant: "#ae81ff",
      syntaxComment: "#75715e",
      syntaxOperator: "#f92672",
      syntaxVariable: "#f8f8f2",
    },
  },
  light: {
    seeds: {
      neutral: "#fafafa",
      primary: "#629755",
      success: "#629755",
      warning: "#cc7832",
      error: "#c75450",
      info: "#287bde",
    },
    overrides: {
      bgBase: "#fafafa",
      bgSurface: "#ffffff",
      bgInput: "#ffffff",
      textBase: "#272822",
      textMuted: "#75715e",
    },
  },
};
