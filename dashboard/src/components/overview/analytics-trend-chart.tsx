"use client";
// 趋势图组件 — 纯 SVG 折线/柱状可切换（V5-13）
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";

export interface TrendSeriesEntry {
  bucket: string;
  requests: number;
  tokens: number;
  cost: number;
  saved: number;
  layerHits: Record<string, number>;
  ruleHits: Record<string, number>;
}

interface Props {
  series: TrendSeriesEntry[];
  metrics: string[];
  ruleNameMap?: Map<string, string>;
}

// 调色板
const PALETTE = [
  "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6",
  "#ef4444", "#06b6d4", "#f97316", "#14b8a6",
  "#ec4899", "#6366f1",
];

const VIEW_W = 800;
const VIEW_H = 300;
const PAD = { top: 20, right: 20, bottom: 36, left: 60 };
const CHART_W = VIEW_W - PAD.left - PAD.right;
const CHART_H = VIEW_H - PAD.top - PAD.bottom;

export function AnalyticsTrendChart({ series, metrics, ruleNameMap }: Props) {
  const { t } = useI18n();
  const [chartType, setChartType] = useState<"line" | "bar">("line");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // 展开所有需要绘制的线/柱系列
  const resolvedSeries = useMemo(() => {
    const result: { key: string; label: string; values: number[] }[] = [];
    for (const m of metrics) {
      if (m === "layerHits") {
        const allLayers = new Set<string>();
        series.forEach((s) => Object.keys(s.layerHits).forEach((k) => allLayers.add(k)));
        for (const layer of allLayers) {
          result.push({
            key: `layer:${layer}`,
            label: layer,
            values: series.map((s) => s.layerHits[layer] ?? 0),
          });
        }
      } else if (m === "ruleHits") {
        const allRules = new Set<string>();
        series.forEach((s) => Object.keys(s.ruleHits).forEach((k) => allRules.add(k)));
        for (const rule of allRules) {
          result.push({
            key: `rule:${rule}`,
            label: ruleNameMap?.get(rule) ?? rule.slice(0, 8),
            values: series.map((s) => s.ruleHits[rule] ?? 0),
          });
        }
      } else {
        result.push({
          key: m,
          label: t(`overview.analytics.metric.${m}`),
          values: series.map((s) => {
            const val = s[m as keyof TrendSeriesEntry];
            return typeof val === "number" ? val : 0;
          }),
        });
      }
    }
    return result;
  }, [series, metrics, ruleNameMap, t]);

  // Y 轴最大值
  const yMax = useMemo(() => {
    let max = 0;
    for (const rs of resolvedSeries) {
      for (const v of rs.values) {
        if (v > max) max = v;
      }
    }
    return niceMax(max);
  }, [resolvedSeries]);

  const n = series.length;
  const xStep = n > 1 ? CHART_W / (n - 1) : CHART_W;
  const barWidth = Math.max(2, Math.max(CHART_W / (n || 1) / (resolvedSeries.length + 1), 2));

  // Y 轴刻度
  const yTicks = useMemo(() => {
    const steps = 5;
    return Array.from({ length: steps + 1 }, (_, i) =>
      Math.round((yMax / steps) * i * 100) / 100,
    );
  }, [yMax]);

  if (n === 0) return null;

  function xPos(i: number): number {
    return PAD.left + (n > 1 ? (i / (n - 1)) * CHART_W : CHART_W / 2);
  }
  function yPos(v: number): number {
    return PAD.top + CHART_H - (yMax > 0 ? (v / yMax) * CHART_H : 0);
  }

  return (
    <div className="space-y-3">
      {/* 切换按钮 */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setChartType("line")}
          className={cn(
            "rounded-md px-3 py-1 text-xs font-medium transition-colors",
            chartType === "line" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80",
          )}
        >
          {t("overview.analytics.chartType.line")}
        </button>
        <button
          type="button"
          onClick={() => setChartType("bar")}
          className={cn(
            "rounded-md px-3 py-1 text-xs font-medium transition-colors",
            chartType === "bar" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80",
          )}
        >
          {t("overview.analytics.chartType.bar")}
        </button>
      </div>

      {/* SVG 图表 */}
      <div className="relative">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="w-full"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* 网格线 */}
          {yTicks.map((tick) => (
            <g key={tick}>
              <line
                x1={PAD.left}
                x2={VIEW_W - PAD.right}
                y1={yPos(tick)}
                y2={yPos(tick)}
                stroke="currentColor"
                className="text-border"
                strokeDasharray="4 4"
                strokeWidth={0.5}
              />
              <text
                x={PAD.left - 6}
                y={yPos(tick) + 3}
                textAnchor="end"
                className="fill-muted-foreground text-[10px]"
              >
                {fmtYLabel(tick)}
              </text>
            </g>
          ))}

          {/* X 轴标签 */}
          {series.map((s, i) => {
            const showLabel = n <= 30 || i % Math.ceil(n / 15) === 0;
            if (!showLabel) return null;
            return (
              <text
                key={s.bucket}
                x={xPos(i)}
                y={VIEW_H - 4}
                textAnchor="middle"
                className="fill-muted-foreground text-[9px]"
              >
                {s.bucket}
              </text>
            );
          })}

          {/* 数据系列 */}
          {chartType === "line"
            ? resolvedSeries.map((rs, si) => {
                const points = rs.values
                  .map((v, i) => `${xPos(i)},${yPos(v)}`)
                  .join(" ");
                return (
                  <polyline
                    key={rs.key}
                    points={points}
                    fill="none"
                    stroke={PALETTE[si % PALETTE.length]}
                    strokeWidth={2}
                    strokeLinejoin="round"
                  />
                );
              })
            : resolvedSeries.map((rs, si) =>
                rs.values.map((v, i) => {
                  const bx = xPos(i) - (resolvedSeries.length * barWidth) / 2 + si * barWidth;
                  const h = yMax > 0 ? (v / yMax) * CHART_H : 0;
                  return (
                    <rect
                      key={`${rs.key}-${i}`}
                      x={bx}
                      y={yPos(v)}
                      width={barWidth - 1}
                      height={Math.max(h, 0)}
                      fill={PALETTE[si % PALETTE.length]}
                      opacity={0.85}
                      rx={1}
                    />
                  );
                }),
              )}

          {/* 悬停触发区域 */}
          {series.map((_, i) => (
            <rect
              key={i}
              x={xPos(i) - (n > 1 ? xStep / 2 : CHART_W / 2)}
              y={PAD.top}
              width={n > 1 ? xStep : CHART_W}
              height={CHART_H}
              fill="transparent"
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
            />
          ))}
        </svg>

        {/* Tooltip */}
        {hoverIdx !== null && (
          <div
            className="pointer-events-none absolute z-10 rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md"
            style={{
              left: `${(xPos(hoverIdx) / VIEW_W) * 100}%`,
              top: "10px",
              transform: "translateX(-50%)",
            }}
          >
            <div className="mb-1 font-semibold">{series[hoverIdx].bucket}</div>
            {resolvedSeries.map((rs, si) => (
              <div key={rs.key} className="flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: PALETTE[si % PALETTE.length] }}
                />
                <span className="text-muted-foreground">{rs.label}:</span>
                <span className="font-medium">{fmtYLabel(rs.values[hoverIdx])}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 图例 */}
      {resolvedSeries.length > 1 && (
        <div className="flex flex-wrap gap-3 text-xs">
          {resolvedSeries.map((rs, si) => (
            <div key={rs.key} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: PALETTE[si % PALETTE.length] }}
              />
              <span className="text-muted-foreground">{rs.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 取"好看"的最大值 */
function niceMax(v: number): number {
  if (v <= 0) return 10;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  if (norm <= 1) return mag;
  if (norm <= 2) return 2 * mag;
  if (norm <= 5) return 5 * mag;
  return 10 * mag;
}

function fmtYLabel(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2);
}
