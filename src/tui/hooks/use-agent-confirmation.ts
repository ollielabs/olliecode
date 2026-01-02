/**
 * Hook for managing tool confirmation dialogs.
 * Handles the promise-based flow for user confirmation of risky operations.
 */

import { useState, useRef, useCallback } from "react";
import type { ConfirmationRequest, ConfirmationResponse } from "../types";

export type UseAgentConfirmationReturn = {
  /** Current pending confirmation request, or null if none */
  pendingConfirmation: ConfirmationRequest | null;
  /** Request user confirmation - returns a promise that resolves with the response */
  requestConfirmation: (request: ConfirmationRequest) => Promise<ConfirmationResponse>;
  /** Handle user's response to a confirmation dialog */
  handleConfirmationResponse: (response: ConfirmationResponse) => void;
};

export function useAgentConfirmation(): UseAgentConfirmationReturn {
  const [pendingConfirmation, setPendingConfirmation] = useState<ConfirmationRequest | null>(null);
  const confirmationResolverRef = useRef<((response: ConfirmationResponse) => void) | null>(null);

  const requestConfirmation = useCallback((request: ConfirmationRequest): Promise<ConfirmationResponse> => {
    return new Promise((resolve) => {
      confirmationResolverRef.current = resolve;
      setPendingConfirmation(request);
    });
  }, []);

  const handleConfirmationResponse = useCallback((response: ConfirmationResponse) => {
    if (confirmationResolverRef.current) {
      confirmationResolverRef.current(response);
      confirmationResolverRef.current = null;
    }
    setPendingConfirmation(null);
  }, []);

  return {
    pendingConfirmation,
    requestConfirmation,
    handleConfirmationResponse,
  };
}
