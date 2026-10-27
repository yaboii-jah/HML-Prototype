import type { Role } from "../domain/types.ts";

// Bootstrap accounts for the browser-local presenter workspace.
export const ACCOUNT_FIXTURES: { name: string; role: Role; email: string; password: string }[] = [
  { name: "Miguel Santos", role: "Site Personnel", email: "hml.constructsync.site@gmail.com", password: "HML!SITE2026" },
  { name: "Adrian Cruz", role: "Project Manager", email: "hml.constructsync.pm@gmail.com", password: "HML!PM2026" },
  { name: "Andrea Reyes", role: "Procurement", email: "hml.constructsync.procurement@gmail.com", password: "HML!PROC2026" },
  { name: "Paolo Mendoza", role: "Finance", email: "hml.constructsync.finance@gmail.com", password: "HML!FIN2026" },
  { name: "Carlo Villanueva", role: "Logistics", email: "hml.constructsync.logistics@gmail.com", password: "HML!LOG2026" },
  { name: "Isabel Cruz", role: "Accounting", email: "hml.constructsync.accounting@gmail.com", password: "HML!ACCT2026" },
  { name: "Daniel Garcia", role: "Administrator", email: "hml.constructsync.admin@gmail.com", password: "HML!ADMIN2026" },
];
