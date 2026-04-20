/**
 * Tests for MCP TUI display utilities (Issue #93).
 *
 * Tests pure functions: parseMcpToolName, getToolDisplayName,
 * MCP_STATUS_ICONS, getMcpStatusDetail.
 * No SolidJS/OpenTUI dependency — these are plain TS functions.
 */

import { describe, expect, test } from 'bun:test';
import {
  MCP_STATUS_ICONS,
  getMcpStatusDetail,
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

// --- MCP_STATUS_ICONS ---

describe('MCP_STATUS_ICONS', () => {
  test('has icons for all connection statuses', () => {
    expect(MCP_STATUS_ICONS.connected).toBeDefined();
    expect(MCP_STATUS_ICONS.connecting).toBeDefined();
    expect(MCP_STATUS_ICONS.error).toBeDefined();
    expect(MCP_STATUS_ICONS.disconnected).toBeDefined();
  });

  test('icons are single characters', () => {
    for (const icon of Object.values(MCP_STATUS_ICONS)) {
      expect(icon.length).toBe(1);
    }
  });
});

// --- getMcpStatusDetail ---

describe('getMcpStatusDetail', () => {
  test('connected with 1 tool shows singular', () => {
    expect(getMcpStatusDetail('connected', 1)).toBe('1 tool');
  });

  test('connected with multiple tools shows plural', () => {
    expect(getMcpStatusDetail('connected', 3)).toBe('3 tools');
  });

  test('connected with 0 tools shows plural', () => {
    expect(getMcpStatusDetail('connected', 0)).toBe('0 tools');
  });

  test('connecting shows connecting text', () => {
    expect(getMcpStatusDetail('connecting', 0)).toBe('connecting...');
  });

  test('error shows error text', () => {
    expect(getMcpStatusDetail('error', 0)).toBe('error');
  });

  test('disconnected shows off', () => {
    expect(getMcpStatusDetail('disconnected', 0)).toBe('off');
  });
});
