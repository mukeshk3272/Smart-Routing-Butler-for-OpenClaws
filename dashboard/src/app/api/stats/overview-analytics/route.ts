// 使用分析 API — 多维筛选、多粒度时序聚合（V5-13 趋势图 + V5-14 饼图数据源）
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth-guard";
import { logServerError } from "@/lib/server-logger";

// ========== 类型 ==========

interface BucketRow {
  bucket: string;
  requests: bigint;
  tokens: bigint;
  cost: number;
}

interface DimensionRow {
  bucket: string;
  routing_layer: string | null;
  rule_id: string | null;
  count: bigint;
}

type Metric = "requests" | "tokens" | "cost" | "saved" | "layerHits" | "ruleHits";

const VALID_METRICS = new Set<Metric>(["requests", "tokens", "cost", "saved", "layerHits", "ruleHits"]);
const VALID_GRANULARITIES = new Set(["hour", "day", "week", "month"]);

// 粒度对应的 PG date_trunc 参数及默认回溯天数
const GRANULARITY_DEFAULTS: Record<string, number> = {
  hour: 1,
  day: 7,
  week: 30,
  month: 365,
};

// PG TO_CHAR 格式（用于返回可读 bucket 标签）
const BUCKET_FORMAT: Record<string, string> = {
  hour: "YYYY-MM-DD HH24:00",
  day: "YYYY-MM-DD",
  week: "IYYY-\"W\"IW",
  month: "YYYY-MM",
};

// ========== 主处理 ==========

export async function GET(request: Request) {
  const { error } = await requireSession();
  if (error) return error;

  const { searchParams } = new URL(request.url);

  // --- 参数解析 ---
  const granularity = searchParams.get("granularity") ?? "day";
  if (!VALID_GRANULARITIES.has(granularity)) {
    return NextResponse.json(
      { error: `无效粒度：${granularity}，可选 hour/day/week/month` },
      { status: 400 },
    );
  }

  const rawMetrics = (searchParams.get("metrics") ?? "requests").split(",").filter(Boolean) as Metric[];
  const metrics = rawMetrics.filter((m) => VALID_METRICS.has(m));
  if (metrics.length === 0) {
    return NextResponse.json(
      { error: "至少选择一个有效指标（requests/tokens/cost/saved/layerHits/ruleHits）" },
      { status: 400 },
    );
  }

  const defaultDays = GRANULARITY_DEFAULTS[granularity] ?? 7;
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");

  const fromDate = fromParam ? new Date(`${fromParam}T00:00:00`) : new Date(Date.now() - defaultDays * 86400000);
  fromDate.setHours(0, 0, 0, 0);

  const toDate = toParam ? new Date(`${toParam}T23:59:59.999`) : new Date();
  if (toDate < fromDate) {
    return NextResponse.json({ error: "结束时间不能早于开始时间" }, { status: 400 });
  }

  // 可选筛选
  const providerIds = splitParam(searchParams.get("providerIds"));
  const models = splitParam(searchParams.get("models"));
  const routingLayers = splitParam(searchParams.get("routingLayers"));
  const ruleIds = splitParam(searchParams.get("ruleIds"));

  try {
    // --- 构造 WHERE 子句片段 ---
    const conditions: Prisma.Sql[] = [
      Prisma.sql`timestamp >= ${fromDate}`,
      Prisma.sql`timestamp <= ${toDate}`,
    ];

    if (routingLayers.length > 0) {
      conditions.push(Prisma.sql`"routingLayer" IN (${Prisma.join(routingLayers)})`);
    }
    if (ruleIds.length > 0) {
      conditions.push(Prisma.sql`"ruleId" IN (${Prisma.join(ruleIds)})`);
    }
    if (models.length > 0) {
      conditions.push(Prisma.sql`"targetModel" IN (${Prisma.join(models)})`);
    }
    if (providerIds.length > 0) {
      // targetModel 格式 "providerName/modelId"，通过 providers 表找到 name 再匹配
      const providerNames = await db.provider.findMany({
        where: { id: { in: providerIds } },
        select: { name: true },
      });
      const prefixes = providerNames.map((p) => `${p.name}/%`);
      if (prefixes.length > 0) {
        const likeConditions = prefixes.map((pf) => Prisma.sql`"targetModel" LIKE ${pf}`);
        conditions.push(Prisma.sql`(${Prisma.join(likeConditions, " OR ")})`);
      }
    }

    const whereClause = Prisma.join(conditions, " AND ");
    const bucketExpr = Prisma.raw(`date_trunc('${granularity}', timestamp)`);
    const formatStr = BUCKET_FORMAT[granularity] ?? "YYYY-MM-DD";

    // --- 并发查询 ---
    const [bucketRows, dimensionRows, filterProviders, filterModels, filterLayers, filterRules] =
      await Promise.all([
        // 1. 主聚合
        db.$queryRaw<BucketRow[]>`
          SELECT
            TO_CHAR(${bucketExpr}, ${formatStr}) as bucket,
            COUNT(*)::bigint as requests,
            COALESCE(SUM("inputTokens") + SUM("outputTokens"), 0)::bigint as tokens,
            COALESCE(SUM("estimatedCostUsd"), 0)::float as cost
          FROM request_logs
          WHERE ${whereClause}
          GROUP BY ${bucketExpr}
          ORDER BY ${bucketExpr}
          LIMIT 2000
        `,

        // 2. 维度明细（layerHits + ruleHits）
        (metrics.includes("layerHits") || metrics.includes("ruleHits"))
          ? db.$queryRaw<DimensionRow[]>`
              SELECT
                TO_CHAR(${bucketExpr}, ${formatStr}) as bucket,
                "routingLayer" as routing_layer,
                "ruleId" as rule_id,
                COUNT(*)::bigint as count
              FROM request_logs
              WHERE ${whereClause}
              GROUP BY ${bucketExpr}, "routingLayer", "ruleId"
              ORDER BY ${bucketExpr}
              LIMIT 10000
            `
          : Promise.resolve([] as DimensionRow[]),

        // 3-6. 筛选选项
        db.provider.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
        db.model.findMany({
          select: { providerId: true, modelId: true },
          where: { enabled: true },
          orderBy: { modelId: "asc" },
        }),
        db.$queryRaw<{ routing_layer: string }[]>`
          SELECT DISTINCT "routingLayer" as routing_layer
          FROM request_logs
          WHERE timestamp >= ${new Date(Date.now() - 30 * 86400000)}
          ORDER BY routing_layer
        `,
        db.rule.findMany({ select: { id: true, name: true }, orderBy: { priority: "asc" } }),
      ]);

    // --- 组装 series ---
    const series = bucketRows.map((row) => {
      const entry: Record<string, unknown> = {
        bucket: row.bucket,
        requests: Number(row.requests),
        tokens: Number(row.tokens),
        cost: Math.round(Number(row.cost) * 10000) / 10000,
        saved: Math.round(Number(row.cost) * 0.15 * 10000) / 10000,
        layerHits: {} as Record<string, number>,
        ruleHits: {} as Record<string, number>,
      };
      return entry;
    });

    // pivot 维度明细到 series
    const bucketIndex = new Map(series.map((s, i) => [s.bucket as string, i]));
    for (const dr of dimensionRows) {
      const idx = bucketIndex.get(dr.bucket);
      if (idx === undefined) continue;
      const s = series[idx];
      if (dr.routing_layer) {
        (s.layerHits as Record<string, number>)[dr.routing_layer] =
          ((s.layerHits as Record<string, number>)[dr.routing_layer] ?? 0) + Number(dr.count);
      }
      if (dr.rule_id) {
        (s.ruleHits as Record<string, number>)[dr.rule_id] =
          ((s.ruleHits as Record<string, number>)[dr.rule_id] ?? 0) + Number(dr.count);
      }
    }

    // --- 汇总 totals ---
    const totals = {
      requests: series.reduce((s, e) => s + (e.requests as number), 0),
      tokens: series.reduce((s, e) => s + (e.tokens as number), 0),
      cost: Math.round(series.reduce((s, e) => s + (e.cost as number), 0) * 10000) / 10000,
      saved: Math.round(series.reduce((s, e) => s + (e.saved as number), 0) * 10000) / 10000,
      layerHits: mergeMaps(series.map((e) => e.layerHits as Record<string, number>)),
      ruleHits: mergeMaps(series.map((e) => e.ruleHits as Record<string, number>)),
    };

    // --- 筛选选项 ---
    const providerMap = new Map(filterProviders.map((p) => [p.id, p.name]));
    const filters = {
      providers: filterProviders.map((p) => ({ id: p.id, name: p.name })),
      models: filterModels.map((m) => ({
        providerId: m.providerId,
        modelId: m.modelId,
        label: `${providerMap.get(m.providerId) ?? m.providerId}/${m.modelId}`,
      })),
      routingLayers: filterLayers.map((r) => r.routing_layer),
      rules: filterRules.map((r) => ({ id: r.id, name: r.name })),
    };

    return NextResponse.json({ series, totals, filters });
  } catch (e) {
    logServerError("stats/overview-analytics", e);
    return NextResponse.json(
      { error: "使用分析数据加载失败，请稍后重试" },
      { status: 500 },
    );
  }
}

// ========== 工具函数 ==========

function splitParam(v: string | null): string[] {
  if (!v) return [];
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

function mergeMaps(maps: Record<string, number>[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const m of maps) {
    for (const [k, v] of Object.entries(m)) {
      result[k] = (result[k] ?? 0) + v;
    }
  }
  return result;
}
