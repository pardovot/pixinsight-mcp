import { AsyncLocalStorage } from "node:async_hooks";

/** What the MCP request a bridge call serves offers it: cancellation and progress reporting. */
export interface CallContext {
  /** Aborted when the client cancels the request. */
  signal?: AbortSignal;
  /** Present when the client asked for progress, `progress` must increase between calls. */
  reportProgress?: (progress: number, message: string) => Promise<void>;
}

const storage = new AsyncLocalStorage<CallContext>();

/** Runs a tool handler so the bridge calls it makes see the request's context. */
export function runInCallContext<Result>(context: CallContext, run: () => Promise<Result>): Promise<Result> {
  return storage.run(context, run);
}

export function currentCallContext(): CallContext {
  return storage.getStore() ?? {};
}
