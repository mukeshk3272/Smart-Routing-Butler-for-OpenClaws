"use client";
// 饼图（环形图）组件 — 纯 SVG stroke-dasharray 实现（V5-14）
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

interface Slice {
  label: string;
  value: number;
}

interface Props {
  data: Slice[];
  emptyLabel: string;
  /** 最多显示 N 项，超出合并为 "Other" */
  maxSlices?: number;
}

const PALETTE = [
  "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6",
  "#ef4444", "#06b6d4", "#f97316", "#14b8a6",
  "#ec4899", "#6366f1",
];

const SIZE = 200;
const RADIUS = 70;
const STROKE_WIDTH = 28;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function AnalyticsPieChart({ data, emptyLabel, maxSlices = 8 }: Props) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const slices = useMemo(() => {
    const sorted = [...data].sort((a, b) => b.value - a.value);
    if (sorted.length <= maxSlices) return sorted;
    const top = sorted.slice(0, maxSlices);
    const otherVal = sorted.slice(maxSlices).reduce((s, d) => s + d.value, 0);
    if (otherVal > 0) top.push({ label: "Other", value: otherVal });
    return top;
  }, [data, maxSlices]);

  const total = slices.reduce((s, d) => s + d.value, 0);

  // 计算每段弧的 dasharray / dashoffset
  const arcs = useMemo(() => {
    let offset = 0;
    return slices.map((sl) => {
      const pct = total > 0 ? sl.value / total : 0;
      const dash = pct * CIRCUMFERENCE;
      const gap = CIRCUMFERENCE - dash;
      const currentOffset = offset;
      offset += dash;
      return { dash, gap, offset: currentOffset };
    });
  }, [slices, total]);

  if (total === 0 || slices.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {emptyLabel}
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:gap-6">
      {/* 圆环 */}
      <div className="relative shrink-0">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          width={SIZE}
          height={SIZE}
        >
          {arcs.map((arc, i) => (
            <circle
              key={slices[i].label}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={PALETTE[i % PALETTE.length]}
              strokeWidth={STROKE_WIDTH}
              strokeDasharray={`${arc.dash} ${arc.gap}`}
              strokeDashoffset={-arc.offset}
              className="transition-opacity duration-150"
              opacity={hoverIdx !== null && hoverIdx !== i ? 0.35 : 1}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
            />
          ))}
          {/* 中心文字 */}
          <text
            x={SIZE / 2}
            y={SIZE / 2 - 6}
            textAnchor="middle"
            className="fill-foreground text-[22px] font-bold"
          >
            {fmtTotal(total)}
          </text>
          <text
            x={SIZE / 2}
            y={SIZE / 2 + 14}
            textAnchor="middle"
            className="fill-muted-foreground text-[11px]"
          >
            total
          </text>
        </svg>
      </div>

      {/* 右侧图例 */}
      <div className="flex flex-col gap-2 text-sm">
        {slices.map((sl, i) => {
          const pct = Math.round((sl.value / total) * 100);
          return (
            <div
              key={sl.label}
              className={cn(
                "flex items-center gap-2 rounded px-2 py-0.5 transition-colors",
                hoverIdx === i && "bg-muted",
              )}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
            >
              <span
                className="inline-block h-3 w-3 rounded-sm shrink-0"
                style={{ background: PALETTE[i % PALETTE.length] }}
              />
              <span className="truncate font-medium" title={sl.label}>
                {sl.label}
              </span>
              <span className="ml-auto whitespace-nowrap text-muted-foreground">
                {sl.value.toLocaleString()} ({pct}%)
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function fmtTotal(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString();
}
