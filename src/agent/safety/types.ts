/**
 * Safety layer types for agentic tool execution.
 */

// Risk levels for tools
export type RiskLevel = 'safe' | 'prompt' | 'dangerous';

// Autonomy levels - how much the agent can do without confirmation
export type AutonomyLevel =
  | 'paranoid' // Confirm everything including reads
  | 'cautious' // Auto-approve reads, confirm all writes/commands
  | 'balanced' // Auto-approve reads + writes to new files, confirm edits + commands
  | 'autonomous'; // Auto-approve everything (dangerous)

// Result of a safety check
export type SafetyCheckResult =
  | { status: 'allowed' }
  | { status: 'denied'; reason: string }
  | { status: 'needs_confirmation'; request: ConfirmationRequest };

// Request for user confirmation
export type ConfirmationRequest = {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  riskLevel: RiskLevel;
  description: string; // Human-readable description of what will happen
  preview?: ConfirmationPreview;
};

// Preview content for confirmation UI
export type ConfirmationPreview =
  | { type: 'diff'; before: string; after: string; filePath: string } // For edit_file
  | { type: 'content'; content: string; truncated: boolean } // For write_file
  | { type: 'command'; command: string; cwd: string }; // For run_command

// User's response to confirmation
export type ConfirmationResponse =
  | { action: 'allow' }
  | { action: 'allow_always'; forTool?: string } // Don't ask again for this tool
  | { action: 'deny' }; // Deny and abort the agent run

// Audit log entry
export type AuditEntry = {
  timestamp: string;
  sessionId: string;
  tool: string;
  args: Record<string, unknown>; // May be redacted
  result: 'allowed' | 'denied' | 'confirmed' | 'rejected';
  reason?: string;
  durationMs?: number;
  output?: string; // Truncated
  error?: string;
};

// Configuration for safety layer
export type SafetyConfig = {
  projectRoot: string;
  autonomyLevel: AutonomyLevel;

  // Limits
  maxFileSizeBytes: number; // Default 100KB
  maxToolCallsPerTurn: number; // Default 20
  maxToolCallsPerSession: number; // Default 100

  // Per-tool overrides
  toolOverrides: Record<
    string,
    {
      autonomy?: 'always_allow' | 'always_confirm' | 'always_deny';
    }
  >;

  // Paths
  allowedPaths?: string[]; // If set, only these paths are allowed
  deniedPaths?: string[]; // Always denied (e.g., .env)

  // Commands
  allowedCommands?: string[]; // If set, only these commands are allowed
  deniedCommands?: string[]; // Always denied patterns
  allowNetworkCommands?: boolean; // Allow curl, wget, etc.

  // Audit
  auditLogPath?: string; // Default: .ollie/audit.jsonl
  enableAuditLog: boolean;
};

// Default configuration
export const DEFAULT_SAFETY_CONFIG: SafetyConfig = {
  projectRoot: process.cwd(),
  autonomyLevel: 'cautious',

  maxFileSizeBytes: 100 * 1024, // 100KB
  maxToolCallsPerTurn: 20,
  maxToolCallsPerSession: 100,

  toolOverrides: {},

  deniedPaths: [
    '.env',
    '.env.*',
    '*.pem',
    '*.key',
    'id_rsa',
    'id_ed25519',
    '*.p12',
    '*.pfx',
    'credentials.*',
    'secrets.*',
    '.git/config',
  ],

  deniedCommands: [
    'rm -rf /',
    'rm -rf /*',
    'sudo',
    'chmod 777',
    '> /dev/',
    'mkfs',
    'dd if=',
    ':(){:|:&};:', // Fork bomb
    'mv /* ',
    'cat /etc/passwd',
    'cat /etc/shadow',
  ],

  allowNetworkCommands: false,

  enableAuditLog: true,
  auditLogPath: '.ollie/audit.jsonl',
};

// Network-related commands that require explicit permission
export const NETWORK_COMMANDS = [
  'curl',
  'wget',
  'nc',
  'netcat',
  'scp',
  'rsync',
  'ssh',
  'ftp',
  'sftp',
  'telnet',
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

/**
 * Commands allowed in plan mode (read-only)
 * These commands are safe for exploration and don't modify state
 */
export const PLAN_MODE_ALLOWED_COMMANDS = [
  // File viewing
  'cat',
  'head',
  'tail',
  'less',
  'more',
  'file',
  'stat',
  'wc',
  // Directory listing
  'ls',
  'tree',
  'pwd',
  'find',
  'locate',
  // Search tools
  'grep',
  'rg',
  'ag',
  'fd',
  'ack',
  // Git read-only
  'git status',
  'git log',
  'git show',
  'git diff',
  'git branch',
  'git remote',
  'git tag',
  // Package managers (read-only) - JavaScript/Node
  'npm list',
  'npm outdated',
  'npm view',
  'npm info',
  'npm show',
  'npm ls',
  'bun pm ls',
  'yarn list',
  'yarn info',
  'yarn why',
  'pnpm list',
  'pnpm ls',
  'pnpm why',
  // Python
  'pip list',
  'pip show',
  'pip freeze',
  'pip check',
  'pipenv graph',
  'poetry show',
  'poetry env list',
  'conda list',
  'conda info',
  'conda env list',
  'uv pip list',
  'uv pip show',
  // Ruby
  'gem list',
  'gem info',
  'bundle list',
  'bundle show',
  // Rust
  'cargo tree',
  'cargo metadata',
  'cargo pkgid',
  'cargo search',
  // Go
  'go list',
  'go mod graph',
  'go mod why',
  'go version',
  // Java/JVM
  'mvn dependency:tree',
  'mvn dependency:list',
  'gradle dependencies',
  'gradle projects',
  // PHP
  'composer show',
  'composer info',
  // .NET
  'dotnet list',
  'dotnet --list-sdks',
  'dotnet --list-runtimes',
  'nuget list',
  // Elixir
  'mix deps',
  'mix hex.info',
  // Swift/iOS
  'swift package show-dependencies',
  'pod list',
  // System package managers
  'brew list',
  'brew info',
  'brew deps',
  'apt list',
  'dpkg -l',
  'rpm -qa',
  'pacman -Q',
  // System info
  'which',
  'whereis',
  'type',
  'env',
  'printenv',
  'echo',
  'date',
  'uname',
];

/**
 * Command patterns that are always denied in plan mode
 * These modify files, state, or system configuration
 */
export const PLAN_MODE_DENIED_PATTERNS = [
  // File modification
  'rm ',
  'mv ',
  'cp ',
  'mkdir ',
  'touch ',
  'chmod ',
  'chown ',
  'ln ',
  // File writing via redirect
  '>',
  '>>',
  'tee ',
  // Text manipulation that can write
  'sed -i',
  'sed --in-place',
  // Git write operations
  'git add',
  'git commit',
  'git push',
  'git pull',
  'git checkout',
  'git reset',
  'git revert',
  'git merge',
  'git rebase',
  'git stash',
  'git cherry-pick',
  'git branch -d',
  'git branch -D',
  'git tag -d',
  // Package managers (write)
  'npm install',
  'npm uninstall',
  'npm update',
  'npm ci',
  'bun add',
  'bun remove',
  'bun install',
  'yarn add',
  'yarn remove',
  'yarn install',
  'pnpm add',
  'pnpm remove',
  'pnpm install',
  // Build/run commands (can have side effects)
  'npm run',
  'bun run',
  'yarn run',
  'make ',
  'cargo build',
  'cargo run',
  'go build',
  'go run',
];
