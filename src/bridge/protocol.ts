// The files exchanged with PixInsight, described in docs/bridge-protocol.md.

/** One request to PixInsight, written to <bridge>/commands/<id>.json. */
export interface BridgeCommand {
  id: string;
  /** ISO time of creation. The handlers refuse requests older than ten minutes. */
  timestamp: string;
  /** Bridge verb, a key of ROUTES in pjsr/dispatch.js. */
  tool: string;
  parameters: Record<string, unknown>;
  /** View a process runs on, or null to run it globally. */
  targetView: string | null;
}

export interface BridgeSuccess {
  id: string;
  status: "success";
  duration_ms: number;
  outputs: Record<string, unknown>;
  message?: string;
}

export interface BridgeFailure {
  id: string;
  status: "error";
  duration_ms: number;
  error: { message: string; type?: string; stack?: string };
}

/** The outcome of a command, written to <bridge>/results/<id>.json or produced by the server. */
export type BridgeResult = BridgeSuccess | BridgeFailure;
