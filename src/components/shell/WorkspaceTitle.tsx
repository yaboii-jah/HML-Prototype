"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useDemo } from "@/src/app-state/DemoProvider";
import { materialId } from "@/src/domain/ids";
import { auditRecords } from "@/src/domain/audit";

const sections: Record<string, string> = { dashboard: "Operations dashboard", projects: "Projects", requests: "Material requests", suppliers: "Suppliers", "purchase-orders": "Purchase orders", accounting: "Accounting", finance: "Finance", deliveries: "Deliveries", inventory: "Site inventory", reports: "Operations report", admin: "Administration", "stock-transfers": "Stock transfer" };
export function WorkspaceTitle() {
  const pathname = usePathname();
  const { snapshot, access } = useDemo();
  useEffect(() => {
    const [section, id, subpage] = pathname.split("/").filter(Boolean);
    let title = sections[section] || "Project operations";
    if (!access.canOpen(pathname)) title = "Access unavailable";
    else if (snapshot) {
      const record = auditRecords(snapshot).get(section === "inventory" && id === "usage" ? subpage : id);
      if (record) title = `${record.ref} · ${title}`;
      else if (id === "new" || subpage === "new") title = section === "inventory" ? "Record usage" : `New ${section === "requests" ? "material request" : section === "deliveries" ? "delivery" : "record"}`;
      else if (section === "inventory" && id && subpage) {
        const item = snapshot.movements.find(m => m.siteId === id && materialId(m.itemName, m.unit) === subpage);
        if (item) title = `${item.itemName} · Site inventory`;
      }
    }
    document.title = `${title} | HML ConstructSync`;
  }, [pathname, snapshot, access]);
  return null;
}
