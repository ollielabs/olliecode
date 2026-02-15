/**
 * Toast notification component.
 * Displays a brief message in the top-right corner that auto-dismisses.
 */

import { onCleanup, onMount } from 'solid-js';
import { useTheme } from '../../design';
import { TOAST_DURATION_MS } from '../constants';

export type ToastNotificationProps = {
  /** The message to display */
  message: string;
  /** Duration in milliseconds before auto-dismiss (default: TOAST_DURATION_MS) */
  duration?: number;
  /** Callback when toast should be dismissed */
  onDismiss: () => void;
};

export function ToastNotification(props: ToastNotificationProps) {
  const { tokens } = useTheme();

  onMount(() => {
    const timer = setTimeout(
      props.onDismiss,
      props.duration ?? TOAST_DURATION_MS,
    );
    onCleanup(() => clearTimeout(timer));
  });

  return (
    <box
      style={{
        position: 'absolute',
        top: 1,
        right: 2,
        backgroundColor: tokens.bgSurface,
        border: ['left', 'right'],
        borderStyle: 'single',
        borderColor: tokens.success,
        padding: 1,
        paddingLeft: 2,
        paddingRight: 2,
        zIndex: 100,
      }}
    >
      <text style={{ fg: tokens.textBase }}>{props.message}</text>
    </box>
  );
}
