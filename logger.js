/**
 * logger.js — structured logging.
 *
 * Prints one readable line per event — [timestamp] [LEVEL] [event] [fields]
 * — instead of raw JSON braces, since a person tailing this (locally or in
 * CloudWatch) is reading it directly, not parsing it with a tool.
 */

// IST has a fixed +05:30 offset (no DST), so this is just a manual shift
// rather than needing a timezone database.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istParts(date) {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  const pad = (n) => String(n).padStart(2, "0");
  return {
    day: pad(ist.getUTCDate()),
    month: pad(ist.getUTCMonth() + 1),
    year: ist.getUTCFullYear(),
    hours: pad(ist.getUTCHours()),
    minutes: pad(ist.getUTCMinutes()),
    seconds: pad(ist.getUTCSeconds()),
  };
}

// ISO-style +05:30 timestamp — kept for alerts.js's durable JSONL fallback
// log, where lines need to stay valid, lexicographically-sortable JSON.
function nowIST() {
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().replace("Z", "+05:30");
}

// DD:MM:YYYY - HH:mm:ss — for console/CloudWatch lines, where a human is
// actually reading it.
function readableIST() {
  const { day, month, year, hours, minutes, seconds } = istParts(new Date());
  return `${day}:${month}:${year} - ${hours}:${minutes}:${seconds}`;
}

// Renders a value with [] throughout instead of JSON's {}/[], so a log line
// reads as one consistent bracket style rather than nested curly braces.
function formatValue(value) {
  if (value === null || value === undefined) return String(value);
  if (Array.isArray(value)) return `[${value.map(formatValue).join(", ")}]`;
  if (typeof value === "object") {
    return `[${Object.entries(value)
      .map(([k, v]) => `${k}: ${formatValue(v)}`)
      .join(", ")}]`;
  }
  return String(value);
}

function write(level, event, fields) {
  const hasFields = fields && Object.keys(fields).length > 0;
  const line = `[${readableIST()}] [${level.toUpperCase()}] [${event}]${
    hasFields ? ` ${formatValue(fields)}` : ""
  }`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
  return { level, event, time: nowIST(), ...fields };
}

module.exports = {
  info: (event, fields) => write("info", event, fields),
  warn: (event, fields) => write("warn", event, fields),
  error: (event, fields) => write("error", event, fields),
  nowIST,
};
