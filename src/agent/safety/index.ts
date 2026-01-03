/**
 * Safety Layer - Central gateway for all tool executions.
 * 
 * All tool calls pass through this layer which:
 * 1. Validates paths and commands
 * 2. Checks rate limits
 * 3. Determines if confirmation is needed
 * 4. Logs all executions
 */

import type { ToolCall } from "ollama";
import type { ToolResult } from "../types";
import type { 
  SafetyConfig, 
  SafetyCheckResult, 
  ConfirmationRequest, 
  ConfirmationPreview,
  RiskLevel,
  ConfirmationResponse,
} from "./types";
import { DEFAULT_SAFETY_CONFIG } from "./types";
import { SafetyValidator } from "./validator";
import { RateLimiter } from "./rate-limiter";
import { AuditLog } from "./audit-log";
import { validatePath, getDisplayPath } from "./path-validation";
import { validateCommand, validateCommandForMode, sanitizeEnvironment } from "./command-filter";
import type { AgentMode } from "../modes";

// Tools that operate on paths
const PATH_TOOLS = ["read_file", "write_file", "edit_file", "list_dir", "glob", "grep"];

// Tools that execute commands
const COMMAND_TOOLS = ["run_command"];

// Tool risk levels (should match tool definitions, but we enforce here too)
const TOOL_RISK: Record<string, RiskLevel> = {
  read_file: "safe",
  list_dir: "safe",
  glob: "safe",
  grep: "safe",
  write_file: "prompt",
  edit_file: "prompt",
  run_command: "prompt",
  todo_write: "safe",
  todo_read: "safe",
  task: "safe", // Subagent delegation is read-only
};

/**
 * Safety layer instance for a session.
 */
export class SafetyLayer {
  private config: SafetyConfig;
  private rateLimiter: RateLimiter;
  private auditLog: AuditLog;
  private alwaysAllow: Set<string> = new Set();
  
  constructor(config: Partial<SafetyConfig> = {}) {
    this.config = { ...DEFAULT_SAFETY_CONFIG, ...config };
    this.rateLimiter = new RateLimiter(this.config);
    this.auditLog = new AuditLog(this.config);
  }
  
  /**
   * Check if a tool call is allowed.
   * Returns allowed, denied, or needs_confirmation.
   * 
   * @param toolCall - The tool call to check
   * @param mode - Optional agent mode for mode-specific validation (e.g., plan mode command restrictions)
   */
  async checkToolCall(
    toolCall: ToolCall,
    mode?: AgentMode
  ): Promise<SafetyCheckResult> {
    const { name: tool } = toolCall.function;
    const args = toolCall.function.arguments as Record<string, unknown>;
    
    // Check rate limits first
    const rateCheck = this.rateLimiter.check(tool, args);
    if (!rateCheck.allowed) {
      return { status: "denied", reason: rateCheck.reason };
    }
    
    // Check tool overrides
    const override = this.config.toolOverrides[tool];
    if (override?.autonomy === "always_deny") {
      return { status: "denied", reason: `Tool "${tool}" is configured to always deny.` };
    }
    
    // Path validation for file tools
    if (PATH_TOOLS.includes(tool)) {
      const pathArg = (args.path ?? args.cwd) as string | undefined;
      if (pathArg) {
        const operation = tool === "read_file" || tool === "list_dir" || tool === "glob" || tool === "grep" 
          ? "read" 
          : "write";
        const pathCheck = validatePath(pathArg, this.config, operation);
        if (!pathCheck.valid) {
          return { status: "denied", reason: pathCheck.reason };
        }
      }
    }
    
    // Command validation for run_command
    if (COMMAND_TOOLS.includes(tool)) {
      const command = args.command as string | undefined;
      if (command) {
        // Use mode-aware validation if mode is provided
        const cmdCheck = mode
          ? validateCommandForMode(command, mode, this.config)
          : validateCommand(command, this.config);
        
        if (cmdCheck.valid === false) {
          return { status: "denied", reason: cmdCheck.reason };
        }
        
        // Handle "ask" result from plan mode validation
        if (cmdCheck.valid === "ask") {
          const request: ConfirmationRequest = {
            id: generateRequestId(),
            tool,
            args,
            riskLevel: "prompt",
            description: cmdCheck.reason,
            preview: {
              type: "command",
              command,
              cwd: (args.cwd as string) ?? process.cwd(),
            },
          };
          return { status: "needs_confirmation", request };
        }
      }
    }
    
    // BUG-001 FIX: Block write_file with empty/minimal content to existing files
    // This catches attempts to "delete" files by writing empty content
    if (tool === "write_file") {
      const content = args.content as string | undefined;
      const path = args.path as string | undefined;
      
      if (path) {
        try {
          const file = Bun.file(path);
          const exists = await file.exists();
          
          if (exists) {
            // Check for empty/minimal content (deletion attempt)
            if (content === undefined || content === null || content === "" || content.trim().length < 10) {
              return { 
                status: "denied", 
                reason: `Blocked: Cannot write empty or minimal content to existing file "${path}". This would effectively delete the file's contents. Use edit_file for modifications.`
              };
            }
            
            // BUG-003 PARTIAL FIX: Warn about using write_file on existing files
            // Require confirmation since edit_file would be safer
            const currentContent = await file.text();
            const contentLength = content?.length ?? 0;
            
            // If the new content is significantly different in size, it's suspicious
            if (Math.abs(currentContent.length - contentLength) > currentContent.length * 0.5) {
              const request: ConfirmationRequest = {
                id: generateRequestId(),
                tool,
                args,
                riskLevel: "dangerous",
                description: `Overwrite ${this.getDisplayPath(path)} (${currentContent.length} bytes → ${contentLength} bytes). Consider using edit_file for targeted changes.`,
                preview: {
                  type: "content",
                  content: truncate(content ?? "", 2000),
                  truncated: (content?.length ?? 0) > 2000,
                },
              };
              return { status: "needs_confirmation", request };
            }
          }
        } catch {
          // If we can't check, allow it to proceed to path validation
        }
      }
    }
    
    // Check if confirmation is needed based on autonomy level
    const riskLevel = TOOL_RISK[tool] ?? "prompt";
    const needsConfirmation = this.shouldConfirm(tool, riskLevel);
    
    if (needsConfirmation && !this.alwaysAllow.has(tool) && override?.autonomy !== "always_allow") {
      const preview = await this.buildPreview(tool, args);
      const request: ConfirmationRequest = {
        id: generateRequestId(),
        tool,
        args,
        riskLevel,
        description: this.buildDescription(tool, args),
        preview,
      };
      return { status: "needs_confirmation", request };
    }
    
    return { status: "allowed" };
  }
  
  /**
   * Record a tool execution (call after execution).
   */
  async recordExecution(
    tool: string,
    args: Record<string, unknown>,
    result: ToolResult,
    wasConfirmed: boolean,
    durationMs: number
  ): Promise<void> {
    // Record for rate limiting
    this.rateLimiter.record(tool, args);
    
    // Audit log
    await this.auditLog.log({
      tool,
      args,
      result: wasConfirmed ? "confirmed" : "allowed",
      durationMs,
      output: result.output,
      error: result.error,
    });
  }
  
  /**
   * Record a denied tool call.
   */
  async recordDenied(
    tool: string,
    args: Record<string, unknown>,
    reason: string
  ): Promise<void> {
    await this.auditLog.log({
      tool,
      args,
      result: "denied",
      reason,
    });
  }
  
  /**
   * Record a user rejection.
   */
  async recordRejected(
    tool: string,
    args: Record<string, unknown>
  ): Promise<void> {
    await this.auditLog.log({
      tool,
      args,
      result: "rejected",
      reason: "User rejected confirmation",
    });
  }
  
  /**
   * Handle user's confirmation response.
   */
  handleConfirmationResponse(response: ConfirmationResponse): void {
    if (response.action === "allow_always" && response.forTool) {
      this.alwaysAllow.add(response.forTool);
    }
  }
  
  /**
   * Reset turn counters (call at start of each agent iteration).
   */
  resetTurn(): void {
    this.rateLimiter.resetTurn();
  }
  
  /**
   * Flush audit log (call before exit).
   */
  async flush(): Promise<void> {
    await this.auditLog.flush();
  }
  
  /**
   * Get sanitized environment for subprocess execution.
   */
  getSanitizedEnv(): Record<string, string> {
    return sanitizeEnvironment(process.env);
  }
  
  /**
   * Get display path for UI.
   */
  getDisplayPath(path: string): string {
    return getDisplayPath(path, this.config);
  }
  
  /**
   * Check if tool requires confirmation based on autonomy level.
   */
  private shouldConfirm(tool: string, riskLevel: RiskLevel): boolean {
    const { autonomyLevel } = this.config;
    
    switch (autonomyLevel) {
      case "paranoid":
        return true;  // Confirm everything
        
      case "cautious":
        return riskLevel !== "safe";  // Confirm prompt and dangerous
        
      case "balanced":
        return riskLevel === "dangerous" || tool === "run_command";
        
      case "autonomous":
        return false;  // Confirm nothing
        
      default:
        return riskLevel !== "safe";
    }
  }
  
  /**
   * Build human-readable description of what the tool will do.
   */
  private buildDescription(tool: string, args: Record<string, unknown>): string {
    switch (tool) {
      case "write_file":
        return `Write ${(args.content as string)?.length ?? 0} bytes to ${this.getDisplayPath(args.path as string)}`;
        
      case "edit_file":
        return `Edit ${this.getDisplayPath(args.path as string)}: replace "${truncate(args.oldString as string, 50)}"`;
        
      case "run_command":
        return `Execute: ${args.command}${args.cwd ? ` (in ${args.cwd})` : ""}`;
        
      default:
        return `${tool}(${JSON.stringify(args)})`;
    }
  }
  
  /**
   * Build preview content for confirmation UI.
   */
  private async buildPreview(
    tool: string,
    args: Record<string, unknown>
  ): Promise<ConfirmationPreview | undefined> {
    try {
      switch (tool) {
        case "write_file": {
          const content = args.content as string;
          return {
            type: "content",
            content: truncate(content, 2000),
            truncated: content.length > 2000,
          };
        }
        
        case "edit_file": {
          const path = args.path as string;
          const oldString = args.oldString as string;
          const newString = args.newString as string;
          
          // Try to read current file content
          try {
            const file = Bun.file(path);
            if (await file.exists()) {
              const content = await file.text();
              const before = extractContext(content, oldString, 3);
              const after = before.replace(oldString, newString);
              return { type: "diff", before, after, filePath: path };
            }
          } catch {
            // Fall through to simple diff
          }
          
          return {
            type: "diff",
            before: oldString,
            after: newString,
            filePath: path,
          };
        }
        
        case "run_command": {
          return {
            type: "command",
            command: args.command as string,
            cwd: (args.cwd as string) ?? process.cwd(),
          };
        }
        
        default:
          return undefined;
      }
    } catch {
      return undefined;
    }
  }
}

/**
 * Generate unique request ID.
 */
function generateRequestId(): string {
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Truncate string with ellipsis.
 */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

/**
 * Extract context around a search string.
 */
function extractContext(content: string, search: string, contextLines: number): string {
  const lines = content.split("\n");
  const searchIndex = content.indexOf(search);
  
  if (searchIndex === -1) return search;
  
  // Find which line contains the search string
  let charCount = 0;
  let lineIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineWithNewline = (lines[i] ?? "") + "\n";
    if (charCount + lineWithNewline.length > searchIndex) {
      lineIndex = i;
      break;
    }
    charCount += lineWithNewline.length;
  }
  
  // Extract context lines
  const start = Math.max(0, lineIndex - contextLines);
  const end = Math.min(lines.length, lineIndex + contextLines + 1);
  
  return lines.slice(start, end).join("\n");
}

// Export types
export type { SafetyConfig, SafetyCheckResult, ConfirmationRequest, ConfirmationResponse };
export { DEFAULT_SAFETY_CONFIG };
export { validateCommandForMode, validateCommandForPlanMode } from "./command-filter";
