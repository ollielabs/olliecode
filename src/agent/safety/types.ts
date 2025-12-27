/**
 * Safety layer types for agentic tool execution.
 */



// Risk levels for tools
export type RiskLevel = "safe" | "prompt" | "dangerous";

// Autonomy levels - how much the agent can do without confirmation
export type AutonomyLevel = 
  | "paranoid"    // Confirm everything including reads
  | "cautious"    // Auto-approve reads, confirm all writes/commands
  | "balanced"    // Auto-approve reads + writes to new files, confirm edits + commands  
  | "autonomous"; // Auto-approve everything (dangerous)

// Result of a safety check
export type SafetyCheckResult = 
  | { status: "allowed" }
  | { status: "denied"; reason: string }
  | { status: "needs_confirmation"; request: ConfirmationRequest };

// Request for user confirmation
export type ConfirmationRequest = {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  riskLevel: RiskLevel;
  description: string;        // Human-readable description of what will happen
  preview?: ConfirmationPreview;
};

// Preview content for confirmation UI
export type ConfirmationPreview = 
  | { type: "diff"; before: string; after: string }      // For edit_file
  | { type: "content"; content: string; truncated: boolean }  // For write_file
  | { type: "command"; command: string; cwd: string };   // For run_command

// User's response to confirmation
export type ConfirmationResponse = 
  | { action: "allow" }
  | { action: "allow_always"; forTool?: string }  // Don't ask again for this tool
  | { action: "deny" }
  | { action: "deny_always"; forTool?: string };  // Always deny this tool

// Audit log entry
export type AuditEntry = {
  timestamp: string;
  sessionId: string;
  tool: string;
  args: Record<string, unknown>;  // May be redacted
  result: "allowed" | "denied" | "confirmed" | "rejected";
  reason?: string;
  durationMs?: number;
  output?: string;  // Truncated
  error?: string;
};

// Configuration for safety layer
export type SafetyConfig = {
  projectRoot: string;
  autonomyLevel: AutonomyLevel;
  
  // Limits
  maxFileSizeBytes: number;        // Default 100KB
  maxToolCallsPerTurn: number;     // Default 20
  maxToolCallsPerSession: number;  // Default 100
  
  // Per-tool overrides
  toolOverrides: Record<string, {
    autonomy?: "always_allow" | "always_confirm" | "always_deny";
  }>;
  
  // Paths
  allowedPaths?: string[];   // If set, only these paths are allowed
  deniedPaths?: string[];    // Always denied (e.g., .env)
  
  // Commands
  allowedCommands?: string[];  // If set, only these commands are allowed
  deniedCommands?: string[];   // Always denied patterns
  allowNetworkCommands?: boolean;  // Allow curl, wget, etc.
  
  // Audit
  auditLogPath?: string;  // Default: .olly/audit.jsonl
  enableAuditLog: boolean;
};

// Default configuration
export const DEFAULT_SAFETY_CONFIG: SafetyConfig = {
  projectRoot: process.cwd(),
  autonomyLevel: "cautious",
  
  maxFileSizeBytes: 100 * 1024,  // 100KB
  maxToolCallsPerTurn: 20,
  maxToolCallsPerSession: 100,
  
  toolOverrides: {},
  
  deniedPaths: [
    ".env",
    ".env.*",
    "*.pem",
    "*.key", 
    "id_rsa",
    "id_ed25519",
    "*.p12",
    "*.pfx",
    "credentials.*",
    "secrets.*",
    ".git/config",
  ],
  
  deniedCommands: [
    "rm -rf /",
    "rm -rf /*",
    "sudo",
    "chmod 777",
    "> /dev/",
    "mkfs",
    "dd if=",
    ":(){:|:&};:",  // Fork bomb
    "mv /* ",
    "cat /etc/passwd",
    "cat /etc/shadow",
  ],
  
  allowNetworkCommands: false,
  
  enableAuditLog: true,
  auditLogPath: ".olly/audit.jsonl",
};

// Network-related commands that require explicit permission
export const NETWORK_COMMANDS = [
  "curl",
  "wget", 
  "nc",
  "netcat",
  "scp",
  "rsync",
  "ssh",
  "ftp",
  "sftp",
  "telnet",
];

// Environment variable patterns to strip from subprocess
export const SENSITIVE_ENV_PATTERNS = [
  /_KEY$/,
  /_SECRET$/,
  /_TOKEN$/,
  /_PASSWORD$/,
  /_CREDENTIALS$/,
  /^AWS_/,
  /^GITHUB_TOKEN$/,
  /^GH_TOKEN$/,
  /^OPENAI_API_KEY$/,
  /^ANTHROPIC_API_KEY$/,
  /^DATABASE_URL$/,
];
