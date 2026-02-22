#!/usr/bin/env bun
/**
 * Manual test: hit the real /api/show endpoint and verify
 * resolveContextLength + fetchModelInfo work correctly.
 *
 * Run: bun run tests/test-api-show.ts
 */

import {
  clearModelInfoCache,
  fetchModelInfo,
  resolveContextLength,
} from '../src/lib/tokenizer';

const model = process.argv[2] ?? 'glm-5:cloud';
const host = process.argv[3] ?? 'https://ollama.com';

console.log(`\nTesting /api/show for model="${model}" host="${host}"\n`);

// First, hit /api/show directly to see the raw response
try {
  const response = await fetch(`${host}/api/show`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OLLAMA_API_KEY ?? ''}`,
    },
    body: JSON.stringify({ model }),
  });

  if (!response.ok) {
    console.error(`HTTP ${response.status}: ${await response.text()}`);
    process.exit(1);
  }

  const data = (await response.json()) as Record<string, unknown>;

  // Show raw parameters field
  console.log('=== Raw parameters field ===');
  console.log(data.parameters ?? '(not present)');
  console.log();

  // Show model_info context_length keys
  console.log('=== model_info context_length ===');
  const modelInfo = (data.model_info ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(modelInfo)) {
    if (key.includes('context')) {
      console.log(`  ${key}: ${value}`);
    }
  }
  console.log();

  // Test resolveContextLength with the actual data
  let archContextLength = 0;
  for (const [key, value] of Object.entries(modelInfo)) {
    if (key.endsWith('.context_length') || key === 'context_length') {
      archContextLength = value as number;
      break;
    }
  }

  const resolved = resolveContextLength(
    archContextLength,
    data.parameters as string | undefined,
  );
  console.log('=== resolveContextLength result ===');
  console.log(`  archContextLength: ${archContextLength}`);
  console.log(`  resolved (effective): ${resolved}`);
  console.log(
    resolved < archContextLength
      ? `  num_ctx applied: ${resolved} (lower than arch ${archContextLength})`
      : '  num_ctx: not present or not lower than arch limit',
  );
  console.log();

  // Now test fetchModelInfo (cached path)
  clearModelInfoCache();
  const info = await fetchModelInfo(model, host);
  console.log('=== fetchModelInfo result ===');
  console.log(JSON.stringify(info, null, 2));
} catch (e) {
  console.error('Error:', e instanceof Error ? e.message : e);
  process.exit(1);
}
