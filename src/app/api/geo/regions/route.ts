import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const country = new URL(req.url).searchParams.get("country");
  if (!country) return Response.json([], { status: 400 });
  const rows = await getDb().region.findMany({
    where: { countryIso: country },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return Response.json(rows);
}
