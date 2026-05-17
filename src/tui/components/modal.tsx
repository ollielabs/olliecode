/**
 * Reusable modal component.
 * Overlays content with horizontally centered dialog.
 */

import type { JSX } from 'solid-js';
import { createMemo, mergeProps } from 'solid-js';
import { useTerminalDimensions } from '@opentui/solid';
import { RGBA } from '@opentui/core';
import { useTheme } from '../../design';
import { FocusLayer, useFocusLayer, useScopedKeyboard } from '../keyboard';

export type ModalProps = {
  title: string;
  children: JSX.Element;
  onClose: () => void;
  size?: 'small' | 'medium' | 'large';
};

export function Modal(rawProps: ModalProps) {
  const props = mergeProps({ size: 'medium' as const }, rawProps);
  const { tokens } = useTheme();
  const dimensions = useTerminalDimensions();

  // Push "modal" layer — all children sharing this layer receive keys
  useFocusLayer(FocusLayer.MODAL);

  useScopedKeyboard(FocusLayer.MODAL, (key) => {
    if (key.name === 'escape' || key.name === 'q') {
      props.onClose();
    }
  });

  const modalWidth = createMemo(() =>
    props.size === 'large' ? 80 : props.size === 'small' ? 40 : 60,
  );
  const leftOffset = createMemo(() =>
    Math.max(0, Math.floor((dimensions().width - modalWidth()) / 2)),
  );
  const topOffset = createMemo(() => Math.floor(dimensions().height / 4));

  return (
    <>
      <box
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: dimensions().width,
          height: dimensions().height,
          zIndex: 100,
          backgroundColor: RGBA.fromInts(0, 0, 0, 200),
        }}
      />

      <box
        style={{
          position: 'absolute',
          left: leftOffset(),
          top: topOffset(),
          width: modalWidth(),
          maxWidth: dimensions().width - 2,
          maxHeight: Math.floor(dimensions().height / 2),
          backgroundColor: tokens.bgSurface,
          flexDirection: 'column',
          paddingY: 1,
          paddingX: 2,
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
            <b>{props.title}</b>
          </text>
          <text style={{ fg: tokens.textSubtle }}>esc</text>
        </box>

        <scrollbox flexGrow={1}>{props.children}</scrollbox>
      </box>
    </>
  );
}
