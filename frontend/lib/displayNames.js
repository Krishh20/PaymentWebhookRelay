// Display-only names for the dashboard. Source slugs, destination URLs and the
// underlying database records stay unchanged.
const DISPLAY_NAMES = {
  "Postman Sandbox": "Postman Payment Simulator",
  "Local Mock Destination": "Mock Payment Receiver",
};

export function displayName(name) {
  return DISPLAY_NAMES[name] ?? name;
}
