import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// Server-side typeahead: top cities by population for a country (and optional region / name prefix).
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const country = p.get("country");
  if (!country) return Response.json([], { status: 400 });
  const region = p.get("region");
  const q = p.get("q");
  const rows = await getDb().city.findMany({
    where: {
      countryIso: country,
      ...(region ? { regionId: region } : {}),
      ...(q ? { name: { startsWith: q, mode: "insensitive" } } : {}),
    },
    select: { id: true, name: true, population: true },
    orderBy: { population: "desc" },
    take: 50,
  });
  return Response.json(rows);
}
