import type { Instrumentation } from "next";

/**
 * Every unexpected server error in a page, a route handler, a server action or the proxy ends here (owner, 2026-10-18), and is written
 * down for the Developer console (system_events) — before this, such an error only went to the hosting's log, where nobody looks.
 *
 * Node.js only: the recorder uses the database. The runtime test is written as an `if (… === "nodejs") { await import(…) }` block, the
 * form Next's documentation uses, so the edge build drops the block and never tries to bundle the database for the edge. It never
 * throws and never waits long: capturing an error must not be able to make a request slower or fail. Expected things (a message for the
 * person, a redirect, a not-found page, a cancelled request) are skipped inside the recorder, and everything is scrubbed there first.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { recordRequestError } = await import("@/server/services/system-events");
      await recordRequestError(error, { path: request.path, method: request.method }, context);
    } catch {
      /* the request must not depend on it */
    }
  }
};
