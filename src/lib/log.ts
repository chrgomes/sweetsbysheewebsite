/** Minimal structured logger: one JSON object per line, easy to ship to any log service. */
type Fields = Record<string, unknown>;

function write(level: "info" | "warn" | "error", event: string, fields?: Fields) {
  if (process.env.NODE_ENV === "test" && level === "info" && !process.env.LOG_IN_TESTS) return;
  const line = JSON.stringify({ level, event, time: new Date().toISOString(), ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields?: Fields) => write("info", event, fields),
  warn: (event: string, fields?: Fields) => write("warn", event, fields),
  error: (event: string, fields?: Fields) => write("error", event, fields),
};
