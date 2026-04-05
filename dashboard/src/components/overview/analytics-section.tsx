"use client";
// 使用分析区域容器 — 组合筛选栏 + 趋势图 + 饼图（V5-13 + V5-14）
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import {
  AnalyticsFilters,
  type AnalyticsFiltersValue,
} from "@/components/overview/analytics-filters";
import {
  AnalyticsTrendChart,
  type TrendSeriesEntry,
} from "@/components/overview/analytics-trend-chart";
import { AnalyticsPieChart } from "@/components/overview/analytics-pie-chart";

interface FilterOptions {
  providers: { id: string; name: string }[];
  models: { providerId: string; modelId: string; label: string }[];
  routingLayers: string[];
  rules: { id: string; name: string }[];
}

interface AnalyticsData {
  series: TrendSeriesEntry[];
  totals: {
    requests: number;
    tokens: number;
    cost: number;
    saved: number;
    layerHits: Record<string, number>;
    ruleHits: Record<string, number>;
  };
  filters: FilterOptions;
}

function defaultFilters(): AnalyticsFiltersValue {
  const now = new Date();
  const from = new Date(now.getTime() - 7 * 86400000);
  return {
    granularity: "day",
    from: from.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
    providerIds: [],
    models: [],
    routingLayers: [],
    ruleIds: [],
    metrics: ["requests", "cost"],
  };
}

export function AnalyticsSection() {
  const { t } = useI18n();
  const [filters, setFilters] = useState<AnalyticsFiltersValue>(defaultFilters);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (f: AnalyticsFiltersValue) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("granularity", f.granularity);
      params.set("metrics", f.metrics.join(","));
      if (f.from) params.set("from", f.from);
      if (f.to) params.set("to", f.to);
      if (f.providerIds.length) params.set("providerIds", f.providerIds.join(","));
      if (f.models.length) params.set("models", f.models.join(","));
      if (f.routingLayers.length) params.set("routingLayers", f.routingLayers.join(","));
      if (f.ruleIds.length) params.set("ruleIds", f.ruleIds.join(","));

      const res = await fetch(`/api/stats/overview-analytics?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as AnalyticsData;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("overview.analytics.loadFail"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  // 初次加载
  useEffect(() => {
    void fetchData(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleApply = useCallback(() => {
    void fetchData(filters);
  }, [filters, fetchData]);

  // 饼图数据：取首选指标的 totals 分布
  const pieData = useMemo(() => {
    if (!data) return { slices: [], label: "" };
    const firstMetric = filters.metrics[0] ?? "requests";

    if (firstMetric === "layerHits" || firstMetric === "ruleHits") {
      const hitMap = data.totals[firstMetric];
      const ruleNameMap = firstMetric === "ruleHits"
        ? new Map(data.filters.rules.map((r) => [r.id, r.name]))
        : null;
      return {
        slices: Object.entries(hitMap).map(([k, v]) => ({
          label: ruleNameMap?.get(k) ?? k,
          value: v,
        })),
        label: t(`overview.analytics.metric.${firstMetric}`),
      };
    }

    // 按 routingLayer 分布（requests / tokens / cost / saved）
    const layerMap = data.totals.layerHits;
    return {
      slices: Object.entries(layerMap).map(([k, v]) => ({
        label: k,
        value: v,
      })),
      label: `${t(`overview.analytics.metric.${firstMetric}`)} — ${t("overview.analytics.pie.byLayer")}`,
    };
  }, [data, filters.metrics, t]);

  // rule 名称映射
  const ruleNameMap = useMemo(() => {
    if (!data) return new Map<string, string>();
    return new Map(data.filters.rules.map((r) => [r.id, r.name]));
  }, [data]);

  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-5">
      <h2 className="text-lg font-semibold">{t("overview.analytics.title")}</h2>

      <AnalyticsFilters
        value={filters}
        options={data?.filters ?? null}
        onChange={setFilters}
        onApply={handleApply}
      />

      {loading && (
        <div className="flex h-48 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && data && data.series.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {t("overview.analytics.noData")}
        </p>
      )}

      {!loading && !error && data && data.series.length > 0 && (
        <>
          {/* 趋势图 */}
          <AnalyticsTrendChart
            series={data.series}
            metrics={filters.metrics}
            ruleNameMap={ruleNameMap}
          />

          {/* 饼图 */}
          <div>
            <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
              {pieData.label}
            </h3>
            <AnalyticsPieChart
              data={pieData.slices}
              emptyLabel={t("overview.analytics.pie.empty")}
            />
          </div>
        </>
      )}
    </div>
  );
}
