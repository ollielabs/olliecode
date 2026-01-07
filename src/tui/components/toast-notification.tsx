/**
 * Toast notification component.
 * Displays a brief message in the top-right corner that auto-dismisses.
 */

import { useEffect } from "react";
import { useTheme } from "../../design";
import { TOAST_DURATION_MS } from "../constants";

export type ToastNotificationProps = {
  /** The message to display */
  message: string;
  /** Duration in milliseconds before auto-dismiss (default: TOAST_DURATION_MS) */
  duration?: number;
  /** Callback when toast should be dismissed */
  onDismiss: () => void;
};

export function ToastNotification({
  message,
  duration = TOAST_DURATION_MS,
  onDismiss,
}: ToastNotificationProps) {
  const { tokens } = useTheme();

  useEffect(() => {
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [duration, onDismiss]);

  return (
    <box
      style={{
        position: "absolute",
        top: 1,
        right: 2,
        backgroundColor: tokens.bgSurface,
        border: ["left", "right"],
        borderStyle: "single",
        borderColor: tokens.success,
        padding: 1,
        paddingLeft: 2,
        paddingRight: 2,
        zIndex: 100,
      }}
    >
      <text style={{ fg: tokens.textBase }}>{message}</text>
    </box>
  );
}
