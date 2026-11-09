export function formatDateTime(value) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date);
}

export function formatNumber(value) {
  return new Intl.NumberFormat().format(value ?? 0);
}

export function formatPercent(value) {
  if (value === null || value === undefined) {
    return "—";
  }

  return `${value}%`;
}

export function shortId(value, length = 8) {
  if (!value) {
    return "—";
  }

  return value.slice(0, length);
}

export function percent(part, total) {
  if (!total) {
    return 0;
  }

  return Math.round((part / total) * 1000) / 10;
}
