/**
 * Context info notification component.
 * Displays temporary status messages about context operations.
 */

import { useTheme } from '../../design';

export type ContextInfoNotificationProps = {
  message: string;
};

export function ContextInfoNotification({
  message,
}: ContextInfoNotificationProps) {
  const { tokens } = useTheme();

  return (
    <box style={{ paddingLeft: 1 }}>
      <text style={{ fg: tokens.textMuted }}>{message}</text>
    </box>
  );
}
