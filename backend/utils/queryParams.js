const HttpError = require("./httpError");

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readQueryValue(query, key) {
  const value = query ? query[key] : undefined;

  // Express turns repeated query parameters into arrays. Use the last value.
  return Array.isArray(value) ? value[value.length - 1] : value;
}

function parseInteger(value, { name, fallback, min, max }) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < min ||
    (max !== undefined && parsed > max)
  ) {
    const range = max === undefined ? `at least ${min}` : `between ${min} and ${max}`;
    throw new HttpError(400, `${name} must be an integer ${range}.`);
  }

  return parsed;
}

function parsePagination(query) {
  return {
    limit: parseInteger(readQueryValue(query, "limit"), {
      name: "limit",
      fallback: 25,
      min: 1,
      max: 100,
    }),
    offset: parseInteger(readQueryValue(query, "offset"), {
      name: "offset",
      fallback: 0,
      min: 0,
    }),
  };
}

function parseOptionalString(query, key, maxLength) {
  const raw = readQueryValue(query, key);

  if (raw === undefined || raw === null) {
    return null;
  }

  if (typeof raw !== "string") {
    throw new HttpError(400, `${key} must be a single string value.`);
  }

  const value = raw.trim();

  if (value === "") {
    return null;
  }

  if (value.length > maxLength) {
    throw new HttpError(
      400,
      `${key} must be at most ${maxLength} characters.`,
    );
  }

  return value;
}

function parseEnumList(query, key, allowedValues, label = key) {
  const raw = readQueryValue(query, key);

  if (raw === undefined || raw === null || raw === "") {
    return null;
  }

  if (typeof raw !== "string") {
    throw new HttpError(400, `${key} must be a single string value.`);
  }

  const values = [
    ...new Set(
      raw
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];

  if (values.length === 0) {
    return null;
  }

  const invalid = values.filter((value) => !allowedValues.has(value));

  if (invalid.length > 0) {
    throw new HttpError(
      400,
      `${label} must be one of: ${[...allowedValues].join(", ")}.`,
    );
  }

  return values;
}

function parseOptionalDate(query, key) {
  const raw = readQueryValue(query, key);

  if (raw === undefined || raw === null || raw === "") {
    return null;
  }

  if (typeof raw !== "string") {
    throw new HttpError(400, `${key} must be a single date value.`);
  }

  const date = new Date(raw);

  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, `${key} must be a valid ISO date.`);
  }

  return date;
}

function assertDateRange(from, to, fromName, toName) {
  if (from && to && from > to) {
    throw new HttpError(400, `${fromName} must be before ${toName}.`);
  }
}

function parseUuid(value, name) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new HttpError(400, `${name} must be a valid UUID.`);
  }

  return value;
}

module.exports = {
  parsePagination,
  parseOptionalString,
  parseEnumList,
  parseOptionalDate,
  assertDateRange,
  parseUuid,
};
