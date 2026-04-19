/**
 * Tests for MCP TUI display utilities (Issue #93).
 *
 * Tests pure functions: parseMcpToolName, getToolDisplayName, formatMcpStatus.
 * No SolidJS/OpenTUI dependency — these are plain TS functions.
 */

import { describe, expect, test } from 'bun:test';
import type { McpStatusMap } from '../src/agent/mcp/types';
import {
  formatMcpStatus,
  getToolDisplayName,
  parseMcpToolName,
} from '../src/tui/utils/mcp-display';

// --- parseMcpToolName ---

describe('parseMcpToolName', () => {
  test('parses simple mcp__server__tool', () => {
    const result = parseMcpToolName('mcp__github__list_repos');
    expect(result).toEqual({
      displayName: 'github > list_repos',
      serverName: 'github',
      toolName: 'list_repos',
    });
  });

  test('parses server name with single underscore', () => {
    const result = parseMcpToolName('mcp__my_server__do_thing');
    expect(result).toEqual({
      displayName: 'my_server > do_thing',
      serverName: 'my_server',
      toolName: 'do_thing',
    });
  });

  test('returns null for native tool names', () => {
    expect(parseMcpToolName('read_file')).toBeNull();
    expect(parseMcpToolName('run_command')).toBeNull();
    expect(parseMcpToolName('edit_file')).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(parseMcpToolName('')).toBeNull();
  });

  test('returns null for partial mcp__ prefix without tool', () => {
    expect(parseMcpToolName('mcp__server')).toBeNull();
  });

  test('parses tool name with underscores', () => {
    const result = parseMcpToolName('mcp__context7__resolve_library_id');
    expect(result).toEqual({
      displayName: 'context7 > resolve_library_id',
      serverName: 'context7',
      toolName: 'resolve_library_id',
    });
  });
});

// --- getToolDisplayName ---

describe('getToolDisplayName', () => {
  test('formats MCP tool as server > tool', () => {
    expect(getToolDisplayName('mcp__github__list_repos')).toBe(
      'github > list_repos',
    );
  });

  test('passes through native tool names unchanged', () => {
    expect(getToolDisplayName('read_file')).toBe('read_file');
    expect(getToolDisplayName('run_command')).toBe('run_command');
    expect(getToolDisplayName('glob')).toBe('glob');
  });
});

// --- formatMcpStatus ---

describe('formatMcpStatus', () => {
  test('returns null for undefined status', () => {
    expect(formatMcpStatus(undefined, false)).toBeNull();
  });

  test('returns null for empty status map', () => {
    const status: McpStatusMap = new Map();
    expect(formatMcpStatus(status, false)).toBeNull();
  });

  test('returns connecting message when connecting flag is true', () => {
    const status: McpStatusMap = new Map([
      ['github', { status: 'connecting', toolCount: 0 }],
    ]);
    expect(formatMcpStatus(status, true)).toBe('MCP: connecting...');
  });

  test('shows connected servers with tool counts', () => {
    const status: McpStatusMap = new Map([
      ['github', { status: 'connected', toolCount: 3 }],
      ['context7', { status: 'connected', toolCount: 2 }],
    ]);
    expect(formatMcpStatus(status, false)).toBe('MCP: github(3) context7(2)');
  });

  test('shows error state as (err)', () => {
    const status: McpStatusMap = new Map([
      ['github', { status: 'error', toolCount: 0, error: 'Connection failed' }],
    ]);
    expect(formatMcpStatus(status, false)).toBe('MCP: github(err)');
  });

  test('shows connecting state as (...)', () => {
    const status: McpStatusMap = new Map([
      ['github', { status: 'connecting', toolCount: 0 }],
    ]);
    expect(formatMcpStatus(status, false)).toBe('MCP: github(...)');
  });

  test('shows disconnected state as (off)', () => {
    const status: McpStatusMap = new Map([
      ['github', { status: 'disconnected', toolCount: 0 }],
    ]);
    expect(formatMcpStatus(status, false)).toBe('MCP: github(off)');
  });

  test('shows mixed status correctly', () => {
    const status: McpStatusMap = new Map([
      ['github', { status: 'connected', toolCount: 3 }],
      ['badserver', { status: 'error', toolCount: 0, error: 'timeout' }],
      ['context7', { status: 'connected', toolCount: 2 }],
    ]);
    expect(formatMcpStatus(status, false)).toBe(
      'MCP: github(3) badserver(err) context7(2)',
    );
  });
});
