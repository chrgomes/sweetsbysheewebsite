import type { Instrumentation } from "next";

/**
 * Log unhandled server errors as structured JSON (the same format as lib/log),
 * with the digest shown on error pages so a customer's report can be matched.
 * Only the path is logged, never query strings, headers or bodies, which may
 * hold tokens or personal data.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const digest = typeof err === "object" && err !== null && "digest" in err ? String(err.digest) : undefined;
  console.error(
    JSON.stringify({
      level: "error",
      event: "request.unhandled_error",
      time: new Date().toISOString(),
      message: err instanceof Error ? err.message : String(err),
      digest,
      method: request.method,
      path: request.path.split("?")[0],
      routePath: context.routePath,
      routeType: context.routeType,
    }),
  );
};
