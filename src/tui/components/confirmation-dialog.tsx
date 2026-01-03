/**
 * Confirmation dialog for risky tool operations.
 * Shows what the tool will do and allows user to approve/deny.
 */

import { useRef, useEffect } from "react";
import { useKeyboard } from "@opentui/react";
import type { ConfirmationRequest, ConfirmationResponse } from "../../agent/types";
import { useTheme } from "../../design";
import { DiffView } from "./diff-view";

export type ConfirmationDialogProps = {
  request: ConfirmationRequest;
  onResponse: (response: ConfirmationResponse) => void;
};

export function ConfirmationDialog({ request, onResponse }: ConfirmationDialogProps) {
  const { tokens } = useTheme();

  const requestRef = useRef(request);
  const onResponseRef = useRef(onResponse);
  const respondedRef = useRef(false);

  useEffect(() => {
    requestRef.current = request;
    onResponseRef.current = onResponse;
    // Reset responded flag when request changes
    respondedRef.current = false;
  }, [request, onResponse]);

  useKeyboard((key: { name?: string }) => {
    // Prevent double-responses
    if (respondedRef.current) return;
    
    const currentRequest = requestRef.current;
    const currentOnResponse = onResponseRef.current;

    switch (key.name?.toLowerCase()) {
      case "y":
        respondedRef.current = true;
        currentOnResponse({ action: "allow" });
        break;
      case "n":
      case "escape":
      case "q":
        respondedRef.current = true;
        currentOnResponse({ action: "deny" });
        break;
      case "a":
        respondedRef.current = true;
        currentOnResponse({ action: "allow_always", forTool: currentRequest.tool });
        break;
    }
  });

  const riskColors: Record<string, string> = {
    dangerous: tokens.error,
    risky: tokens.warning,
    safe: tokens.success,
    prompt: tokens.warning,
  };
  const riskColor = riskColors[request.riskLevel] ?? tokens.warning;

  return (
    <box
      style={{
        flexDirection: "column",
        border: ["left", "right"],
        borderStyle: "heavy",
        backgroundColor: tokens.bgSurface,
        padding: 1,
        marginTop: 1,
        marginBottom: 1,
      }}
      borderColor={riskColor}
    >
      {/* Action description as header */}
      <box style={{ marginBottom: 1 }}>
        <text>{request.description}</text>
      </box>

      {/* Preview content */}
      {request.preview && (
        <box
          style={{
            flexDirection: "column",
            marginBottom: 1,
          }}
        >
          {request.preview.type === "command" && (
            <box
              style={{
                backgroundColor: tokens.bgBase,
                padding: 1,
                border: ["left"],
                borderStyle: "single",
                borderColor: tokens.borderMuted,
              }}
            >
              <text style={{ fg: tokens.success }}>$ {request.preview.command}</text>
              <text style={{ fg: tokens.textMuted, marginTop: 1 }}>
                cwd: {request.preview.cwd}
              </text>
            </box>
          )}

          {request.preview.type === "content" && (
            <box
              style={{
                backgroundColor: tokens.bgBase,
                padding: 1,
                border: ["left"],
                borderStyle: "single",
                borderColor: tokens.borderMuted,
              }}
            >
              <text style={{ fg: tokens.textBase }}>
                {request.preview.content}
                {request.preview.truncated && "\n[truncated...]"}
              </text>
            </box>
          )}

          {request.preview.type === "diff" && (
            <DiffView
              filePath={request.preview.filePath}
              before={request.preview.before}
              after={request.preview.after}
              maxHeight={15}
              view="split"
            />
          )}
        </box>
      )}

      {/* Confirmation options */}
      <box style={{ flexDirection: "row" }}>
        <text>
          <span style={{ fg: tokens.textMuted }}>[</span>
          <u style={{ fg: tokens.success }}>Y</u>
          <span style={{ fg: tokens.textMuted }}>]es  [</span>
          <u style={{ fg: tokens.error }}>N</u>
          <span style={{ fg: tokens.textMuted }}>/Esc]o  [</span>
          <u style={{ fg: tokens.primaryBase }}>A</u>
          <span style={{ fg: tokens.textMuted }}>]lways</span>
        </text>
      </box>
    </box>
  );
}
