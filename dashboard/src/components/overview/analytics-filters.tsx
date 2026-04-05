"use client";
// 使用分析筛选工具栏（V5-13 / V5-14 共用）
import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";

export interface AnalyticsFiltersValue {
  granularity: "hour" | "day" | "week" | "month";
  from: string;
  to: string;
  providerIds: string[];
  models: string[];
  routingLayers: string[];
  ruleIds: string[];
  metrics: string[];
}

interface FilterOptions {
  providers: { id: string; name: string }[];
  models: { providerId: string; modelId: string; label: string }[];
  routingLayers: string[];
  rules: { id: string; name: string }[];
}

interface Props {
  value: AnalyticsFiltersValue;
  options: FilterOptions | null;
  onChange: (v: AnalyticsFiltersValue) => void;
  onApply: () => void;
}

const GRANULARITIES = ["hour", "day", "week", "month"] as const;
const ALL_METRICS = ["requests", "tokens", "cost", "saved", "layerHits", "ruleHits"] as const;

export function AnalyticsFilters({ value, options, onChange, onApply }: Props) {
  const { t } = useI18n();

  const setField = useCallback(
    <K extends keyof AnalyticsFiltersValue>(key: K, val: AnalyticsFiltersValue[K]) => {
      onChange({ ...value, [key]: val });
    },
    [value, onChange],
  );

  const toggleMetric = useCallback(
    (m: string) => {
      const cur = value.metrics;
      const next = cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m];
      if (next.length > 0) setField("metrics", next);
    },
    [value.metrics, setField],
  );

  return (
    <div className="flex flex-wrap items-end gap-3 text-sm">
      {/* 粒度 */}
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">
          {t("overview.analytics.granularity.label")}
        </label>
        <div className="flex rounded-md border border-border">
          {GRANULARITIES.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setField("granularity", g)}
              className={cn(
                "px-2.5 py-1 text-xs font-medium transition-colors first:rounded-l-md last:rounded-r-md",
                value.granularity === g
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted",
              )}
            >
              {t(`overview.analytics.granularity.${g}`)}
            </button>
          ))}
        </div>
      </div>

      {/* From / To */}
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">
          {t("overview.analytics.from")}
        </label>
        <input
          type="date"
          value={value.from}
          onChange={(e) => setField("from", e.target.value)}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">
          {t("overview.analytics.to")}
        </label>
        <input
          type="date"
          value={value.to}
          onChange={(e) => setField("to", e.target.value)}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs"
        />
      </div>

      {/* 多选 dropdown：Provider */}
      {options && options.providers.length > 0 && (
        <MultiSelectDropdown
          label={t("overview.analytics.filter.providers")}
          items={options.providers.map((p) => ({ id: p.id, label: p.name }))}
          selected={value.providerIds}
          onChange={(ids) => setField("providerIds", ids)}
        />
      )}

      {/* 多选 dropdown：Routing Layer */}
      {options && options.routingLayers.length > 0 && (
        <MultiSelectDropdown
          label={t("overview.analytics.filter.layers")}
          items={options.routingLayers.map((l) => ({ id: l, label: l }))}
          selected={value.routingLayers}
          onChange={(ids) => setField("routingLayers", ids)}
        />
      )}

      {/* 多选 dropdown：Rule */}
      {options && options.rules.length > 0 && (
        <MultiSelectDropdown
          label={t("overview.analytics.filter.rules")}
          items={options.rules.map((r) => ({ id: r.id, label: r.name }))}
          selected={value.ruleIds}
          onChange={(ids) => setField("ruleIds", ids)}
        />
      )}

      {/* 指标 checkbox */}
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">
          {t("overview.analytics.metric.label")}
        </label>
        <div className="flex flex-wrap gap-2">
          {ALL_METRICS.map((m) => (
            <label key={m} className="flex items-center gap-1 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={value.metrics.includes(m)}
                onChange={() => toggleMetric(m)}
                className="rounded border-border"
              />
              {t(`overview.analytics.metric.${m}`)}
            </label>
          ))}
        </div>
      </div>

      {/* 查询 */}
      <button
        type="button"
        onClick={onApply}
        className="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        {t("overview.analytics.apply")}
      </button>
    </div>
  );
}

// ========== 多选 Dropdown ==========

function MultiSelectDropdown({
  label,
  items,
  selected,
  onChange,
}: {
  label: string;
  items: { id: string; label: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const toggle = (id: string) => {
    onChange(
      selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id],
    );
  };

  return (
    <div className="relative">
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-muted transition-colors"
      >
        <span>{selected.length > 0 ? `${selected.length} selected` : "All"}</span>
        <svg className="h-3 w-3" viewBox="0 0 12 12"><path d="M3 5l3 3 3-3" stroke="currentColor" fill="none" strokeWidth="1.5" /></svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 max-h-48 w-48 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md">
          <div className="flex gap-1 border-b border-border pb-1 mb-1">
            <button
              type="button"
              onClick={() => onChange(items.map((i) => i.id))}
              className="text-[10px] text-primary hover:underline"
            >
              {t("overview.analytics.filter.selectAll")}
            </button>
            <span className="text-muted-foreground">/</span>
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-[10px] text-primary hover:underline"
            >
              {t("overview.analytics.filter.deselectAll")}
            </button>
          </div>
          {items.map((item) => (
            <label
              key={item.id}
              className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-muted"
            >
              <input
                type="checkbox"
                checked={selected.includes(item.id)}
                onChange={() => toggle(item.id)}
                className="rounded border-border"
              />
              <span className="truncate">{item.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
