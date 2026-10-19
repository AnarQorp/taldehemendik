/**
 * Talde Hemendik! - HTML Sanitization & Escaping Utility
 * Defends against XSS injection across all dynamic UI rendering.
 */

export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
