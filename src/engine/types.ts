export type EntityType = "country" | "region" | "city";

export interface Metric {
  key: string;
  value: number;
  unit: string;
  year: number;
  sourceId: string;
  sourceUrl: string;
  level: EntityType;
}

export type MetricMap = Record<string, Metric | undefined>;

export interface Place {
  label: string;
  metrics: MetricMap;
}
