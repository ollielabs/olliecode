/**
 * Reusable modal component.
 * Overlays content with horizontally centered dialog.
 */

import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { RGBA } from '@opentui/core';
import { useTheme } from '../../design';

export type ModalProps = {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  size?: 'small' | 'medium' | 'large';
};

export function Modal({
  title,
  children,
  onClose,
  size = 'medium',
}: ModalProps) {
  const { tokens } = useTheme();
  const { width: termWidth, height: termHeight } = useTerminalDimensions();

  useKeyboard((key: { name?: string }) => {
    if (key.name === 'escape' || key.name === 'q') {
      onClose();
    }
  });

  const modalWidth = size === 'large' ? 80 : size === 'small' ? 40 : 60;
  const leftOffset = Math.max(0, Math.floor((termWidth - modalWidth) / 2));
  const topOffset = Math.floor(termHeight / 4);

  return (
    <>
      <box
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: termWidth,
          height: termHeight,
          zIndex: 100,
          backgroundColor: RGBA.fromInts(0, 0, 0, 200),
        }}
      />

      <box
        style={{
          position: 'absolute',
          left: leftOffset,
          top: topOffset,
          width: modalWidth,
          maxWidth: termWidth - 2,
          backgroundColor: tokens.bgSurface,
          flexDirection: 'column',
          paddingTop: 1,
          paddingBottom: 1,
          paddingLeft: 2,
          paddingRight: 2,
          zIndex: 101,
        }}
      >
        <box
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            marginBottom: 1,
          }}
        >
          <text style={{ fg: tokens.textBase }}>
            <b>{title}</b>
          </text>
          <text style={{ fg: tokens.textSubtle }}>esc</text>
        </box>

        {children}
      </box>
    </>
  );
}
