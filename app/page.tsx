import { redirect } from "next/navigation";
import { legacyDestination } from "@/src/domain/legacy-links";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const params = new URLSearchParams();
  for (const key of ["view", "kind", "id"]) {
    const value = query[key];
    if (typeof value === "string") params.set(key, value);
    else if (Array.isArray(value) && value[0]) params.set(key, value[0]);
  }
  redirect(legacyDestination(params) ?? "/dashboard");
}
