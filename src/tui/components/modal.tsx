/**
 * Reusable modal component.
 * Uses RGBA backdrop with alpha transparency (like OpenCode).
 * Overlays content with horizontally centered dialog, scrollable content area.
 */

import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { RGBA } from "@opentui/core";


export type ModalProps = {
  /** Modal title displayed in top-left */
  title: string;
  /** Content to render inside the modal */
  children: React.ReactNode;
  /** Called when modal should close (Esc pressed) */
  onClose: () => void;
  /** Width of modal (default: 60, "large" = 80) */
  size?: "medium" | "large";
};

export function Modal({
  title,
  children,
  onClose,
  size = "medium",
}: ModalProps) {
  const { width: termWidth, height: termHeight } = useTerminalDimensions();

  // Handle escape to close
  const handleKeyPress = (key: { name?: string }) => {
    if (key.name === "escape" || key.name === "q") {
      onClose();
    }
  };

  useKeyboard(handleKeyPress);

  // Width based on size prop (matching OpenCode's pattern)
  const modalWidth = size === "large" ? 80 : 60;

  return (
    // Full-screen backdrop with semi-transparent black (alpha = 150/255 ≈ 59%)
    <box
      position="absolute"
      left={0}
      top={0}
      width={termWidth}
      height={termHeight}
      alignItems="center"
      paddingTop={Math.floor(termHeight / 4)}
      backgroundColor={RGBA.fromInts(0, 0, 0, 150)}
      zIndex={100}
    >
      {/* Centered modal dialog - no height constraint, content controls its own height */}
      <box
        width={modalWidth}
        maxWidth={termWidth - 2}
        backgroundColor="#1a1a2e"
        flexDirection="column"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
      >
        {/* Header */}
        <box flexDirection="row" justifyContent="space-between" marginBottom={1}>
          <text fg="#ffffff"><b>{title}</b></text>
          <text fg="#666">esc</text>
        </box>

        {/* Content - rendered directly, no wrapper scrollbox */}
        {children}
      </box>
    </box>
  );
}
