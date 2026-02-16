import { createEffect } from 'solid-js';
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
  getTextareaRef: () => TextareaRenderable | undefined;
  getStatus: () => Status;
  onSubmit: (text: string) => void;
  /** Callback to forward the textarea ref to the parent */
  onRef?: (el: TextareaRenderable) => void;
  centered?: boolean;
  /** When true, blurs textarea to prevent key capture (e.g., during confirmation dialogs) */
  disabled?: boolean;
  /** When true, prevents submit on Enter (e.g., when file picker is open) */
  suppressSubmit?: boolean;
};

export function InputBox(props: InputBoxProps) {
  const { tokens } = useTheme();
  let textareaRef: TextareaRenderable | undefined;

  // Blur/focus textarea based on disabled state
  createEffect(() => {
    if (props.disabled) {
      textareaRef?.blur();
    } else {
      textareaRef?.focus();
    }
  });

  const handleSubmit = () => {
    if (props.suppressSubmit) return;
    if (props.getStatus() === 'thinking') return;
    const text = textareaRef?.plainText?.trim();
    if (!text) return;
    props.onSubmit(text);
    textareaRef?.setText('');
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
        ...(props.centered && { marginTop: 2, width: 60 }),
      }}
    >
      <textarea
        id={props.id}
        focused={!props.disabled}
        ref={(el) => {
          textareaRef = el;
          props.onRef?.(el);
        }}
        maxHeight={2}
        wrapMode="word"
        keyBindings={TEXTAREA_KEY_BINDINGS}
        onSubmit={handleSubmit}
      />
      <StatusBar
        model={props.model}
        status={props.status}
        error={props.error}
        mode={props.mode}
      />
    </box>
  );
}
