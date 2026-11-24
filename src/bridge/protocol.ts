// The files exchanged with PixInsight, described in docs/bridge-protocol.md.

/** One request to PixInsight, written to <bridge>/commands/<id>.json. */
export interface BridgeCommand {
  id: string;
  /** ISO time of creation. */
  timestamp: string;
  /** Bridge verb, a key of ROUTES in pjsr/dispatch.js. */
  tool: string;
  parameters: Record<string, unknown>;
  /** View a process runs on, or null to run it globally. */
  targetView: string | null;
  /**
   * Epoch milliseconds the server last refreshed while waiting for the command to start. The
   * driver skips a command whose heartbeat is older than a minute.
   */
  heartbeat: number;
}

export interface BridgeSuccess<Outputs = Record<string, unknown>> {
  id: string;
  status: "success";
  duration_ms: number;
  outputs: Outputs;
  message?: string;
}

export interface BridgeFailure {
  id: string;
  status: "error";
  duration_ms: number;
  error: { message: string; type?: string; stack?: string };
}

/** The outcome of a command, written to <bridge>/results/<id>.json or produced by the server. */
export type BridgeResult<Outputs = Record<string, unknown>> = BridgeSuccess<Outputs> | BridgeFailure;
