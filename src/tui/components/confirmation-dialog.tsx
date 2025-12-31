/**
 * Confirmation dialog for risky tool operations.
 * Shows what the tool will do and allows user to approve/deny.
 */

import { useRef, useEffect } from "react";
import { useKeyboard } from "@opentui/react";
import type { ConfirmationRequest, ConfirmationResponse } from "../../agent/types";
import { useTheme } from "../../design";

export type ConfirmationDialogProps = {
  request: ConfirmationRequest;
  onResponse: (response: ConfirmationResponse) => void;
};

export function ConfirmationDialog({ request, onResponse }: ConfirmationDialogProps) {
  const { tokens } = useTheme();

  const requestRef = useRef(request);
  const onResponseRef = useRef(onResponse);

  useEffect(() => {
    requestRef.current = request;
    onResponseRef.current = onResponse;
  }, [request, onResponse]);

  useKeyboard((key: { name?: string }) => {
    const currentRequest = requestRef.current;
    const currentOnResponse = onResponseRef.current;

    switch (key.name?.toLowerCase()) {
      case "y":
        currentOnResponse({ action: "allow" });
        break;
      case "n":
      case "escape":
      case "q":
        currentOnResponse({ action: "deny" });
        break;
      case "a":
        currentOnResponse({ action: "allow_always", forTool: currentRequest.tool });
        break;
      case "d":
        currentOnResponse({ action: "deny_always", forTool: currentRequest.tool });
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
        border: ["top", "bottom", "left", "right"],
        borderStyle: "rounded",
        backgroundColor: tokens.bgSurface,
        padding: 1,
        marginTop: 1,
        marginBottom: 1,
      }}
      borderColor={riskColor}
    >
      <box style={{ marginBottom: 1 }}>
        <text style={{ fg: riskColor }}>Warning: Confirmation Required</text>
      </box>

      <box style={{ marginBottom: 1 }}>
        <text style={{ fg: tokens.textMuted }}>Tool: </text>
        <text style={{ fg: tokens.primaryBase }}>{request.tool}</text>
        <text style={{ fg: tokens.textMuted }}> ({request.riskLevel})</text>
      </box>

      <box style={{ marginBottom: 1 }}>
        <text>{request.description}</text>
      </box>

      {request.preview && (
        <box
          style={{
            flexDirection: "column",
            backgroundColor: tokens.bgBase,
            padding: 1,
            marginBottom: 1,
            border: ["left"],
            borderStyle: "heavy",
            borderColor: tokens.borderMuted,
          }}
        >
          {request.preview.type === "command" && (
            <>
              <text style={{ fg: tokens.textMuted }}>Command:</text>
              <text style={{ fg: tokens.success }}>{request.preview.command}</text>
              <text style={{ fg: tokens.textMuted }}>Working dir: {request.preview.cwd}</text>
            </>
          )}

          {request.preview.type === "content" && (
            <>
              <text style={{ fg: tokens.textMuted }}>Content to write:</text>
              <text style={{ fg: tokens.textBase }}>
                {request.preview.content}
                {request.preview.truncated && "\n[truncated...]"}
              </text>
            </>
          )}

          {request.preview.type === "diff" && (
            <>
              <text style={{ fg: tokens.textMuted }}>Before:</text>
              <text style={{ fg: tokens.diffDelete }}>{request.preview.before}</text>
              <text style={{ fg: tokens.textMuted }}>After:</text>
              <text style={{ fg: tokens.diffAdd }}>{request.preview.after}</text>
            </>
          )}
        </box>
      )}

      <box style={{ flexDirection: "row" }}>
        <text style={{ fg: tokens.textMuted }}>[</text>
        <text style={{ fg: tokens.success }}>Y</text>
        <text style={{ fg: tokens.textMuted }}>]es  [</text>
        <text style={{ fg: tokens.error }}>N</text>
        <text style={{ fg: tokens.textMuted }}>/Esc]o  [</text>
        <text style={{ fg: tokens.primaryBase }}>A</text>
        <text style={{ fg: tokens.textMuted }}>]lways  [</text>
        <text style={{ fg: tokens.warning }}>D</text>
        <text style={{ fg: tokens.textMuted }}>]eny always</text>
      </box>
    </box>
  );
}
