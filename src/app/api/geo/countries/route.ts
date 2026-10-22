import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await getDb().country.findMany({ select: { iso2: true, name: true }, orderBy: { name: "asc" } });
  return Response.json(rows);
}
