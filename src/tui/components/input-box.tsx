import { RGBA, SyntaxStyle, type TextareaRenderable } from '@opentui/core';
import { createEffect } from 'solid-js';
import type { AgentMode } from '../../agent/modes';
import { useTheme } from '../../design';
import { type Status, StatusBar } from './status-bar';

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

/** Regex to find @mentions: @ at start or after whitespace, followed by non-whitespace */
const MENTION_RE = /(?:^|(?<=\s))@(\S+)/g;

/** Unique hlRef for mention highlights so we can clear them without affecting others */
const MENTION_HL_REF = 9999;

export function InputBox(props: InputBoxProps) {
  const { tokens } = useTheme();
  let textareaRef: TextareaRenderable | undefined;
  let mentionStyleId: number | null = null;

  /** Create a SyntaxStyle with a "mention" style and attach it to the textarea */
  const setupMentionStyle = (ref: TextareaRenderable) => {
    const style = SyntaxStyle.fromStyles({
      mention: {
        fg: RGBA.fromHex(tokens.textAccent),
        underline: true,
      },
    });
    ref.syntaxStyle = style;
    mentionStyleId = style.resolveStyleId('mention');
  };

  /** Scan text for @mentions and apply highlights */
  const updateMentionHighlights = () => {
    if (!textareaRef || mentionStyleId === null) return;

    // Clear previous mention highlights
    textareaRef.removeHighlightsByRef(MENTION_HL_REF);

    const text = textareaRef.plainText ?? '';
    MENTION_RE.lastIndex = 0;

    for (const match of text.matchAll(MENTION_RE)) {
      const start = match.index;
      const end = start + match[0].length;
      textareaRef.addHighlightByCharRange({
        start,
        end,
        styleId: mentionStyleId,
        hlRef: MENTION_HL_REF,
      });
    }
  };

  // Blur/focus textarea based on disabled state.
  // Also toggle focusable to prevent mouse clicks from re-focusing
  // the textarea while a confirmation dialog is active.
  createEffect(() => {
    if (!textareaRef) return;
    if (props.disabled) {
      textareaRef.focusable = false;
      textareaRef.blur();
    } else {
      textareaRef.focusable = true;
      textareaRef.focus();
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
          setupMentionStyle(el);
          props.onRef?.(el);
        }}
        maxHeight={2}
        wrapMode="word"
        keyBindings={TEXTAREA_KEY_BINDINGS}
        onSubmit={handleSubmit}
        onContentChange={updateMentionHighlights}
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
