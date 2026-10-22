"use client";
import { useEffect, useState } from "react";

export interface Location {
  country: string;
  region: string;
  city: string;
}
interface Opt { id: string; name: string }

const get = <T,>(url: string): Promise<T> => fetch(url).then((r) => r.json());

/** Cascading Country -> State/Region -> City selects. Parent change resets children. */
export function LocationPicker({ label, value, onChange }: {
  label: string;
  value: Location;
  onChange: (l: Location) => void;
}) {
  const [countries, setCountries] = useState<Opt[]>([]);
  const [regions, setRegions] = useState<Opt[]>([]);
  const [cities, setCities] = useState<Opt[]>([]);

  useEffect(() => {
    get<{ iso2: string; name: string }[]>("/api/geo/countries").then((r) =>
      setCountries(r.map((c) => ({ id: c.iso2, name: c.name }))));
  }, []);

  useEffect(() => {
    setRegions([]);
    if (value.country) get<Opt[]>(`/api/geo/regions?country=${value.country}`).then(setRegions);
  }, [value.country]);

  useEffect(() => {
    setCities([]);
    if (!value.country) return;
    const r = value.region ? `&region=${value.region}` : "";
    get<{ id: number; name: string }[]>(`/api/geo/cities?country=${value.country}${r}`).then((c) =>
      setCities(c.map((x) => ({ id: String(x.id), name: x.name }))));
  }, [value.country, value.region]);

  const sel = "w-full rounded border p-2";
  return (
    <fieldset className="space-y-2">
      <legend className="font-semibold">{label}</legend>
      <select className={sel} aria-label={`${label} country`} value={value.country}
        onChange={(e) => onChange({ country: e.target.value, region: "", city: "" })}>
        <option value="">Country…</option>
        {countries.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      <select className={sel} aria-label={`${label} state`} value={value.region} disabled={!regions.length}
        onChange={(e) => onChange({ ...value, region: e.target.value, city: "" })}>
        <option value="">State / region…</option>
        {regions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      <select className={sel} aria-label={`${label} city`} value={value.city} disabled={!cities.length}
        onChange={(e) => onChange({ ...value, city: e.target.value })}>
        <option value="">City…</option>
        {cities.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </fieldset>
  );
}
