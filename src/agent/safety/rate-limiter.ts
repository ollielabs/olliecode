/**
 * Rate limiting for safety layer.
 * Prevents runaway tool usage and detects loops.
 */

import type { SafetyConfig } from "./types";

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; reason: string };

// Track tool calls within a session
type ToolCallRecord = {
  tool: string;
  argsHash: string;
  timestamp: number;
};

/**
 * Rate limiter state for a session.
 */
export class RateLimiter {
  private turnCalls: number = 0;
  private sessionCalls: number = 0;
  private recentCalls: ToolCallRecord[] = [];
  private config: SafetyConfig;
  
  constructor(config: SafetyConfig) {
    this.config = config;
  }
  
  /**
   * Check if a tool call is allowed under rate limits.
   */
  check(tool: string, args: Record<string, unknown>): RateLimitResult {
    // Check turn limit
    if (this.turnCalls >= this.config.maxToolCallsPerTurn) {
      return {
        allowed: false,
        reason: `Rate limit exceeded: maximum ${this.config.maxToolCallsPerTurn} tool calls per turn.`,
      };
    }
    
    // Check session limit
    if (this.sessionCalls >= this.config.maxToolCallsPerSession) {
      return {
        allowed: false,
        reason: `Rate limit exceeded: maximum ${this.config.maxToolCallsPerSession} tool calls per session.`,
      };
    }
    
    // Check for rapid repeat (same tool + args within cooldown period)
    const argsHash = hashArgs(args);
    const now = Date.now();
    const cooldownMs = 5000; // 5 second cooldown for identical calls
    
    const recentIdentical = this.recentCalls.filter(
      call => call.tool === tool && 
              call.argsHash === argsHash && 
              now - call.timestamp < cooldownMs
    );
    
    if (recentIdentical.length >= 2) {
      return {
        allowed: false,
        reason: `Loop detected: ${tool} called with same arguments ${recentIdentical.length + 1} times within ${cooldownMs / 1000}s.`,
      };
    }
    
    return { allowed: true };
  }
  
  /**
   * Record a tool call (call after execution).
   */
  record(tool: string, args: Record<string, unknown>): void {
    this.turnCalls++;
    this.sessionCalls++;
    
    this.recentCalls.push({
      tool,
      argsHash: hashArgs(args),
      timestamp: Date.now(),
    });
    
    // Keep only recent calls (last 60 seconds)
    const cutoff = Date.now() - 60000;
    this.recentCalls = this.recentCalls.filter(call => call.timestamp > cutoff);
  }
  
  /**
   * Reset turn counter (call at start of each agent turn).
   */
  resetTurn(): void {
    this.turnCalls = 0;
  }
  
  /**
   * Reset all counters (call at start of new session).
   */
  resetSession(): void {
    this.turnCalls = 0;
    this.sessionCalls = 0;
    this.recentCalls = [];
  }
  
  /**
   * Get current stats.
   */
  getStats(): { turnCalls: number; sessionCalls: number } {
    return {
      turnCalls: this.turnCalls,
      sessionCalls: this.sessionCalls,
    };
  }
}

/**
 * Simple hash of arguments for comparison.
 */
function hashArgs(args: Record<string, unknown>): string {
  return JSON.stringify(args, Object.keys(args).sort());
}
