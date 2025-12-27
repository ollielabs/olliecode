import type { TextareaRenderable } from "@opentui/core";
import type { AgentMode } from "../../agent/modes";
import { StatusBar, type Status } from "./status-bar";

const TEXTAREA_KEY_BINDINGS: { name: string; action: "submit" | "newline"; ctrl?: boolean }[] = [
  { name: "return", action: "submit" },
  { name: "j", ctrl: true, action: "newline" },
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
};

export function InputBox({ id, model, status, error, mode, textareaRef, statusRef, onSubmit, centered }: InputBoxProps) {
  const handleSubmit = () => {
    if (statusRef.current === "thinking") return;
    const text = textareaRef.current?.plainText?.trim();
    if (!text) return;
    onSubmit(text);
    textareaRef.current?.setText("");
  };

  return (
    <box
      border={["left"]}
      borderStyle="heavy"
      borderColor="#7aa2f7"
      backgroundColor="#333"
      padding={1}
      paddingLeft={2}
      paddingRight={2}
      {...(centered ? { marginTop: 2, width: 60 } : {})}
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