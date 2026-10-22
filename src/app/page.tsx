"use client";
import { useState } from "react";
import { LocationPicker, type Location } from "@/components/LocationPicker";

const empty: Location = { country: "", region: "", city: "" };

export default function Home() {
  const [a, setA] = useState(empty);
  const [b, setB] = useState(empty);
  return (
    <main className="space-y-6">
      <h1 className="text-2xl font-bold">CompareLife</h1>
      <div className="grid gap-6 sm:grid-cols-2">
        <LocationPicker label="Place A" value={a} onChange={setA} />
        <LocationPicker label="Place B" value={b} onChange={setB} />
      </div>
      <p className="text-sm text-gray-600">
        Comparison table, income sufficiency and retirement views arrive in the next phases. All figures will cite their source.
      </p>
    </main>
  );
}
