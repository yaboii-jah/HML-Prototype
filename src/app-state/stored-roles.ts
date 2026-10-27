// Read compatibility for browser data saved before the department was renamed.
const previousAccountingRole = "Accounting / Auditing";
const roleFields = new Set(["role", "actor", "createdBy", "reviewedBy", "releasedBy", "uploadedBy", "aiReviewedBy"]);

export function normalizeStoredRoles(raw: string): string {
  let changed = false;
  const value: unknown = JSON.parse(raw, (key, value: unknown) => {
    if (roleFields.has(key) && value === previousAccountingRole) {
      changed = true;
      return "Accounting";
    }
    return value;
  });
  return changed ? JSON.stringify(value) : raw;
}
