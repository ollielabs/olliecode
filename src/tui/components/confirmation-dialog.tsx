/**
 * Confirmation dialog for risky tool operations.
 * Shows what the tool will do and allows user to approve/deny.
 */

import { useCallback, useRef, useEffect } from "react";
import { useKeyboard } from "@opentui/react";
import type { ConfirmationRequest, ConfirmationResponse } from "../../agent/types";

export type ConfirmationDialogProps = {
  request: ConfirmationRequest;
  onResponse: (response: ConfirmationResponse) => void;
};

// Default risk color for undefined/unknown risk levels
const DEFAULT_RISK_COLOR = "#f39c12";

const RISK_COLORS: Record<string, string> = {
  dangerous: "#e74c3c",
  risky: "#f39c12",
  safe: "#27ae60",
  prompt: "#f39c12",
};

export function ConfirmationDialog({ request, onResponse }: ConfirmationDialogProps) {
  // Use refs to avoid stale closures in the keyboard handler
  const requestRef = useRef(request);
  const onResponseRef = useRef(onResponse);
  
  // Keep refs in sync with props
  useEffect(() => {
    requestRef.current = request;
    onResponseRef.current = onResponse;
  }, [request, onResponse]);

  const handleKeyPress = useCallback((key: { name?: string }) => {
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
      // Ignore other keys silently
    }
  }, []);

  useKeyboard(handleKeyPress);

  // Safe risk level color with fallback
  const riskColor = RISK_COLORS[request.riskLevel ?? ""] ?? DEFAULT_RISK_COLOR;

  return (
    <box
      flexDirection="column"
      border={["top", "bottom", "left", "right"]}
      borderStyle="rounded"
      borderColor={riskColor}
      backgroundColor="#1a1a2e"
      padding={1}
      marginTop={1}
      marginBottom={1}
    >
      {/* Header */}
      <box marginBottom={1}>
        <text fg={riskColor}>⚠ Confirmation Required</text>
      </box>

      {/* Tool info */}
      <box marginBottom={1}>
        <text fg="#888">Tool: </text>
        <text fg="#7aa2f7">{request.tool}</text>
        <text fg="#888"> ({request.riskLevel})</text>
      </box>

      {/* Description */}
      <box marginBottom={1}>
        <text>{request.description}</text>
      </box>

      {/* Preview */}
      {request.preview && (
        <box 
          flexDirection="column" 
          backgroundColor="#0d0d1a" 
          padding={1} 
          marginBottom={1}
          border={["left"]}
          borderStyle="heavy"
          borderColor="#444"
        >
          {request.preview.type === "command" && (
            <>
              <text fg="#888">Command:</text>
              <text fg="#98c379">{request.preview.command}</text>
              <text fg="#888">Working dir: {request.preview.cwd}</text>
            </>
          )}
          
          {request.preview.type === "content" && (
            <>
              <text fg="#888">Content to write:</text>
              <text fg="#abb2bf">
                {request.preview.content}
                {request.preview.truncated && "\n[truncated...]"}
              </text>
            </>
          )}
          
          {request.preview.type === "diff" && (
            <>
              <text fg="#888">Before:</text>
              <text fg="#e06c75">{request.preview.before}</text>
              <text fg="#888">After:</text>
              <text fg="#98c379">{request.preview.after}</text>
            </>
          )}
        </box>
      )}

      {/* Actions */}
      <box flexDirection="row">
        <text fg="#888">[</text>
        <text fg="#98c379">Y</text>
        <text fg="#888">]es  [</text>
        <text fg="#e06c75">N</text>
        <text fg="#888">/Esc]o  [</text>
        <text fg="#61afef">A</text>
        <text fg="#888">]lways  [</text>
        <text fg="#c678dd">D</text>
        <text fg="#888">]eny always</text>
      </box>
    </box>
  );
}
