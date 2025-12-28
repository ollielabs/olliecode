/**
 * Bun preload plugin for React Compiler.
 * Transforms TSX files through Babel with the React Compiler plugin.
 * 
 * This only runs during development - the compiled binary won't have
 * Babel available and this plugin will silently skip transformation.
 */

import { plugin } from "bun";

// Try to load Babel - it won't be available in the compiled binary
let transformSync: typeof import("@babel/core").transformSync | null = null;

try {
  const babel = await import("@babel/core");
  transformSync = babel.transformSync;
} catch {
  // Babel not available (running compiled binary) - that's fine
}

if (transformSync) {
  const transform = transformSync;
  
  plugin({
    name: "react-compiler",
    setup(build) {
      build.onLoad({ filter: /\.tsx$/ }, async ({ path }) => {
        // Skip node_modules
        if (path.includes("node_modules")) {
          return undefined;
        }

        const source = await Bun.file(path).text();

        try {
          const result = transform(source, {
            filename: path,
            presets: [
              ["@babel/preset-typescript", { isTSX: true, allExtensions: true }],
            ],
            plugins: ["babel-plugin-react-compiler"],
            sourceMaps: "inline",
          });

          if (!result?.code) {
            return undefined;
          }

          return {
            contents: result.code,
            loader: "tsx",
          };
        } catch (error) {
          // Log compilation errors but don't fail - let Bun handle the file normally
          console.error(`[react-compiler] Failed to compile ${path}:`, error);
          return undefined;
        }
      });
    },
  });
}
