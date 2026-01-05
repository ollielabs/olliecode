import { useEffect, useRef } from 'react';
import type { TextareaRenderable } from '@opentui/core';
import type { AgentMode } from '../../agent/modes';
import { useTheme } from '../../design';
import { StatusBar, type Status } from './status-bar';

const TEXTAREA_KEY_BINDINGS: {
  name: string;
  action: 'submit' | 'newline';
  ctrl?: boolean;
}[] = [
  { name: 'return', action: 'submit' },
  { name: 'j', ctrl: true, action: 'newline' },
];

export type InputBoxProps = {
  id: string;
  model: string;
  status: Status;
  error: string;
  mode: AgentMode;
  textareaRef: React.RefObject<TextareaRenderable | null>;
  statusRef: React.RefObject<Status>;
  onSubmit: (text: string) => void;
  centered?: boolean;
  /** When true, blurs textarea to prevent key capture (e.g., during confirmation dialogs) */
  disabled?: boolean;
  /** When true, prevents submit on Enter (e.g., when file picker is open) */
  suppressSubmit?: boolean;
};

export function InputBox({
  id,
  model,
  status,
  error,
  mode,
  textareaRef,
  statusRef,
  onSubmit,
  centered,
  disabled,
  suppressSubmit,
}: InputBoxProps) {
  const { tokens } = useTheme();

  // Use ref for suppressSubmit to get current value at call time
  const suppressSubmitRef = useRef(suppressSubmit);
  suppressSubmitRef.current = suppressSubmit;

  // Blur/focus textarea based on disabled state
  useEffect(() => {
    if (disabled) {
      textareaRef.current?.blur();
    } else {
      textareaRef.current?.focus();
    }
  }, [disabled, textareaRef]);

  const handleSubmit = () => {
    if (suppressSubmitRef.current) return;
    if (statusRef.current === 'thinking') return;
    const text = textareaRef.current?.plainText?.trim();
    if (!text) return;
    onSubmit(text);
    textareaRef.current?.setText('');
  };

  return (
    <box
      style={{
        border: ['left'],
        borderStyle: 'heavy',
        borderColor: tokens.borderAccent,
        backgroundColor: tokens.bgInput,
        padding: 1,
        paddingLeft: 2,
        paddingRight: 2,
        ...(centered && { marginTop: 2, width: 60 }),
      }}
    >
      <textarea
        id={id}
        focused
        ref={textareaRef}
        maxHeight={2}
        wrapMode="word"
        keyBindings={TEXTAREA_KEY_BINDINGS}
        onSubmit={handleSubmit}
      />
      <StatusBar model={model} status={status} error={error} mode={mode} />
    </box>
  );
}
