/**
 * Tool message component.
 * Displays a unified tool operation that evolves through states:
 * pending -> confirming -> executing -> completed/error/denied/blocked
 *
 * This replaces the old separate tool_call + tool_result + ConfirmationDialog pattern.
 */

import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import { useTheme } from '../../design';
import type { SemanticTokens } from '../../design/tokens';
import { DiffView } from './diff-view';
import type { ToolDisplayMessage, ToolState, ToolMetadata } from '../types';
import type { ConfirmationResponse } from '../../agent/safety/types';

export type ToolMessageProps = {
  message: ToolDisplayMessage;
  /** Called when user responds to confirmation (only when state is "confirming") */
  onConfirmationResponse?: (response: ConfirmationResponse) => void;
  /** Whether this tool is currently awaiting confirmation input */
  isActiveConfirmation?: boolean;
  /** Whether to show expanded output for read-only tools (toggle with Ctrl+E) */
  expanded?: boolean;
  /** Whether a modal (command menu, session picker) is open — suppresses confirmation keys */
  isModalOpen?: () => boolean;
};

/** Read-only tools that support expand/collapse */
const EXPANDABLE_TOOLS = ['read_file', 'glob', 'grep', 'list_dir'];

/**
 * Format the tool header based on tool type and arguments.
 */
function formatToolHeader(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'read_file':
      return String(args.path ?? '');
    case 'write_file':
      return String(args.path ?? '');
    case 'edit_file':
      return String(args.path ?? '');
    case 'run_command': {
      const cmd = String(args.command ?? '');
      return `$ ${cmd.length > 50 ? `${cmd.slice(0, 50)}...` : cmd}`;
    }
    case 'glob':
      return `"${args.pattern}"`;
    case 'grep':
      return `"${args.pattern}" in ${args.include || '*'}`;
    case 'list_dir':
      return String(args.path ?? '.');
    case 'task':
      return String(args.description ?? '');
    case 'todo_write': {
      const todos = args.todos as Array<{ status: string }> | undefined;
      const pending =
        todos?.filter((t) => t.status !== 'completed').length ?? 0;
      return `${pending} active`;
    }
    case 'todo_read':
      return '';
    default:
      return '';
  }
}

/**
 * Get the status icon for a tool state.
 */
function getStatusIcon(state: ToolState): string {
  switch (state.status) {
    case 'pending':
    case 'executing':
      return '\u25D0'; // Half circle - in progress
    case 'confirming':
      return '\u25B3'; // Triangle - needs attention
    case 'completed':
      return '\u2713'; // Checkmark - success
    case 'error':
    case 'blocked':
      return '\u2717'; // X - failure
    case 'denied':
      return '\u2298'; // Circled slash - denied
  }
}

/**
 * Get the icon color for a tool state.
 */
function getStatusColor(
  state: ToolState,
  tokens: Record<string, string>,
): string {
  switch (state.status) {
    case 'pending':
    case 'executing':
      return tokens.warning ?? '#f59e0b';
    case 'confirming':
      return tokens.warning ?? '#f59e0b';
    case 'completed':
      return tokens.success ?? '#22c55e';
    case 'error':
    case 'blocked':
      return tokens.error ?? '#ef4444';
    case 'denied':
      return tokens.textMuted ?? '#6b7280';
    default:
      return tokens.textMuted ?? '#6b7280';
  }
}

/**
 * Format completed output for display.
 */
function formatCompletedOutput(
  name: string,
  output: string,
  metadata?: ToolMetadata,
): string {
  switch (name) {
    case 'read_file': {
      const lineCount = metadata?.lineCount ?? output.split('\n').length;
      return `${lineCount} lines`;
    }
    case 'glob': {
      const matchCount = metadata?.matchCount;
      if (matchCount !== undefined) return `${matchCount} files found`;
      try {
        const files = JSON.parse(output) as string[];
        return `${files.length} files found`;
      } catch {
        return output;
      }
    }
    case 'grep': {
      const matchCount = metadata?.matchCount;
      if (matchCount !== undefined) return `${matchCount} matches`;
      try {
        const result = JSON.parse(output) as { matches?: unknown[] };
        return `${result.matches?.length ?? 0} matches`;
      } catch {
        return output;
      }
    }
    case 'run_command': {
      try {
        const result = JSON.parse(output) as {
          exitCode: number;
          stdout: string;
        };
        const exitCode = metadata?.exitCode ?? result.exitCode;
        const stdoutLines = result.stdout.split('\n').length;
        return `Exit ${exitCode}${stdoutLines > 1 ? ` (${stdoutLines} lines)` : ''}`;
      } catch {
        return output;
      }
    }
    case 'list_dir': {
      try {
        const result = JSON.parse(output) as { entries?: unknown[] };
        return `${result.entries?.length ?? 0} entries`;
      } catch {
        return output;
      }
    }
    case 'task': {
      try {
        const result = JSON.parse(output) as {
          success?: boolean;
          iterations?: number;
        };
        const status = result.success ? 'Completed' : 'Failed';
        const iterations = result.iterations
          ? ` in ${result.iterations} iterations`
          : '';
        return `${status}${iterations}`;
      } catch {
        return output;
      }
    }
    case 'write_file':
    case 'edit_file':
    case 'todo_write':
    case 'todo_read':
      // These have special rendering, don't show raw output summary
      return '';
    default: {
      // Truncate long output
      const lines = output.split('\n');
      if (lines.length > 3) {
        return `${lines.length} lines of output`;
      }
      return output.slice(0, 100);
    }
  }
}

/**
 * Inline tool display - single line for simple operations.
 */
function InlineTool(props: {
  icon: string;
  iconColor: string;
  name: string;
  header: string;
  suffix?: string;
  /** When true, dims the text to indicate denied/blocked state */
  dimmed?: boolean;
  tokens: SemanticTokens;
}) {
  // Use muted color for dimmed (denied/blocked) items
  const textColor = props.dimmed
    ? props.tokens.textMuted
    : props.tokens.primaryBase;
  const headerColor = props.tokens.textMuted;

  return (
    <box
      style={{
        backgroundColor: props.tokens.bgSurface,
        padding: 1,
        border: ['left'],
        borderStyle: 'heavy',
        borderColor: props.iconColor,
      }}
    >
      <box style={{ flexDirection: 'row' }}>
        <text style={{ fg: props.iconColor }}>{props.icon} </text>
        <text style={{ fg: textColor }}>{props.name}</text>
        <Show when={props.header}>
          <text style={{ fg: headerColor }}> {props.header}</text>
        </Show>
        <Show when={props.suffix}>
          <text style={{ fg: props.tokens.textMuted }}> {props.suffix}</text>
        </Show>
      </box>
    </box>
  );
}

/**
 * Block tool display - multi-line with content area.
 */
function BlockTool(props: {
  icon: string;
  iconColor: string;
  name: string;
  header: string;
  children: JSX.Element;
  tokens: SemanticTokens;
}) {
  return (
    <box
      style={{
        backgroundColor: props.tokens.bgSurface,
        padding: 1,
        border: ['left'],
        borderStyle: 'heavy',
        borderColor: props.iconColor,
      }}
    >
      <box style={{ flexDirection: 'row' }}>
        <text style={{ fg: props.iconColor }}>{props.icon} </text>
        <text style={{ fg: props.tokens.primaryBase }}>{props.name}</text>
        <Show when={props.header}>
          <text style={{ fg: props.tokens.textMuted }}> {props.header}</text>
        </Show>
      </box>
      <box style={{ marginTop: 1 }}>{props.children}</box>
    </box>
  );
}

/**
 * Confirmation view - shows preview and action buttons.
 */
function ConfirmingView(props: {
  message: ToolDisplayMessage;
  onResponse?: (response: ConfirmationResponse) => void;
  isActive?: boolean;
  isModalOpen?: () => boolean;
  tokens: SemanticTokens;
}) {
  let responded = false;

  useKeyboard((key: { name?: string }) => {
    if (props.message.state.status !== 'confirming') return;
    if (!props.isActive || responded || !props.onResponse) return;
    if (props.isModalOpen?.()) return;

    switch (key.name?.toLowerCase()) {
      case 'y':
        responded = true;
        props.onResponse({ action: 'allow' });
        break;
      case 'n':
      case 'escape':
      case 'q':
        responded = true;
        props.onResponse({ action: 'deny' });
        break;
      case 'a':
        responded = true;
        props.onResponse({
          action: 'allow_always',
          forTool: props.message.name,
        });
        break;
    }
  });

  if (props.message.state.status !== 'confirming') return <></>;

  const preview = props.message.state.preview;
  const header = formatToolHeader(props.message.name, props.message.args);

  return (
    <box
      style={{
        backgroundColor: props.tokens.bgSurface,
        padding: 1,
        border: ['left'],
        borderStyle: 'heavy',
        borderColor: props.tokens.warning,
      }}
    >
      {/* Header */}
      <box style={{ flexDirection: 'row' }}>
        <text style={{ fg: props.tokens.warning }}>{'\u25B3'} </text>
        <text style={{ fg: props.tokens.primaryBase }}>
          {props.message.name}
        </text>
        <Show when={header}>
          <text style={{ fg: props.tokens.textMuted }}> {header}</text>
        </Show>
      </box>

      {/* Preview content */}
      <Show when={preview}>
        {(p: () => NonNullable<typeof preview>) => (
          <box style={{ marginTop: 1 }}>
            <Show when={p().type === 'command'}>
              <box
                style={{
                  backgroundColor: props.tokens.bgBase,
                  padding: 1,
                  border: ['left'],
                  borderStyle: 'single',
                  borderColor: props.tokens.borderMuted,
                }}
              >
                <text style={{ fg: props.tokens.success }}>
                  $ {(p() as { type: 'command'; command: string }).command}
                </text>
                <text style={{ fg: props.tokens.textMuted, marginTop: 1 }}>
                  cwd: {(p() as { type: 'command'; cwd: string }).cwd}
                </text>
              </box>
            </Show>

            <Show when={p().type === 'content'}>
              <box
                style={{
                  backgroundColor: props.tokens.bgBase,
                  padding: 1,
                  border: ['left'],
                  borderStyle: 'single',
                  borderColor: props.tokens.borderMuted,
                }}
              >
                <text style={{ fg: props.tokens.textBase }}>
                  {
                    (
                      p() as {
                        type: 'content';
                        content: string;
                        truncated?: boolean;
                      }
                    ).content
                  }
                  {(p() as { type: 'content'; truncated?: boolean })
                    .truncated && '\n[truncated...]'}
                </text>
              </box>
            </Show>

            <Show when={p().type === 'diff'}>
              <DiffView
                filePath={(p() as { type: 'diff'; filePath: string }).filePath}
                before={(p() as { type: 'diff'; before: string }).before}
                after={(p() as { type: 'diff'; after: string }).after}
                maxHeight={15}
                view="split"
              />
            </Show>
          </box>
        )}
      </Show>

      {/* Action buttons */}
      <box style={{ flexDirection: 'row', marginTop: 1 }}>
        <text>
          <span style={{ fg: props.tokens.textMuted }}>[</span>
          <u style={{ fg: props.tokens.success }}>Y</u>
          <span style={{ fg: props.tokens.textMuted }}>]es [</span>
          <u style={{ fg: props.tokens.error }}>N</u>
          <span style={{ fg: props.tokens.textMuted }}>/Esc]o [</span>
          <u style={{ fg: props.tokens.primaryBase }}>A</u>
          <span style={{ fg: props.tokens.textMuted }}>]lways</span>
        </text>
      </box>
    </box>
  );
}

/**
 * Completed view for edit_file - shows persistent diff.
 */
function EditCompleted(props: {
  message: ToolDisplayMessage;
  tokens: SemanticTokens;
}) {
  if (props.message.state.status !== 'completed') return <></>;

  const filePath =
    props.message.state.metadata?.filePath ??
    String(props.message.args.path ?? '');
  const diff = props.message.state.metadata?.diff;

  // If we have a stored diff from confirmation, use it
  // Otherwise, try to construct from args (for backward compatibility)
  const hasDiff =
    diff || (props.message.args.oldString && props.message.args.newString);

  return (
    <BlockTool
      icon={'\u2713'}
      iconColor={props.tokens.success}
      name={props.message.name}
      header={filePath}
      tokens={props.tokens}
    >
      <Show
        when={hasDiff}
        fallback={
          <text style={{ fg: props.tokens.textMuted }}>
            {props.message.state.output}
          </text>
        }
      >
        <DiffView
          filePath={filePath}
          before={diff ? '' : String(props.message.args.oldString ?? '')}
          after={diff ? '' : String(props.message.args.newString ?? '')}
          diff={diff}
          view="split"
        />
      </Show>
    </BlockTool>
  );
}

/**
 * Completed view for write_file - shows content or diff for new files.
 */
function WriteCompleted(props: {
  message: ToolDisplayMessage;
  tokens: SemanticTokens;
}) {
  if (props.message.state.status !== 'completed') return <></>;

  const filePath =
    props.message.state.metadata?.filePath ??
    String(props.message.args.path ?? '');
  const isNewFile = props.message.state.metadata?.isNewFile ?? true;
  const content = String(props.message.args.content ?? '');

  return (
    <BlockTool
      icon={'\u2713'}
      iconColor={props.tokens.success}
      name={props.message.name}
      header={filePath}
      tokens={props.tokens}
    >
      <Show
        when={isNewFile}
        fallback={
          <text style={{ fg: props.tokens.textMuted }}>
            {props.message.state.output}
          </text>
        }
      >
        {/* New file: show unified diff (all additions) */}
        <DiffView
          filePath={filePath}
          before=""
          after={content}
          view="unified"
        />
      </Show>
    </BlockTool>
  );
}

/**
 * Completed view for run_command - shows output.
 */
function CommandCompleted(props: {
  message: ToolDisplayMessage;
  tokens: SemanticTokens;
}) {
  if (props.message.state.status !== 'completed') return <></>;

  const description = String(props.message.args.description ?? 'Shell');
  const command = String(props.message.args.command ?? '');

  let stdout = '';
  let stderr = '';
  let exitCode = props.message.state.metadata?.exitCode ?? 0;

  try {
    const result = JSON.parse(props.message.state.output) as {
      exitCode: number;
      stdout: string;
      stderr: string;
    };
    stdout = result.stdout;
    stderr = result.stderr;
    exitCode = result.exitCode;
  } catch {
    stdout = props.message.state.output;
  }

  const output = stdout || stderr;
  const icon = exitCode === 0 ? '\u2713' : '\u2717';
  const iconColor = exitCode === 0 ? props.tokens.success : props.tokens.error;

  return (
    <BlockTool
      icon={icon}
      iconColor={iconColor}
      name={`# ${description}`}
      header=""
      tokens={props.tokens}
    >
      <text style={{ fg: props.tokens.textBase }}>$ {command}</text>
      <Show when={output}>
        <box style={{ marginTop: 1 }}>
          <text style={{ fg: props.tokens.textBase }}>{output}</text>
        </box>
      </Show>
    </BlockTool>
  );
}

/**
 * Completed tool view for read-only/expandable tools.
 * Extracted so that props.expanded is reactive inside <Show>.
 */
function ExpandableTool(props: {
  message: ToolDisplayMessage;
  expanded?: boolean;
  tokens: SemanticTokens;
}) {
  if (props.message.state.status !== 'completed') return <></>;

  const icon = getStatusIcon(props.message.state);
  const iconColor = getStatusColor(props.message.state, props.tokens);
  const header = formatToolHeader(props.message.name, props.message.args);
  const isExpandable = EXPANDABLE_TOOLS.includes(props.message.name);

  const outputSummary = formatCompletedOutput(
    props.message.name,
    props.message.state.output,
    props.message.state.metadata,
  );

  return (
    <Show
      when={
        props.expanded &&
        isExpandable &&
        props.message.state.status === 'completed' &&
        props.message.state.output
      }
      fallback={
        <InlineTool
          icon={icon}
          iconColor={iconColor}
          name={props.message.name}
          header={header}
          suffix={
            outputSummary
              ? `(${outputSummary})${isExpandable ? ' [ctrl+e to expand]' : ''}`
              : isExpandable
                ? '[ctrl+e to expand]'
                : undefined
          }
          tokens={props.tokens}
        />
      }
    >
      <BlockTool
        icon={icon}
        iconColor={iconColor}
        name={props.message.name}
        header={header}
        tokens={props.tokens}
      >
        <text style={{ fg: props.tokens.textBase }}>
          {props.message.state.status === 'completed'
            ? props.message.state.output
            : ''}
        </text>
      </BlockTool>
    </Show>
  );
}

/**
 * Main ToolMessage component.
 */
export function ToolMessage(props: ToolMessageProps) {
  const { tokens } = useTheme();

  const icon = getStatusIcon(props.message.state);
  const iconColor = getStatusColor(props.message.state, tokens);
  const header = formatToolHeader(props.message.name, props.message.args);

  // State-based rendering
  // NOTE: The switch runs once per ToolMessage creation. This is fine because
  // displayMessages is a signal — when a tool's state changes, the signal
  // updates and <For> recreates the component with the new state.
  // The exception is `expanded` which changes independently via Ctrl+E,
  // so the expand/collapse uses <Show> inside ExpandableTool for reactivity.
  switch (props.message.state.status) {
    case 'pending':
    case 'executing':
      return (
        <InlineTool
          icon={icon}
          iconColor={iconColor}
          name={props.message.name}
          header={header}
          suffix={
            props.message.state.status === 'executing' ? '(running...)' : ''
          }
          tokens={tokens}
        />
      );

    case 'confirming':
      return (
        <ConfirmingView
          message={props.message}
          onResponse={props.onConfirmationResponse}
          isActive={props.isActiveConfirmation}
          isModalOpen={props.isModalOpen}
          tokens={tokens}
        />
      );

    case 'completed': {
      // Tool-specific completed views (write tools - always show full output)
      if (props.message.name === 'edit_file') {
        return <EditCompleted message={props.message} tokens={tokens} />;
      }
      if (props.message.name === 'write_file') {
        return <WriteCompleted message={props.message} tokens={tokens} />;
      }
      if (props.message.name === 'run_command') {
        return <CommandCompleted message={props.message} tokens={tokens} />;
      }

      // Read-only tools: support expand/collapse via reactive <Show>
      return (
        <ExpandableTool
          message={props.message}
          expanded={props.expanded}
          tokens={tokens}
        />
      );
    }

    case 'error':
      return (
        <BlockTool
          icon={icon}
          iconColor={iconColor}
          name={props.message.name}
          header={header}
          tokens={tokens}
        >
          <text style={{ fg: tokens.error }}>{props.message.state.error}</text>
        </BlockTool>
      );

    case 'denied':
      return (
        <InlineTool
          icon={icon}
          iconColor={iconColor}
          name={props.message.name}
          header={header}
          suffix={
            props.message.state.reason
              ? `(denied: ${props.message.state.reason})`
              : '(denied)'
          }
          dimmed
          tokens={tokens}
        />
      );

    case 'blocked':
      return (
        <InlineTool
          icon={icon}
          iconColor={iconColor}
          name={props.message.name}
          header={header}
          suffix={`(blocked: ${props.message.state.reason})`}
          dimmed
          tokens={tokens}
        />
      );
  }
}
