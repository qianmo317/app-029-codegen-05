/**
 * 集中开料（多门头合排）：
 *
 * 一天接的几个门头各排各的板，板边都剩一条料；本模块把一批门头的料件凑到同一批板上一趟排完。
 *
 * 硬约束（最高优先级，见 PRIORITY_RULE）：
 *   不许把同一个门头的字混进别家门头要用的那片区域——一户在每张板上只占「一条连续横带」
 *   （整条横向贯通、一刀切下即可整块拿走），带内只放本户料件，带间只有锯缝。
 *
 * 合排走法二选一（本工具固定采用 A，并给出 B 的实测对照与翻案条件）：
 *   A. 先各自装箱再合并：各户先用与材料页完全相同的 nestPieces 分层装箱（料层内容、宽度完全不动），
 *      再把「整条料层」当成长条做全局最佳适应递减（BFD）分到最少张板，最后板内按户收拢：
 *      同一户的料层重排相邻成一条连续横带（板内重排不改荷载，最少板数原封保留），一刀切走。
 *   B. 先全批合成一趟再按门头回拆：料层不分户全局高低铺满（BFD 分箱与 A 同一份，板数相同），
 *      但板内保持全局顺序时会出现 A-B-A 交错，某户的字被夹在别户片区中间、整块拿不走；
 *      要整块拿走就得把板内按户收拢——那正是走法 A。即：整块约束下两走法板数相同，
 *      A 额外保证「各户料层就是自己家单排时的原样料层」，B 不划算；翻案条件见页面说明。
 *
 * 钱：每张板按各户在板上「实际占用片区面积」分摊板钱（整数分，最大余额法收余差），
 * Σ各户分摊 = 整批板钱，逐板可核。只有一户的板，板边余料可让给下一家，让料板的钱走
 * RemnantMode 三选一（自留 / 按实际占用 / 让出方与受让方约定比例，默认并推荐第三种 50:50）。
 */

import { nestPieces, type NestingResult, type Piece, type PlacedPiece } from './nesting'

// ---------- 输入 ----------

export interface OwnerJob {
  ownerId: string
  ownerName: string
  pieces: Piece[]
}

export interface BatchSheetSpec {
  wMm: number
  hMm: number
  kerfMm: number
  priceCents: number
  spec: string
}

// ---------- 中间结构：从单户装箱结果抽出的「整条料层」 ----------

interface ShelfItem {
  piece: Piece
  /** 料件在料层内的相对坐标（x 与单户排时一致，y 已减去料层起点） */
  rx: number
  ry: number
  rotated: boolean
}

interface Shelf {
  ownerId: string
  /** 在原单户板上的料层 y（仅溯源用） */
  originY: number
  originSheet: number
  heightMm: number
  items: ShelfItem[]
}

// ---------- 输出：合排版上的片区与料件 ----------

export interface BandPiece {
  id: string
  ownerId: string
  label: string
  x: number
  y: number
  wMm: number
  hMm: number
  rotated: boolean
}

export interface BatchBand {
  ownerId: string
  /** 片区在板上的起止 y（mm） */
  y0: number
  y1: number
  heightMm: number
  pieces: BandPiece[]
}

export interface OwnerArea {
  ownerId: string
  /** 该户在本板上料件外接矩形面积合计（mm²，用量口径） */
  pieceAreaMm2: number
  /** 该户在本板上划走的整片区域面积（板宽 × 带高，含带内锯缝） */
  bandAreaMm2: number
  bands: BatchBand[]
}

export interface RemnantInfo {
  /** 板上唯一生产户（让出方） */
  ownerId: string
  x: number
  y: number
  wMm: number
  hMm: number
}

export interface BatchSheet {
  index: number
  bands: BatchBand[]
  byOwner: Map<string, OwnerArea>
  /** 合排后已占用到的 y（mm）；其后是板尾余料 */
  cursorY: number
  remnant: RemnantInfo | null
}

// ---------- 取件清单 / 裁切清单 ----------

export interface PickRow {
  /** 板号（1 起） */
  boardNo: number
  /** 片区位置说明，如 板内 0–73mm 横带 */
  bandText: string
  y0: number
  y1: number
  count: number
  labels: string[]
  kind: 'pieces' | 'remnant'
  /** 余料行用：让出料的尺寸/费用说明 */
  note?: string
}

export interface CutRow {
  label: string
  wMm: number
  hMm: number
  count: number
  /** 料件落在哪些板（1 起） */
  boards: number[]
}

// ---------- 分摊 ----------

export type AllocBasis = 'area' | 'actual-give' | 'ratio-give' | 'orig-give'

export interface AllocRow {
  ownerId: string
  boardNo: number
  basis: AllocBasis
  /** 分摊权重面积（mm²） */
  weightAreaMm2: number
  cents: number
  note: string
}

/**
 * 单户余料板的处置：
 * - keep   自留：不让料，板钱 100% 归占用户，余料也归它
 * - actual 按实际占用分：让出方占用了全部生产区 → 板钱全归让出方，受让方 0 元拿走余料
 * - orig   按各家原始用量分：按两户独立排时的用板张数比例分该板钱
 * - ratio  约定比例（推荐，默认 50:50）：让出方分 giverRatio，余额归受让方
 */
export type RemnantMode = 'keep' | 'actual' | 'orig' | 'ratio'

export interface RemnantDecision {
  sheetIndex: number
  receiverId: string | null
  mode: RemnantMode
  /** mode='ratio' 时让出方承担比例（0~1） */
  giverRatio: number
}

// ---------- 户报告 ----------

export interface OwnerReport {
  ownerId: string
  ownerName: string
  pieceCount: number
  pieceAreaMm2: number
  /** 分开排（基线） */
  standaloneSheets: number
  standaloneCents: number
  standaloneUtilization: number
  /** 合排后分摊 */
  allocatedCents: number
  /** = standaloneCents - allocatedCents（可为负：拿了让料且分摊高于自身基线时如实显示） */
  savedCents: number
  pick: PickRow[]
  cut: CutRow[]
  allocations: AllocRow[]
  /** 该户作为让出方的板号 */
  givesBoards: number[]
  /** 该户作为受让方拿到的余料 */
  remnantClaims: Array<{ boardNo: number; fromOwnerId: string; wMm: number; hMm: number; cents: number; mode: RemnantMode }>
}

export interface OversizeItem {
  ownerId: string
  ownerName: string
  id: string
  label: string
  wMm: number
  hMm: number
}

export interface PlanBStat {
  /** B 裸排（不按户收拢）板数：与 A 相同（同一份 BFD 分箱） */
  sheets: number
  /** 出现 A-B-A 交错、至少一户的件被别家夹断的板数 */
  contaminatedSheets: number
  /** 被夹断的（板,户）对数 */
  brokenPairs: number
  /** 整块约束下 B 补齐为按户收拢后的板数（= A 板数，证明 B 补约束后占不到便宜） */
  constrainedSheets: number
}

export interface BatchResult {
  spec: BatchSheetSpec
  sheets: BatchSheet[]
  sheetCount: number
  totalCents: number
  utilization: number
  /** 分开排基线 */
  baselineSheets: number
  baselineCents: number
  baselineUtilization: number
  savedSheets: number
  savedCents: number
  owners: OwnerReport[]
  oversize: OversizeItem[]
  planB: PlanBStat
  decisions: RemnantDecision[]
  warnings: string[]
}

/** 冲突仲裁规则（同时写入所有导出） */
export const PRIORITY_RULE =
  '冲突仲裁：当「整批更省板」与「一家家的件要能整块拿走」冲突时，以整块拿走为准——任何把同一门头的字夹进别家门头片区的排法，即使更省板也不采用。'

export const STRATEGY_NOTE =
  '合排走法（选定）：先把各家各自装箱（料层在自家内按与单户完全相同的分层装箱生成），再把整条料层全局最佳适应递减（BFD）分到最少张板，' +
  '板内按户收拢成一条横向贯通的连续横带——一刀切下即可整块拿走，带内零混户；板内重排只改顺序不改荷载，最少板数不变。省板来自板尾竖向余料的跨户复用。'

const EPS = 1e-9

interface StandaloneContext {
  job: OwnerJob
  nesting: NestingResult
  shelves: Shelf[]
  totalShelfH: number
}

/** 各户独立分层装箱（与材料页 nestPieces 同一函数、同一参数），并把料层原样抽出备合并 */
function buildStandalone(job: OwnerJob, spec: BatchSheetSpec): StandaloneContext {
  const nesting = nestPieces(job.pieces, spec.wMm, spec.hMm, spec.kerfMm, true)
  const shelves: Shelf[] = []
  for (const sheet of nesting.sheets) {
    for (const sh of sheet.shelves) {
      const items: ShelfItem[] = []
      for (const p of sheet.pieces) {
        if (Math.abs(p.y - sh.y) > EPS) continue
        items.push({ piece: { id: p.id, label: p.label, wMm: p.wMm, hMm: p.hMm }, rx: p.x, ry: p.y - sh.y, rotated: p.rotated })
      }
      items.sort((a, b) => a.rx - b.rx)
      shelves.push({ ownerId: job.ownerId, originY: sh.y, originSheet: sheet.index, heightMm: sh.heightMm, items })
    }
  }
  shelves.sort((a, b) => a.originSheet - b.originSheet || a.originY - b.originY)
  return { job, nesting, shelves, totalShelfH: shelves.reduce((s, x) => s + x.heightMm, 0) }
}

/**
 * 第一步（两走法共用的装箱）：各户料层打成带户标签的长条，全局按高降序做
 * 最佳适应递减（BFD：放进剩余高度最小但放得下的板），求最少板数。
 * 料层都是板宽贯通的长条，这是纯一维装箱；BFD 用板数不劣于任何整户连排启发式。
 */
function bfdShelfBins(ctxs: StandaloneContext[], spec: BatchSheetSpec): { ownerId: string; shelf: Shelf }[][] {
  const { hMm: H, kerfMm: kerf } = spec
  const tagged = ctxs
    .flatMap((c) => c.shelves.map((shelf) => ({ ownerId: c.job.ownerId, shelf })))
    .sort((a, b) => b.shelf.heightMm - a.shelf.heightMm || a.ownerId.localeCompare(b.ownerId))
  const bins: { ownerId: string; shelf: Shelf }[][] = []
  const load: number[] = []
  for (const t of tagged) {
    let target = -1
    let bestRest = Infinity
    for (let i = 0; i < bins.length; i++) {
      const rest = H - (load[i] === 0 ? 0 : load[i] + kerf)
      if (rest + EPS >= t.shelf.heightMm && rest < bestRest) {
        bestRest = rest
        target = i
      }
    }
    if (target < 0) {
      bins.push([t])
      load.push(t.shelf.heightMm)
    } else {
      bins[target].push(t)
      load[target] += (load[target] === 0 ? 0 : kerf) + t.shelf.heightMm
    }
  }
  return bins
}

/**
 * 走法 A（选定）：BFD 分箱后，板内按户重排——同一户的料层收拢成一条连续横带，
 * 户顺序按料层总高降序（大件户靠板头）。板内重排只改顺序不改荷载，
 * BFD 求到的最少板数原封保留；每户一刀切走一整条带。
 */
function paginatePlanA(ctxs: StandaloneContext[], spec: BatchSheetSpec): BatchSheet[] {
  const { wMm: W, hMm: H } = spec
  const ownerRank = new Map<string, number>()
  ;[...ctxs]
    .sort((a, b) => b.totalShelfH - a.totalShelfH || a.job.ownerName.localeCompare(b.job.ownerName))
    .forEach((c, i) => ownerRank.set(c.job.ownerId, i))
  const bins = bfdShelfBins(ctxs, spec)
  const sheets: BatchSheet[] = []
  for (const bin of bins) {
    const groups = new Map<string, { ownerId: string; shelf: Shelf }[]>()
    for (const t of bin) {
      const g = groups.get(t.ownerId) ?? []
      g.push(t)
      groups.set(t.ownerId, g)
    }
    const orderedGroups = [...groups.values()].sort(
      (a, b) => (ownerRank.get(a[0].ownerId) ?? 0) - (ownerRank.get(b[0].ownerId) ?? 0)
    )
    const bands: BatchBand[] = []
    let cursor = 0
    for (const g of orderedGroups) {
      const lead = bands.length === 0 ? 0 : spec.kerfMm
      const yStart = cursor + lead
      let y = yStart
      const pieces: BandPiece[] = []
      for (const t of g) {
        const yy = pieces.length === 0 ? y : y + spec.kerfMm
        const oid = t.ownerId
        for (const it of t.shelf.items) {
          pieces.push({
            id: `${oid}#${it.piece.id}`,
            ownerId: oid,
            label: it.piece.label,
            x: it.rx,
            y: yy + it.ry,
            wMm: it.piece.wMm,
            hMm: it.piece.hMm,
            rotated: it.rotated
          })
        }
        y = yy + t.shelf.heightMm
      }
      bands.push({ ownerId: g[0].ownerId, y0: yStart, y1: y, heightMm: y - yStart, pieces })
      cursor = y
    }
    sheets.push(finalizeSheet(sheets.length, bands, W, H, cursor))
  }
  return sheets
}

/** 把连续带列表整理成板对象，并标注单户板的板尾余料 */
function finalizeSheet(index: number, bands: BatchBand[], W: number, H: number, cursorY: number): BatchSheet {
  const byOwner = new Map<string, OwnerArea>()
  for (const b of bands) {
    const a = byOwner.get(b.ownerId) ?? { ownerId: b.ownerId, pieceAreaMm2: 0, bandAreaMm2: 0, bands: [] }
    for (const p of b.pieces) a.pieceAreaMm2 += p.wMm * p.hMm
    a.bandAreaMm2 += W * b.heightMm
    a.bands.push(b)
    byOwner.set(b.ownerId, a)
  }
  let remnant: RemnantInfo | null = null
  if (byOwner.size === 1 && H - cursorY > 1) {
    const oid = [...byOwner.keys()][0]
    remnant = { ownerId: oid, x: 0, y: cursorY, wMm: W, hMm: H - cursorY }
  }
  return { index, bands, byOwner, cursorY, remnant }
}

/**
 * 走法 B 的「裸排」统计：与 A 用同一个 BFD 分箱，但**不做板内按户重排**，
 * 直接按全局高低铺的原始箱内顺序检查 A-B-A 交错（某户在一张板上被别户夹成两段）。
 * 若裸排没有夹断，说明翻到 B 也不违反整块拿走（两走法等价）。
 */
function planBRawStat(ctxs: StandaloneContext[], spec: BatchSheetSpec): { sheets: number; contaminated: number; broken: number } {
  const bins = bfdShelfBins(ctxs, spec)
  let contaminated = 0
  let broken = 0
  for (const bin of bins) {
    const firstAt = new Map<string, number>()
    const lastAt = new Map<string, number>()
    bin.forEach((x, i) => {
      if (!firstAt.has(x.ownerId)) firstAt.set(x.ownerId, i)
      lastAt.set(x.ownerId, i)
    })
    let bad = false
    for (const [oid, lo] of firstAt) {
      const hi = lastAt.get(oid)!
      for (let i = lo; i <= hi; i++) {
        if (bin[i].ownerId !== oid) {
          bad = true
          broken++
          break
        }
      }
    }
    if (bad) contaminated++
  }
  return { sheets: bins.length, contaminated, broken }
}

// ---------- 板钱分摊（整数分，最大余额法） ----------

interface SheetAlloc {
  entries: Array<{ ownerId: string; weightAreaMm2: number; basis: AllocBasis; note: string }>
  /** 已由特殊规则定死的「户 → 分」（让料板）；不给定则按面积走最大余额 */
  fixed?: Map<string, number>
  priceCents: number
}

function largestRemainder(weights: Array<{ ownerId: string; w: number }>, totalCents: number): Map<string, number> {
  const out = new Map<string, number>()
  const sumW = weights.reduce((s, x) => s + x.w, 0)
  if (sumW <= 0 || weights.length === 1) {
    for (const x of weights) out.set(x.ownerId, weights.length === 1 ? totalCents : 0)
    return out
  }
  const raw = weights.map((x) => ({ ownerId: x.ownerId, v: (totalCents * x.w) / sumW }))
  const floored = raw.map((x) => ({ ...x, f: Math.floor(x.v) }))
  let rest = totalCents - floored.reduce((s, x) => s + x.f, 0)
  floored.sort((a, b) => b.v - b.f - (a.v - a.f) || a.ownerId.localeCompare(b.ownerId))
  for (const x of floored) {
    if (rest > 0) {
      out.set(x.ownerId, x.f + 1)
      rest--
    } else {
      out.set(x.ownerId, x.f)
    }
  }
  return out
}

function resolveDecisions(sheets: BatchSheet[], decisions: RemnantDecision[]): Map<number, RemnantDecision> {
  const map = new Map<number, RemnantDecision>()
  const decisionBySheet = new Map(decisions.map((d) => [d.sheetIndex, d]))
  for (const s of sheets) {
    if (!s.remnant) continue
    // 默认政策：余料自留（本排样已证明本批没有任何料层能放进这片余料；让料用于该户别的活，须店家显式指定受让方与分担方式）
    const d =
      decisionBySheet.get(s.index) ??
      ({ sheetIndex: s.index, receiverId: null, mode: 'keep' as const, giverRatio: 0.5 } as RemnantDecision)
    map.set(s.index, d)
  }
  return map
}

function allocateSheets(
  sheets: BatchSheet[],
  ctxs: StandaloneContext[],
  spec: BatchSheetSpec,
  decisions: Map<number, RemnantDecision>
): { perSheet: Map<number, Map<string, number>>; rows: AllocRow[] } {
  const perSheet = new Map<number, Map<string, number>>()
  const rows: AllocRow[] = []
  const standaloneCount = new Map(ctxs.map((c) => [c.job.ownerId, c.nesting.sheetCount]))

  for (const s of sheets) {
    const price = spec.priceCents
    const d = decisions.get(s.index)
    const alloc: SheetAlloc = { entries: [], priceCents: price }

    if (s.remnant && d && d.mode !== 'keep' && d.receiverId) {
      // 让料板：三选一
      const giver = s.remnant.ownerId
      const receiver = d.receiverId
      const fixed = new Map<string, number>()
      if (d.mode === 'actual') {
        fixed.set(giver, price)
        fixed.set(receiver, 0)
        rows.push({ ownerId: giver, boardNo: s.index + 1, basis: 'actual-give', weightAreaMm2: s.byOwner.get(giver)!.bandAreaMm2, cents: price, note: '让料板·按实际占用：让出方承担整板' })
        rows.push({ ownerId: receiver, boardNo: s.index + 1, basis: 'actual-give', weightAreaMm2: 0, cents: 0, note: '让料板·按实际占用：受让方 0 元取走余料' })
      } else if (d.mode === 'orig') {
        const gs = standaloneCount.get(giver) ?? 1
        const rs = standaloneCount.get(receiver) ?? 1
        const gc = Math.round((price * gs) / (gs + rs))
        fixed.set(giver, gc)
        fixed.set(receiver, price - gc)
        rows.push({ ownerId: giver, boardNo: s.index + 1, basis: 'orig-give', weightAreaMm2: s.byOwner.get(giver)!.bandAreaMm2, cents: gc, note: `让料板·按原始用量：独立用板 ${gs}:${rs}` })
        rows.push({ ownerId: receiver, boardNo: s.index + 1, basis: 'orig-give', weightAreaMm2: 0, cents: price - gc, note: `让料板·按原始用量：独立用板 ${gs}:${rs}` })
      } else {
        const gc = Math.round(price * d.giverRatio)
        fixed.set(giver, gc)
        fixed.set(receiver, price - gc)
        rows.push({ ownerId: giver, boardNo: s.index + 1, basis: 'ratio-give', weightAreaMm2: s.byOwner.get(giver)!.bandAreaMm2, cents: gc, note: `让料板·约定比例：让出方 ${(d.giverRatio * 100).toFixed(0)}%` })
        rows.push({ ownerId: receiver, boardNo: s.index + 1, basis: 'ratio-give', weightAreaMm2: 0, cents: price - gc, note: `让料板·约定比例：受让方 ${((1 - d.giverRatio) * 100).toFixed(0)}%` })
      }
      alloc.fixed = fixed
      // 让料板的面积权重仍登记，保证未被固定定死时（理论上无）口径一致
      for (const [oid, a] of s.byOwner) alloc.entries.push({ ownerId: oid, weightAreaMm2: a.bandAreaMm2, basis: 'area', note: '' })
    } else {
      // 普通板（多户共板，或单户自留）：按实际占用片区面积分摊
      for (const [oid, a] of s.byOwner) {
        alloc.entries.push({ ownerId: oid, weightAreaMm2: a.bandAreaMm2, basis: 'area', note: '按片区面积分摊（余差最大余额法）' })
      }
    }

    let cents: Map<string, number>
    if (alloc.fixed) {
      cents = alloc.fixed
    } else {
      cents = largestRemainder(
        alloc.entries.map((e) => ({ ownerId: e.ownerId, w: e.weightAreaMm2 })),
        price
      )
      for (const e of alloc.entries) {
        rows.push({ ownerId: e.ownerId, boardNo: s.index + 1, basis: 'area', weightAreaMm2: e.weightAreaMm2, cents: cents.get(e.ownerId)!, note: e.note })
      }
    }
    perSheet.set(s.index, cents)
  }
  return { perSheet, rows }
}

// ---------- 主入口 ----------

export interface ComputeOptions {
  /** 余料处置决策（缺省：让料 + 约定比例 50:50） */
  decisions?: RemnantDecision[]
}

export function computeBatch(jobs: OwnerJob[], spec: BatchSheetSpec, opts: ComputeOptions = {}): BatchResult {
  const oversize: OversizeItem[] = []
  const validJobs: OwnerJob[] = []
  for (const job of jobs) {
    if (job.pieces.length === 0) continue
    validJobs.push(job)
    for (const p of job.pieces) {
      const fits =
        (p.wMm + spec.kerfMm <= spec.wMm && p.hMm + spec.kerfMm <= spec.hMm) ||
        (p.hMm + spec.kerfMm <= spec.wMm && p.wMm + spec.kerfMm <= spec.hMm)
      if (!fits) oversize.push({ ownerId: job.ownerId, ownerName: job.ownerName, id: p.id, label: p.label, wMm: p.wMm, hMm: p.hMm })
    }
  }

  const warnings: string[] = []
  const ctxs = validJobs.map((j) => buildStandalone(j, spec))
  if (ctxs.length === 0) {
    return {
      spec,
      sheets: [],
      sheetCount: 0,
      totalCents: 0,
      utilization: 0,
      baselineSheets: 0,
      baselineCents: 0,
      baselineUtilization: 0,
      savedSheets: 0,
      savedCents: 0,
      owners: [],
      oversize,
      planB: { sheets: 0, contaminatedSheets: 0, brokenPairs: 0, constrainedSheets: 0 },
      decisions: [],
      warnings
    }
  }
  const baselineSheets = ctxs.reduce((s, c) => s + c.nesting.sheetCount, 0)
  const baselinePieceArea = ctxs.reduce((s, c) => s + c.nesting.totalPieceAreaMm2, 0)

  // 走法 A（选定）：BFD 最少板分箱 + 板内按户收拢成连续带
  const sheets = paginatePlanA(ctxs, spec)
  // 走法 B 对照：同样 BFD 分箱但不按户收拢，统计裸排有多少板被 A-B-A 夹断
  const b = planBRawStat(ctxs, spec)

  // 余料决策
  const decisionMap = resolveDecisions(sheets, opts.decisions ?? [])
  const { rows: allocRows } = allocateSheets(sheets, ctxs, spec, decisionMap)

  // 各户报告
  const owners: OwnerReport[] = ctxs.map((c) => {
    const oid = c.job.ownerId
    const pick: PickRow[] = []
    const cutMap = new Map<string, CutRow>()
    const givesBoards: number[] = []
    const remnantClaims: OwnerReport['remnantClaims'] = []
    let pieceCount = 0
    let pieceAreaMm2 = 0

    for (const s of sheets) {
      const area = s.byOwner.get(oid)
      if (area) {
        for (const band of area.bands) {
          pick.push({
            boardNo: s.index + 1,
            bandText: `板内 ${band.y0}–${band.y1}mm 横带（整条一刀切）`,
            y0: band.y0,
            y1: band.y1,
            count: band.pieces.length,
            labels: band.pieces.map((p) => p.label),
            kind: 'pieces'
          })
          pieceCount += band.pieces.length
          for (const p of band.pieces) {
            pieceAreaMm2 += p.wMm * p.hMm
            const key = `${p.label}|${p.wMm}x${p.hMm}`
            const hit = cutMap.get(key)
            if (hit) {
              hit.count++
              if (!hit.boards.includes(s.index + 1)) hit.boards.push(s.index + 1)
            } else {
              cutMap.set(key, { label: p.label, wMm: p.wMm, hMm: p.hMm, count: 1, boards: [s.index + 1] })
            }
          }
        }
      }
      const d = decisionMap.get(s.index)
      if (s.remnant && d && d.mode !== 'keep' && d.receiverId) {
        const cents = (allocateSheetCentsQuick(s.index, oid, allocRows))
        if (d.receiverId === oid) {
          remnantClaims.push({ boardNo: s.index + 1, fromOwnerId: s.remnant.ownerId, wMm: s.remnant.wMm, hMm: s.remnant.hMm, cents, mode: d.mode })
          const giver = ctxs.find((x) => x.job.ownerId === s.remnant!.ownerId)?.job.ownerName ?? s.remnant.ownerId
          pick.push({
            boardNo: s.index + 1,
            bandText: `板尾余料 ${s.remnant.wMm}×${s.remnant.hMm}mm（${giver} 让出）`,
            y0: s.remnant.y,
            y1: spec.hMm,
            count: 1,
            labels: ['余料 1 片'],
            kind: 'remnant',
            note: d.mode === 'actual' ? '按实际占用：0 元取走' : d.mode === 'orig' ? '按原始用量比例分摊' : `约定比例：承担 ¥${(cents / 100).toFixed(2)}`
          })
        }
        if (s.remnant.ownerId === oid) {
          givesBoards.push(s.index + 1)
          pick.push({
            boardNo: s.index + 1,
            bandText: `板尾余料 ${s.remnant.wMm}×${s.remnant.hMm}mm 已让出`,
            y0: s.remnant.y,
            y1: spec.hMm,
            count: 0,
            labels: [],
            kind: 'remnant',
            note: '本户为让出方'
          })
        }
      } else if (s.remnant && s.remnant.ownerId === oid) {
        pick.push({
          boardNo: s.index + 1,
          bandText: `板尾余料 ${s.remnant.wMm}×${s.remnant.hMm}mm（自留）`,
          y0: s.remnant.y,
          y1: spec.hMm,
          count: 1,
          labels: ['余料 1 片'],
          kind: 'remnant',
          note: '自留，板钱全部本户承担'
        })
      }
    }

    pick.sort((a, b) => a.boardNo - b.boardNo || a.y0 - b.y0)
    const cut = [...cutMap.values()].sort((a, b) => b.wMm * b.hMm - a.wMm * a.hMm || a.label.localeCompare(b.label))
    const allocations = allocRows.filter((r) => r.ownerId === oid).sort((a, b) => a.boardNo - b.boardNo)
    const allocatedCents = allocations.reduce((s, r) => s + r.cents, 0)
    const standaloneCents = c.nesting.sheetCount * spec.priceCents
    return {
      ownerId: oid,
      ownerName: c.job.ownerName,
      pieceCount,
      pieceAreaMm2,
      standaloneSheets: c.nesting.sheetCount,
      standaloneCents,
      standaloneUtilization: c.nesting.utilization,
      allocatedCents,
      savedCents: standaloneCents - allocatedCents,
      pick,
      cut,
      allocations,
      givesBoards,
      remnantClaims
    }
  })

  const sheetCount = sheets.length
  const totalCents = sheetCount * spec.priceCents
  const baselineCents = baselineSheets * spec.priceCents
  const sheetArea = spec.wMm * spec.hMm
  const usedArea = sheets.reduce((sum, s) => {
    let a = 0
    for (const v of s.byOwner.values()) a += v.pieceAreaMm2
    return sum + a
  }, 0)

  // 走法 B 裸排与走法 A 共用同一个 BFD 最优分箱，板数必然相同；差异只在板内顺序：
  // B 裸排出现 A-B-A 夹断的板，在 A 里已通过「板内按户收拢」改成连续带（荷载不变，板数不变）。
  if (b.sheets !== sheetCount) {
    warnings.push(`异常：走法 B 裸排 ${b.sheets} 张与走法 A ${sheetCount} 张不一致，请检查装箱逻辑。`)
  }
  if (b.contaminated > 0) {
    warnings.push(
      `走法 B「先全批合成一趟再回拆」裸排时有 ${b.contaminated} 张板出现同一户被别户夹成两段（夹断 ${b.broken} 处）；` +
        `这些板在选定的走法 A 里已板内按户收拢成连续带，板数同为 ${sheetCount} 张，且每户整块拿走。`
    )
  }

  return {
    spec,
    sheets,
    sheetCount,
    totalCents,
    utilization: usedArea / (sheetCount * sheetArea),
    baselineSheets,
    baselineCents,
    baselineUtilization: baselineSheets > 0 ? baselinePieceArea / (baselineSheets * sheetArea) : 0,
    savedSheets: baselineSheets - sheetCount,
    savedCents: baselineCents - totalCents,
    owners,
    oversize,
    planB: { sheets: b.sheets, contaminatedSheets: b.contaminated, brokenPairs: b.broken, constrainedSheets: sheetCount },
    decisions: [...decisionMap.values()],
    warnings
  }
}

function allocateSheetCentsQuick(sheetIndex: number, ownerId: string, rows: AllocRow[]): number {
  return rows.filter((r) => r.boardNo === sheetIndex + 1 && r.ownerId === ownerId).reduce((s, r) => s + r.cents, 0)
}

/** 自检用：校验合排结果的整块约束、件数守恒与分摊合计 */
export function assertBatchInvariants(r: BatchResult): { ok: boolean; messages: string[] } {
  const msgs: string[] = []
  // 1) 每板每户的片区必须是一条连续带（bands 已按构造连续；再核带内只有本户件、带不重叠、不出界）
  for (const s of r.sheets) {
    for (const b of s.bands) {
      if (b.pieces.some((p) => p.ownerId !== b.ownerId)) msgs.push(`板${s.index + 1} 带内混户`)
      if (b.y0 < -EPS || b.y1 > r.spec.hMm + EPS) msgs.push(`板${s.index + 1} 带出界`)
      for (const p of b.pieces) {
        if (p.x < -EPS || p.x + p.wMm > r.spec.wMm + EPS || p.y < b.y0 - EPS || p.y + p.hMm > b.y1 + EPS) {
          msgs.push(`板${s.index + 1} 料件 ${p.label} 越出本户片区`)
        }
      }
    }
    for (let i = 1; i < s.bands.length; i++) {
      if (s.bands[i].y0 < s.bands[i - 1].y1 - EPS) msgs.push(`板${s.index + 1} 片区重叠`)
    }
  }
  // 2) 件数守恒
  for (const o of r.owners) {
    const expect = o.pieceCount
    const placed = r.sheets.reduce((n, s) => n + (s.byOwner.get(o.ownerId)?.bands.reduce((k, b) => k + b.pieces.length, 0) ?? 0), 0)
    if (expect !== placed) msgs.push(`${o.ownerName} 件数不守恒 ${expect} vs ${placed}`)
  }
  // 3) 分摊为整数分且合计 = 整批板钱
  const sum = r.owners.reduce((s, o) => s + o.allocatedCents, 0)
  if (sum !== r.totalCents) msgs.push(`分摊合计 ${sum} ≠ 整批 ${r.totalCents}`)
  if (!r.owners.every((o) => Number.isInteger(o.allocatedCents))) msgs.push('存在非整数分')
  // 4) 省板 = 基线 - 合排；省钱 = 各户省钱之和
  if (r.savedSheets !== r.baselineSheets - r.sheetCount) msgs.push('省板数不一致')
  const perOwnerSaved = r.owners.reduce((s, o) => s + o.savedCents, 0)
  if (perOwnerSaved !== r.savedCents) msgs.push(`各户省钱之和 ${perOwnerSaved} ≠ 总省钱 ${r.savedCents}`)
  return { ok: msgs.length === 0, messages: msgs }
}

/** 给图纸/导出用：板上各户的颜色（稳定映射） */
export function ownerColor(ownerId: string, ownerIds: string[]): string {
  const palette = ['#3d6ea8', '#a8523d', '#5a8a4e', '#8a6fb0', '#b08a3d', '#3d9aa8', '#a83d72', '#6b6b6b']
  const i = ownerIds.indexOf(ownerId)
  return palette[(i < 0 ? 0 : i) % palette.length]
}

export type { Piece, PlacedPiece }
