/**
 * Error message component.
 * Renders agent-level errors inline in the chat history
 * with distinct visual styling (red border, error icon).
 */

import { useTheme } from '../../design';

/** Human-readable labels for error types */
const ERROR_LABELS: Record<string, string> = {
  model_error: 'Model Error',
  max_iterations: 'Iteration Limit',
  loop_detected: 'Loop Detected',
  tool_error: 'Tool Error',
};

export type ErrorMessageProps = {
  errorType: string;
  content: string;
};

export function ErrorMessage(props: ErrorMessageProps) {
  const { tokens } = useTheme();
  const label = () => ERROR_LABELS[props.errorType] ?? props.errorType;

  return (
    <box flexDirection="column" marginY={1}>
      <box
        style={{
          border: ['left'],
          borderStyle: 'single',
          borderColor: tokens.error,
        }}
        paddingLeft={1}
        flexDirection="column"
      >
        <text style={{ fg: tokens.error }}>
          {'\u2717'} {label()}
        </text>
        <box marginTop={1}>
          <text style={{ fg: tokens.textMuted }}>{props.content}</text>
        </box>
      </box>
    </box>
  );
}
