export interface ParsedSupervisors {
  supervisor1Name: string;
  supervisor1Email: string;
  supervisor2Name: string;
  supervisor2Email: string;
  combinedName: string | null;
  combinedEmail: string | null;
  entries: Array<{ name: string; email: string }>;
  list: Array<{ name: string; email: string }>;
}

/**
 * Splits a potentially multi-supervisor name & email string into Supervisor 1 and Supervisor 2.
 */
export function parseSupervisors(
  rawName?: string | null,
  rawEmail?: string | null
): ParsedSupervisors {
  const emails = (rawEmail || "")
    .split(/[,;]+/)
    .map((e) => e.trim())
    .filter(Boolean);

  // Split names by " / ", " & ", ";", or "," (when there are multiple emails or explicit separators)
  const names = (rawName || "")
    .split(/\s*(?:\/|;|,|\s&\s)\s*/)
    .map((n) => n.trim())
    .filter(Boolean);

  const supervisor1Email = emails[0] || "";
  const supervisor2Email = emails[1] || "";

  const supervisor1Name = names[0] || "";
  const supervisor2Name = names[1] || "";

  const entries: Array<{ name: string; email: string }> = [];
  const maxLen = Math.max(emails.length, names.length);
  for (let i = 0; i < Math.min(maxLen, 2); i++) {
    const email = emails[i] || "";
    const name = names[i] || "";
    if (email || name) {
      entries.push({ name, email });
    }
  }

  return {
    supervisor1Name,
    supervisor1Email,
    supervisor2Name,
    supervisor2Email,
    combinedName: formatSupervisorNames(supervisor1Name, supervisor2Name),
    combinedEmail: formatSupervisorEmails(supervisor1Email, supervisor2Email),
    entries,
    list: entries,
  };
}

/**
 * Formats Supervisor 1 and Supervisor 2 names into a single stored string.
 */
export function formatSupervisorNames(
  name1?: string | null,
  name2?: string | null
): string | null {
  const list = [name1?.trim(), name2?.trim()].filter((v): v is string => Boolean(v));
  if (list.length === 0) return null;
  // Deduplicate case-insensitively
  const unique: string[] = [];
  for (const item of list) {
    if (!unique.some((u) => u.toLowerCase() === item.toLowerCase())) {
      unique.push(item);
    }
  }
  return unique.join(" / ");
}

/**
 * Formats Supervisor 1 and Supervisor 2 emails into a single comma-separated string for Nodemailer & DB storage.
 */
export function formatSupervisorEmails(
  email1?: string | null,
  email2?: string | null
): string | null {
  const rawList = [email1 || "", email2 || ""]
    .flatMap((v) => v.split(/[,;]+/))
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (rawList.length === 0) return null;
  const unique = Array.from(new Set(rawList));
  return unique.slice(0, 2).join(", ");
}

/**
 * Validates that a single or comma-separated supervisor email string contains valid email addresses.
 */
export function isValidSupervisorEmailList(value?: string | null): boolean {
  if (!value || !value.trim()) return true;
  const parts = value
    .split(/[,;]+/)
    .map((e) => e.trim())
    .filter(Boolean);
  if (parts.length === 0) return true;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return parts.every((p) => emailRegex.test(p));
}
