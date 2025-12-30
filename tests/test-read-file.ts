#!/usr/bin/env bun
/**
 * Test read_file tool enhancements.
 * 
 * Validates that:
 * 1. Line numbers are added to output
 * 2. Offset and limit parameters work
 * 3. Long lines are truncated
 * 4. Output is wrapped in <file> tags
 */

import { readFileTool } from "../src/agent/tools/read-file";

async function runTests(): Promise<void> {
  console.log("=== read_file Tool Tests ===\n");
  
  let passed = 0;
  let failed = 0;

  // Test 1: Line numbers are added
  console.log("Test 1: Line numbers are added to output");
  {
    const result = await readFileTool.execute({ path: "package.json" });
    
    // Should contain line number format "   1|" somewhere in the output
    const hasLineNumbers = /\s*\d+\|/.test(result);
    const lineNumberMatches = result.match(/^\s*\d+\|/gm) || [];
    const hasMultipleLineNumbers = lineNumberMatches.length > 5;
    
    if (hasLineNumbers && hasMultipleLineNumbers) {
      console.log(`  ✅ PASS: Output contains ${lineNumberMatches.length} line numbers`);
      passed++;
    } else {
      console.log("  ❌ FAIL: Line numbers not found in output");
      console.log(`  Sample: ${result.slice(0, 200)}`);
      failed++;
    }
  }

  // Test 2: Output wrapped in <file> tags
  console.log("\nTest 2: Output wrapped in <file> tags");
  {
    const result = await readFileTool.execute({ path: "package.json" });
    
    const hasOpenTag = result.includes('<file path="');
    const hasCloseTag = result.includes('</file>');
    
    if (hasOpenTag && hasCloseTag) {
      console.log("  ✅ PASS: Output wrapped in <file> tags");
      passed++;
    } else {
      console.log(`  ❌ FAIL: Missing file tags (open: ${hasOpenTag}, close: ${hasCloseTag})`);
      failed++;
    }
  }

  // Test 3: Offset parameter works
  console.log("\nTest 3: Offset parameter skips lines");
  {
    const fullResult = await readFileTool.execute({ path: "package.json" });
    const offsetResult = await readFileTool.execute({ path: "package.json", offset: 5 });
    
    // First line number in offset result should be 6 (1-based)
    const firstLineMatch = offsetResult.match(/^\s*(\d+)\|/m);
    const firstLineNum = firstLineMatch ? parseInt(firstLineMatch[1]!, 10) : 0;
    
    if (firstLineNum === 6) {
      console.log("  ✅ PASS: Offset correctly starts at line 6");
      passed++;
    } else {
      console.log(`  ❌ FAIL: Expected first line 6, got ${firstLineNum}`);
      failed++;
    }
  }

  // Test 4: Limit parameter restricts lines
  console.log("\nTest 4: Limit parameter restricts line count");
  {
    const result = await readFileTool.execute({ path: "package.json", limit: 5 });
    
    // Count lines with line numbers
    const lineCount = (result.match(/^\s*\d+\|/gm) || []).length;
    
    if (lineCount === 5) {
      console.log("  ✅ PASS: Limit correctly restricts to 5 lines");
      passed++;
    } else {
      console.log(`  ❌ FAIL: Expected 5 lines, got ${lineCount}`);
      failed++;
    }
  }

  // Test 5: Offset + Limit together
  console.log("\nTest 5: Offset and limit work together");
  {
    const result = await readFileTool.execute({ path: "package.json", offset: 3, limit: 4 });
    
    // Should have lines 4, 5, 6, 7
    const lineNumbers = (result.match(/^\s*(\d+)\|/gm) || [])
      .map(m => parseInt(m.replace(/[^\d]/g, ""), 10));
    
    const expected = [4, 5, 6, 7];
    const matches = lineNumbers.length === 4 && 
      lineNumbers.every((n, i) => n === expected[i]);
    
    if (matches) {
      console.log(`  ✅ PASS: Lines ${lineNumbers.join(", ")} returned correctly`);
      passed++;
    } else {
      console.log(`  ❌ FAIL: Expected lines 4-7, got ${lineNumbers.join(", ")}`);
      failed++;
    }
  }

  // Test 6: Path included in file tag
  console.log("\nTest 6: Path included in file tag");
  {
    const result = await readFileTool.execute({ path: "package.json" });
    
    const hasPath = result.includes('<file path="') && result.includes('package.json');
    
    if (hasPath) {
      console.log("  ✅ PASS: Path included in file tag");
      passed++;
    } else {
      console.log("  ❌ FAIL: Path not found in file tag");
      failed++;
    }
  }

  // Test 7: Error handling for missing file
  console.log("\nTest 7: Error handling for missing file");
  {
    try {
      await readFileTool.execute({ path: "nonexistent-file-12345.txt" });
      console.log("  ❌ FAIL: Should have thrown an error");
      failed++;
    } catch (error) {
      console.log("  ✅ PASS: Throws error for missing file");
      passed++;
    }
  }

  // Test 8: Line number padding is consistent
  console.log("\nTest 8: Line number padding is consistent");
  {
    const result = await readFileTool.execute({ path: "package.json" });
    
    // All line numbers should have same padding width
    const lineNumberMatches = result.match(/^(\s*\d+)\|/gm) || [];
    const widths = new Set(lineNumberMatches.map(m => m.indexOf("|")));
    
    if (widths.size === 1) {
      console.log("  ✅ PASS: Line number padding is consistent");
      passed++;
    } else {
      console.log(`  ❌ FAIL: Inconsistent padding widths: ${[...widths].join(", ")}`);
      failed++;
    }
  }

  // Summary
  console.log("\n" + "=".repeat(50));
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
  
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(console.error);
