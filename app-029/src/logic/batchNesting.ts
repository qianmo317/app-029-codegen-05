/**
 * 集中开料引擎（多门头同批拼版）：
 *
 * 硬约束（冲突时以此为准，写进所有导出说明）：
 *   「一家人家的件要能整块拿走」优先于「整批最省板」——任何排法都不许把
 *   同一门头的字混进别家门头的区域；一张板上每家门头只占一个横向贯通、
 *   可一刀切分的整片区域（region）。宁可多开一张板，也不拆碎任何一家。
 *
 * 两种合排走法都实现、都能省板，本场景按既定准则二选一：
 *   - A 先装箱再合并：各家用与单排完全相同的分层装箱各自切出料条，
 *     再按门头把料条竖向合并到同一批板上（同板各家=上下整片）；
 *   - B 先合排再回拆：全批料件不分门头做一趟分层装箱，层内再按门头竖切回拆。
 *   翻转条件（同时满足才从 A 翻到 B）：B 至少多省 1 张板，且全批整块区域数
 *   不比 A 多（取件分检成本不增加）。选定后整批排样/取件/裁切/分摊/导出全走它。
 *
 * 板钱分摊（整数分，最大余数法）：
 *   每家分摊之和必须精确等于 板数 × 板单价；除不尽的零头按各家实际占用面积
 *   由大到小补 1 分，并在分摊明细里列出「尾差」。
 *   让料板（A 走法下一张板只剩一家的活、板边料让给下一家）的三选一规则：
 *   actual  按实际占用面积分（默认；与通用口径一致，分账一定对得齐）
 *   origin  按各家原始用量分（板钱全归让出方，受让方白用——让出方多掏）
 *   agreed  让出/受让双方按约定比例分担尾料（默认 50:50，尾差 1 分归让出方）
 */

import type { Piece } from './nesting'

export type BatchStrategy = 'A_packThenMerge' | 'B_mergeThenSplit'
export type LetPolicy = 'actual' | 'origin' | 'agreed'

export interface OwnerInput {
  /** 门头（项目）id */
  id: string
  name: string
  pieces: Piece[]
}

export interface BatchOptions {
  sheetW: number
  sheetH: number
  kerfMm: number
  /** 每张板单价（分） */
  priceCents: number
  /** 让料板分账规则 */
  letPolicy?: LetPolicy
  /** agreed 规则下受让方承担尾料占用的比例（0~1），默认 0.5 */
  agreedReceiverRatio?: number
}

export interface BatchPlacedPiece {
  pieceId: string
  label: string
  ownerId: string
  x: number
  y: number
  wMm: number
  hMm: number
  rotated: boolean
}

/** 整块区域：一张板上一家门头独占的一片，可一刀切分、整片拿走。
 *  A 走法：x0=0/x1=板宽 的横贯通条（水平一刀切）；
 *  B 走法：料条内按门头竖切出的矩形段（竖切一刀回拆），同一家在一张板上可有多片。 */
export interface BatchRegion {
  sheetIndex: number
  ownerId: string
  x0: number
  y0: number
  x1: number
  y1: number
  widthMm: number
  heightMm: number
  pieceCount: number
  /** 该家落在这片区域里的料件外接矩形面积合计 mm²（=实际占用口径） */
  usedAreaMm2: number
}

export interface BatchSheet {
  index: number
  pieces: BatchPlacedPiece[]
  regions: BatchRegion[]
  /**
   * 一刀切分线：
   *  horizontalCutYs：横向贯通线（A 的区域分界与料条层线，也含 B 的料条层线）；
   *  verticalCuts：B 走法层内按门头竖切的回拆线（在某料条高度范围内）。
   */
  horizontalCutYs: number[]
  verticalCuts: Array<{ x: number; y0: number; y1: number }>
  usedAreaMm2: number
  sheetAreaMm2: number
  utilization: number
  ownerIds: string[]
  /** 让料板标记（A 走法：先放的一家把板边料让给了后放的一家） */
  letInfo: LetInfo | null
}

export interface LetInfo {
  /** 开板首户（让出方） */
  giverId: string
  /** 按让入顺序排列的受让方（可能多家） */
  receiverIds: string[]
  /** 让出的板边尾料尺寸：全宽 × 高 mm（到第一家受让区域为止） */
  tailWMm: number
  tailHMm: number
  /** 分账规则（回填分摊后的各家实付，供说明使用） */
  policy: LetPolicy
  /** 按 ids 顺序（首户在前）的实付金额（分） */
  paidCents: number[]
  /** 与 paidCents 对应的 ownerId 顺序 */
  ownerIds: string[]
}

export interface OwnerSheetShare {
  sheetIndex: number
  /** 该板由该家用掉的占用面积 mm² */
  usedAreaMm2: number
  /** 分摊到的板钱（整数分） */
  shareCents: number
  /** 该板上该家的整块区域数（正常=1） */
  regions: number
}

export interface OwnerAllocation {
  ownerId: string
  name: string
  /** 实际占用料件面积合计 mm² */
  usedAreaMm2: number
  pieceCount: number
  /** 合排实际分摊板钱（分） */
  sharedCents: number
  shares: OwnerSheetShare[]
  /** 分开排时板数（按各家自己的装箱结果） */
  separateSheets: number
  /** 分开排时板钱（= separateSheets × 单价） */
  separateCents: number
  /** 合排后「整张板归属数」（该家独占的板 + 合占板按面积折算的零头另列） */
  wholeOwnedSheets: number
  /** 省下的钱（分）= separateCents − sharedCents */
  savedCents: number
}

export interface OwnerPickItem {
  ownerId: string
  sheetIndex: number
  label: string
  wMm: number
  hMm: number
  count: number
}

export interface OwnerCutItem {
  ownerId: string
  label: string
  wMm: number
  hMm: number
  count: number
}

/** 板上只剩一家时，板边剩料能否让给下一家的判定 */
export interface LetOpportunity {
  sheetIndex: number
  ownerId: string
  tailWMm: number
  tailHMm: number
  /** 能否让：板边料是否放得下别家门头的某条料条 */
  canLet: boolean
  note: string
}

export interface StrategyOutcome {
  strategy: BatchStrategy
  label: string
  sheets: BatchSheet[]
  sheetCount: number
  /** 全批整块区域数（取件时需要分检的片数） */
  regionCount: number
  utilization: number
  totalUsedAreaMm2: number
}

export interface BatchNestingResult {
  strategyA: StrategyOutcome
  strategyB: StrategyOutcome
  /** 最终选定并要求处处一致的走法 */
  strategy: BatchStrategy
  chosen: StrategyOutcome
  /** 选定理由 / 另一种为什么在本场景不划算、什么条件才翻到它 */
  decisionNotes: string[]
  /** 冲突仲裁条款（写进导出说明） */
  arbitrationNotes: string[]
  separate: StrategyOutcome
  separateSheetCount: number
  owners: OwnerAllocation[]
  pickList: OwnerPickItem[]
  cutList: OwnerCutItem[]
  letOpportunities: LetOpportunity[]
  oversize: Array<Piece & { ownerId: string }>
  sheetW: number
  sheetH: number
  kerfMm: number
  priceCents: number
  letPolicy: LetPolicy
  agreedReceiverRatio: number
  /** Σ 各家分摊（必须等于 sheetCount × priceCents） */
  totalAllocatedCents: number
  totalCostCents: number
  /** 分开排合计板钱 */
  separateCostCents: number
  savedSheets: number
  savedCents: number
}

// ---------------------------------------------------------------------------
// 分层装箱（与 nesting.ts 同一套 guillotine 口径，抽出供两种走法共用）
// ---------------------------------------------------------------------------

interface Shelf {
  y: number
  heightMm: number
  pieces: BatchPlacedPiece[]
}

interface ShelfPlan {
  shelves: Shelf[]
  /** 各料条累计高度（含锯缝） */
  totalHeight: number
}

/** 对一批已带 owner 的料件做一趟分层装箱，得到料条（不落板；竖向由 placeShelves 分板） */
function packShelves(
  ownedPieces: Array<Piece & { ownerId: string }>,
  sheetW: number,
  kerf: number
): ShelfPlan {
  const sorted = [...ownedPieces].sort(
    (a, b) => Math.max(b.wMm, b.hMm) - Math.max(a.wMm, a.hMm) || b.hMm - a.hMm || a.ownerId.localeCompare(b.ownerId)
  )
  const shelves: Shelf[] = []

  const shelfWidthUsed = (shelf: Shelf): number =>
    shelf.pieces.reduce((m, p) => Math.max(m, p.x + p.wMm), 0)

  for (const p of sorted) {
    const tryPlace = (w: number, h: number, rotated: boolean): boolean => {
      for (const shelf of shelves) {
        if (h > shelf.heightMm + 1e-9) continue
        const used = shelfWidthUsed(shelf)
        if (used + (shelf.pieces.length > 0 ? kerf : 0) + w <= sheetW + 1e-9) {
          shelf.pieces.push({
            pieceId: p.id,
            label: p.label,
            ownerId: p.ownerId,
            x: used + (shelf.pieces.length > 0 ? kerf : 0),
            y: shelf.y,
            wMm: w,
            hMm: h,
            rotated
          })
          return true
        }
      }
      return false
    }
    let placed = tryPlace(p.wMm, p.hMm, false)
    if (!placed) placed = tryPlace(p.hMm, p.wMm, true)
    if (!placed) {
      const rotate = p.wMm + kerf > sheetW && p.hMm + kerf <= sheetW
      const w = rotate ? p.hMm : p.wMm
      const h = rotate ? p.wMm : p.hMm
      // 料条只受板宽约束（横向贯通）；竖向由 placeShelves 跨板分配
      const y = shelves.reduce((m, s) => Math.max(m, s.y + s.heightMm + kerf), 0)
      const shelf: Shelf = { y, heightMm: h, pieces: [] }
      shelves.push(shelf)
      shelf.pieces.push({ pieceId: p.id, label: p.label, ownerId: p.ownerId, x: 0, y, wMm: w, hMm: h, rotated: rotate })
    }
  }
  const totalHeight = shelves.reduce((m, s) => Math.max(m, s.y + s.heightMm), 0)
  return { shelves, totalHeight }
}

interface RawSheet {
  pieces: BatchPlacedPiece[]
  /** 按 y 排好序的料条 */
  shelves: Shelf[]
}

/** 把料条按 FFD 装进板（每条料条横向贯通） */
function placeShelves(shelves: Shelf[], sheetH: number, kerf: number): RawSheet[] {
  const sheets: RawSheet[] = []
  const usedH = (s: RawSheet): number =>
    s.shelves.length === 0 ? 0 : s.shelves.reduce((m, sh) => Math.max(m, sh.y + sh.heightMm), 0)

  for (const shelf of shelves) {
    let target: RawSheet | null = null
    let bestSlack = Infinity
    for (const s of sheets) {
      const used = usedH(s)
      const need = s.shelves.length > 0 ? kerf + shelf.heightMm : shelf.heightMm
      if (used + need <= sheetH + 1e-9) {
        const slack = sheetH - (used + need)
        if (slack < bestSlack) {
          bestSlack = slack
          target = s
        }
      }
    }
    if (!target) {
      target = { pieces: [], shelves: [] }
      sheets.push(target)
    }
    const offset = target.shelves.length > 0 ? usedH(target) + kerf : 0
    const shifted: Shelf = { y: offset, heightMm: shelf.heightMm, pieces: [] }
    for (const pp of shelf.pieces) {
      shifted.pieces.push({ ...pp, y: offset })
    }
    target.shelves.push(shifted)
    target.pieces.push(...shifted.pieces)
  }
  return sheets
}

// ---------------------------------------------------------------------------
// 走法 A：先各家装箱，再按门头合并（同板先「自家板」，再让料给一家）
// ---------------------------------------------------------------------------

function runStrategyA(
  owners: OwnerInput[],
  sheetW: number,
  sheetH: number,
  kerf: number
): { sheets: Array<RawSheet & { maxRejectedLetH: number; maxAcceptedLetH: number; ownerIds: string[] }>; letEvents: LetEvent[] } {
  // 1) 各家各自装箱，得到各自的料条序列（与单排同口径）
  const perOwner = owners.map((o) => {
    const plan = packShelves(
      o.pieces.map((p) => ({ ...p, ownerId: o.id })),
      sheetW,
      kerf
    )
    return { owner: o, shelves: plan.shelves, totalH: plan.totalHeight }
  })
  // 料条总高大的先上板，更容易把小板边料留给后面小户（典型 FFD 排序）
  perOwner.sort((a, b) => b.totalH - a.totalH)

  interface ASheet extends RawSheet {
    ownerIds: string[]
    /** 落板过程中别家曾想让入、但板边料放不下的最高料条 mm */
    maxRejectedLetH: number
    /** 落板过程中成功让入过本板的别家料条最高 mm（用于说明） */
    maxAcceptedLetH: number
  }
  const sheets: ASheet[] = []
  // 记录每次让料事件（哪个家的料条被放进了别家先开的板）
  const letEvents: LetEvent[] = []
  const usedH = (s: ASheet): number => (s.shelves.length === 0 ? 0 : s.shelves.reduce((m, sh) => Math.max(m, sh.y + sh.heightMm), 0))
  const fits = (s: ASheet, shelfH: number): boolean => {
    const need = s.shelves.length > 0 ? kerf + shelfH : shelfH
    return usedH(s) + need <= sheetH + 1e-9
  }

  for (const { owner, shelves } of perOwner) {
    for (const shelf0 of shelves) {
      // 优先塞进该家自己已经在用的板（保证一家在同板连续成片）
      let target = sheets
        .filter((s) => s.ownerIds.includes(owner.id) && fits(s, shelf0.heightMm))
        .sort((a, b) => usedH(b) - usedH(a))[0]
      // 其次让料：任何还没有本家的板都可让入（让完本家仍是板上一整片上下通条），
      // 首家开板的即「让出方」；best-fit 进余料最紧的板。
      let letFrom: string | null = null
      if (!target) {
        let bestSlack = Infinity
        for (const s of sheets) {
          if (s.ownerIds.includes(owner.id)) continue
          if (fits(s, shelf0.heightMm)) {
            const need = kerf + shelf0.heightMm
            const slack = sheetH - (usedH(s) + need)
            if (slack < bestSlack) {
              bestSlack = slack
              target = s
              letFrom = s.ownerIds[0] // 开板首户即让出方
            }
          } else {
            // 放不下：记下这条别家料条高度，作为该板余料「让不出去」的实测依据
            s.maxRejectedLetH = Math.max(s.maxRejectedLetH, shelf0.heightMm)
          }
        }
      }
      if (!target) {
        const fresh: ASheet = { pieces: [], shelves: [], ownerIds: [], maxRejectedLetH: 0, maxAcceptedLetH: 0 }
        sheets.push(fresh)
        target = fresh
      }
      const offset = target.shelves.length > 0 ? usedH(target) + kerf : 0
      const shelf: Shelf = { y: offset, heightMm: shelf0.heightMm, pieces: [] }
      for (const pp of shelf0.pieces) shelf.pieces.push({ ...pp, y: offset })
      target.shelves.push(shelf)
      target.pieces.push(...shelf.pieces)
      if (!target.ownerIds.includes(owner.id)) target.ownerIds.push(owner.id)
      if (letFrom) {
        letEvents.push({ sheetIndex: sheets.indexOf(target), giverId: letFrom, receiverId: owner.id })
        target.maxAcceptedLetH = Math.max(target.maxAcceptedLetH, shelf0.heightMm)
      }
    }
  }

  return { sheets, letEvents }
}

/** 让料事件：receiver 的料条进了 giver 先开的板（一张板可连续让给多家） */
interface LetEvent {
  sheetIndex: number
  giverId: string
  receiverId: string
}

// ---------------------------------------------------------------------------
// 走法 B：全批合排一趟，层内再按门头竖切回拆
// ---------------------------------------------------------------------------

function runStrategyB(
  owners: OwnerInput[],
  sheetW: number,
  sheetH: number,
  kerf: number
): RawSheet[] {
  const all: Array<Piece & { ownerId: string }> = []
  for (const o of owners) for (const p of o.pieces) all.push({ ...p, ownerId: o.id })
  const { shelves: globalShelves } = packShelves(all, sheetW, kerf)

  // 层内按门头重排：同一 owner 的件并成连续一段（层内竖切即可回拆）。
  // 重排只改变 x 顺序、不改变层高与件数，宽度可行性不变（总宽未变）。
  const reordered: Shelf[] = globalShelves.map((shelf) => {
    const groups = new Map<string, BatchPlacedPiece[]>()
    for (const pp of shelf.pieces) {
      const hit = groups.get(pp.ownerId) ?? []
      hit.push(pp)
      groups.set(pp.ownerId, hit)
    }
    const out: BatchPlacedPiece[] = []
    let cursorX = 0
    // 按该层内该家占用宽度降序，大段靠左，减少竖切次数
    const entries = [...groups.entries()].sort(
      (a, b) =>
        b[1].reduce((m, p) => m + p.wMm, 0) - a[1].reduce((m, p) => m + p.wMm, 0) || a[0].localeCompare(b[0])
    )
    for (const [, ps] of entries) {
      for (let i = 0; i < ps.length; i++) {
        const src = ps[i]
        out.push({ ...src, x: cursorX })
        cursorX += src.wMm + (i < ps.length - 1 ? kerf : 0)
      }
      cursorX += kerf // 组间竖切锯缝
    }
    // 末组多余锯缝不影响落位（最后一组右边是板边/空料）
    return { y: shelf.y, heightMm: shelf.heightMm, pieces: out }
  })

  return placeShelves(reordered, sheetH, kerf)
}

// ---------------------------------------------------------------------------
// 原始结果 → 区域 / 统计
// ---------------------------------------------------------------------------

function finalizeOutcome(
  strategy: BatchStrategy,
  label: string,
  raw: RawSheet[],
  sheetW: number,
  sheetH: number
): StrategyOutcome {
  const sheets: BatchSheet[] = raw.map((rs, idx) => {
    const regions: BatchRegion[] = []
    const horizontalCutYs: number[] = []
    const verticalCuts: Array<{ x: number; y0: number; y1: number }> = []

    if (strategy === 'A_packThenMerge') {
      // 每条料条只有一家；把连续同家料条并成一个横向贯通整片
      let bandOwner: string | null = null
      let bandY0 = 0
      let bandY1 = 0
      const flushBand = (): void => {
        if (bandOwner === null) return
        const ps = rs.pieces.filter((p) => p.ownerId === bandOwner && p.y + 1e-9 >= bandY0 && p.y < bandY1 - 1e-9)
        regions.push({
          sheetIndex: idx,
          ownerId: bandOwner,
          x0: 0,
          y0: bandY0,
          x1: sheetW,
          y1: bandY1,
          widthMm: sheetW,
          heightMm: bandY1 - bandY0,
          pieceCount: ps.length,
          usedAreaMm2: ps.reduce((m, p) => m + p.wMm * p.hMm, 0)
        })
      }
      rs.shelves.forEach((sh, si) => {
        const id = sh.pieces[0]?.ownerId ?? null
        if (id !== bandOwner) {
          flushBand()
          if (bandOwner !== null && id !== null) horizontalCutYs.push(sh.y) // 两家交界：一刀切透板宽
          bandOwner = id
          bandY0 = sh.y
        }
        bandY1 = sh.y + sh.heightMm
        if (si < rs.shelves.length - 1) horizontalCutYs.push(sh.y + sh.heightMm)
      })
      flushBand()
    } else {      // B：层内已按门头并段，每个 (料条, owner) 连续段 = 一片可竖切回拆的整块
      for (const sh of rs.shelves) {
        horizontalCutYs.push(sh.y + sh.heightMm)
        type Run = { ownerId: string; x0: number; x1: number; pieces: BatchPlacedPiece[] }
        const runs: Run[] = []
        for (const p of [...sh.pieces].sort((a, b) => a.x - b.x)) {
          const last = runs[runs.length - 1]
          if (last && last.ownerId === p.ownerId) {
            last.x1 = Math.max(last.x1, p.x + p.wMm)
            last.pieces.push(p)
          } else {
            runs.push({ ownerId: p.ownerId, x0: p.x, x1: p.x + p.wMm, pieces: [p] })
          }
        }
        runs.forEach((run, ri) => {
          regions.push({
            sheetIndex: idx,
            ownerId: run.ownerId,
            x0: run.x0,
            y0: sh.y,
            x1: run.x1,
            y1: sh.y + sh.heightMm,
            widthMm: run.x1 - run.x0,
            heightMm: sh.heightMm,
            pieceCount: run.pieces.length,
            usedAreaMm2: run.pieces.reduce((m, p) => m + p.wMm * p.hMm, 0)
          })
          // 竖切回拆线：本段右边界（段间交界），切透该料条高度
          if (ri < runs.length - 1) verticalCuts.push({ x: run.x1, y0: sh.y, y1: sh.y + sh.heightMm })
        })
      }
    }
    const hCuts = [...new Set(horizontalCutYs)].filter((y) => y > 1e-9 && y < sheetH - 1e-9).sort((a, b) => a - b)
    const usedAreaMm2 = rs.pieces.reduce((m, p) => m + p.wMm * p.hMm, 0)
    const sheetAreaMm2 = sheetW * sheetH
    const ownerIds = [...new Set(regions.map((r) => r.ownerId))]
    return {
      index: idx,
      pieces: rs.pieces,
      regions,
      horizontalCutYs: hCuts,
      verticalCuts,
      usedAreaMm2,
      sheetAreaMm2,
      utilization: sheetAreaMm2 > 0 ? usedAreaMm2 / sheetAreaMm2 : 0,
      ownerIds,
      letInfo: null
    }
  })

  const totalUsedAreaMm2 = sheets.reduce((m, s) => m + s.usedAreaMm2, 0)
  const sheetAreaTotal = sheets.length * sheetW * sheetH
  return {
    strategy,
    label,
    sheets,
    sheetCount: sheets.length,
    regionCount: sheets.reduce((m, s) => m + s.regions.length, 0),
    utilization: sheetAreaTotal > 0 ? totalUsedAreaMm2 / sheetAreaTotal : 0,
    totalUsedAreaMm2
  }
}

// ---------------------------------------------------------------------------
// 最大余数法分摊（整数分；Σ 分摊精确等于板价）
// ---------------------------------------------------------------------------

function largestRemainder(weights: number[], totalCents: number): { shares: number[]; remainderCents: number } {
  const sumW = weights.reduce((a, b) => a + b, 0)
  if (sumW <= 0) {
    // 没有占用口径（理论不会发生）：全给第 1 家，保证账齐
    const shares = weights.map(() => 0)
    if (shares.length > 0) shares[0] = totalCents
    return { shares, remainderCents: 0 }
  }
  const exact = weights.map((w) => (totalCents * w) / sumW)
  const floor = exact.map((v) => Math.floor(v))
  let remainder = totalCents - floor.reduce((a, b) => a + b, 0)
  // 余数按小数部分从大到小补 1 分；并列时权重高者优先，保证确定性
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v), w: weights[i] }))
    .sort((a, b) => b.frac - a.frac || b.w - a.w || a.i - b.i)
  for (const o of order) {
    if (remainder <= 0) break
    floor[o.i] += 1
    remainder -= 1
  }
  return { shares: floor, remainderCents: totalCents - floor.reduce((a, b) => a + b, 0) }
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

export function planBatchNesting(owners: OwnerInput[], opts: BatchOptions): BatchNestingResult {
  const kerf = Math.max(0, opts.kerfMm)
  const sheetW = opts.sheetW
  const sheetH = opts.sheetH
  const letPolicy: LetPolicy = opts.letPolicy ?? 'actual'
  const agreedReceiverRatio = Math.min(1, Math.max(0, opts.agreedReceiverRatio ?? 0.5))

  // 超板件显式剔除并上报，不静默
  const oversize: Array<Piece & { ownerId: string }> = []
  const fitOwners: OwnerInput[] = owners.map((o) => ({
    ...o,
    pieces: o.pieces.filter((p) => {
      const fits =
        (p.wMm + kerf <= sheetW && p.hMm + kerf <= sheetH) ||
        (p.hMm + kerf <= sheetW && p.wMm + kerf <= sheetH)
      if (!fits) oversize.push({ ...p, ownerId: o.id })
      return fits
    })
  }))

  // 分开排基线：逐家用同一引擎落板
  const sepSheets: RawSheet[] = []
  const sepByOwner = new Map<string, { sheets: RawSheet[]; shelves: Shelf[] }>()
  for (const o of fitOwners) {
    const plan = packShelves(
      o.pieces.map((p) => ({ ...p, ownerId: o.id })),
      sheetW,
      kerf
    )
    const sheets = placeShelves(plan.shelves, sheetH, kerf)
    sepByOwner.set(o.id, { sheets, shelves: plan.shelves })
    sepSheets.push(...sheets)
  }
  const separate = finalizeOutcome('A_packThenMerge', '各家分开排（基线）', sepSheets, sheetW, sheetH)
  const separateSheetCount = separate.sheetCount

  // 走法 A
  const aRun = runStrategyA(fitOwners, sheetW, sheetH, kerf)
  const strategyA = finalizeOutcome('A_packThenMerge', '先各家装箱、再合并排', aRun.sheets, sheetW, sheetH)

  // 走法 B
  const bRaw = runStrategyB(fitOwners, sheetW, sheetH, kerf)
  const strategyB = finalizeOutcome('B_mergeThenSplit', '先全批合排、再按门头回拆', bRaw, sheetW, sheetH)

  // ---- 二选一准则：B 同时满足「至少多省 1 张板」且「区域数不多于 A」才翻到 B ----
  const flipToB = strategyB.sheetCount < strategyA.sheetCount && strategyB.regionCount <= strategyA.regionCount
  const strategy: BatchStrategy = flipToB ? 'B_mergeThenSplit' : 'A_packThenMerge'
  const chosen = flipToB ? strategyB : strategyA

  const decisionNotes: string[] = []
  if (!flipToB) {
    decisionNotes.push(
      `本批选定【走法 A：先各家装箱再合并】。实测：A 用 ${strategyA.sheetCount} 张板、${strategyA.regionCount} 个整块区域；` +
        `B 用 ${strategyB.sheetCount} 张板、${strategyB.regionCount} 个整块区域。`
    )
    if (strategyB.sheetCount < strategyA.sheetCount) {
      decisionNotes.push(
        `B 虽然能再省 ${strategyA.sheetCount - strategyB.sheetCount} 张板，但整块区域数 ${strategyB.regionCount} 多于 A 的 ${strategyA.regionCount}：` +
          `同一条料里夹了多家门头，取件时要按层、再按段两次分检，违背「一家人家的件整块拿走」的现场口径，省的板钱抵不上分拣/错拿成本，所以本场景不选 B。`
      )
    } else {
      decisionNotes.push(
        `B 板数（${strategyB.sheetCount} 张）并未少于 A（${strategyA.sheetCount} 张），在「整块拿走」约束下 B 只会把区域切得更碎（区域数 ${strategyB.regionCount} vs ${strategyA.regionCount}），没有任何好处。`
      )
    }
    decisionNotes.push(
      `翻到 B 的条件（须同时满足）：① B 比 A 至少多省 1 张板；② B 的整块区域数不多于 A（分检片数不增加）。` +
        `通常在门头多（≥6 家）、各家单件形状杂、且能接受层内竖切分检时才会同时成立。`
    )
  } else {
    decisionNotes.push(
      `本批选定【走法 B：先全批合排再按门头回拆】。实测：B 用 ${strategyB.sheetCount} 张板、${strategyB.regionCount} 个整块区域；` +
        `A 用 ${strategyA.sheetCount} 张板、${strategyA.regionCount} 个整块区域。B 至少多省 1 张板且区域数不增加，满足翻转条件。`
    )
    decisionNotes.push(
      `若不满足翻转条件（省不出板、或层内多家混排使区域数变多），仍应回到 A：A 的同板各家上下整片，取件只需沿水平贯通线一刀切、每家一摞。`
    )
  }

  const arbitrationNotes = [
    '冲突仲裁：当「整批更省板」与「一家人家的件要能整块拿走」冲突时，以「整块拿走、不得把同一门头的字混进别家区域」为准；宁可多开板，也不跨门头混排到同一整片区域内。',
    '每张板上每家门头至多一个横向贯通、可一刀切分的整片区域；区域内才允许按料条/料件细切。',
    `本批合排走法已选定「${chosen.label}」，整批排样、取件清单、裁切清单、板钱分摊与全部导出均按此走法，两套算法的结果不混用。`
  ]

  // ---- 让料机会判定（A 走法每张板：板边料是否让给了下一家 / 为什么让不出去） ----
  const letEventsBySheet = new Map<number, LetEvent[]>()
  for (const e of aRun.letEvents) {
    const hit = letEventsBySheet.get(e.sheetIndex) ?? []
    hit.push(e)
    letEventsBySheet.set(e.sheetIndex, hit)
  }
  const letOpportunities: LetOpportunity[] = []
  strategyA.sheets.forEach((sheet, rawIdx) => {
    const raw = aRun.sheets[rawIdx]
    const usedBottom = sheet.regions.reduce((m, r) => Math.max(m, r.y1), 0)
    const tailH = Math.max(0, sheetH - usedBottom)
    const evts = letEventsBySheet.get(sheet.index)
    if (evts && evts.length > 0) {
      // 实际发生让料（首家=让出方，其余为受让方，可多家）
      letOpportunities.push({
        sheetIndex: sheet.index,
        ownerId: evts[0].giverId,
        tailWMm: sheetW,
        tailHMm: tailH,
        canLet: true,
        note: `板边料依次让给 ${evts.length} 家（${evts
          .map((e) => e.receiverId)
          .join(' → ')}，受让料条最高 ${raw.maxAcceptedLetH}mm，让后仍余 ${Math.round(tailH)}mm）；该板钱归属按「${letPolicyLabel(
          letPolicy
        )}」规则分摊，见分摊表`
      })
    } else if (sheet.ownerIds.length === 1) {
      if (tailH <= kerf) {
        letOpportunities.push({ sheetIndex: sheet.index, ownerId: sheet.ownerIds[0], tailWMm: sheetW, tailHMm: 0, canLet: false, note: '板边没有余料（已排满）' })
      } else if (raw.maxRejectedLetH > 0 && raw.maxRejectedLetH + kerf > tailH + 1e-9) {
        letOpportunities.push({
          sheetIndex: sheet.index,
          ownerId: sheet.ownerIds[0],
          tailWMm: sheetW,
          tailHMm: tailH,
          canLet: false,
          note: `板边剩料 ${sheetW}×${Math.round(tailH)}mm，但别家待让料条最矮也有 ${raw.maxRejectedLetH}mm、放不进，不能让；整片余料退库留存，板钱仍由该家承担`
        })
      } else {
        // 该家是最后处理的，后面已无别家可让
        letOpportunities.push({
          sheetIndex: sheet.index,
          ownerId: sheet.ownerIds[0],
          tailWMm: sheetW,
          tailHMm: tailH,
          canLet: false,
          note: `板边剩料 ${sheetW}×${Math.round(tailH)}mm，本家之后已无其他门头排队，无人可让；整片余料退库留存（可留给下一批），板钱仍由该家承担`
        })
      }
    }
  })

  // ---- 板钱分摊（按选定走法的落板结果） ----
  const totalCostCents = chosen.sheetCount * opts.priceCents
  const allocMap = new Map<string, OwnerAllocation>()
  for (const o of fitOwners) {
    allocMap.set(o.id, {
      ownerId: o.id,
      name: o.name,
      usedAreaMm2: 0,
      pieceCount: 0,
      sharedCents: 0,
      shares: [],
      separateSheets: sepByOwner.get(o.id)?.sheets.length ?? 0,
      separateCents: (sepByOwner.get(o.id)?.sheets.length ?? 0) * opts.priceCents,
      wholeOwnedSheets: 0,
      savedCents: 0
    })
  }

  for (const sheet of chosen.sheets) {
    // 按家聚合该板占用（B 走法同家可能有多片区域）
    const areaById = new Map<string, number>()
    const regionCountById = new Map<string, number>()
    const topYById = new Map<string, number>()
    for (const r of sheet.regions) {
      areaById.set(r.ownerId, (areaById.get(r.ownerId) ?? 0) + r.usedAreaMm2)
      regionCountById.set(r.ownerId, (regionCountById.get(r.ownerId) ?? 0) + 1)
      topYById.set(r.ownerId, Math.min(topYById.get(r.ownerId) ?? Infinity, r.y0))
    }
    // A 走法：按最上面的整片排序 = 开板首户（让出方）在前；B 走法按 id 稳定排序
    const ids =
      strategy === 'A_packThenMerge'
        ? [...areaById.keys()].sort((a, b) => (topYById.get(a) ?? 0) - (topYById.get(b) ?? 0))
        : [...areaById.keys()]
    const weights = ids.map((id) => areaById.get(id) ?? 0)
    let sharesCents: number[]
    if (ids.length === 1) {
      sharesCents = [opts.priceCents]
    } else if (strategy === 'A_packThenMerge') {
      // 让料板（首家=让出方，其余按让入顺序）：三选一规则推广到多家
      const totalArea = weights.reduce((a, b) => a + b, 0)
      if (letPolicy === 'origin') {
        // 板是首家开的：板钱全归让出方，受让方白用
        sharesCents = ids.map((_, i) => (i === 0 ? opts.priceCents : 0))
      } else if (letPolicy === 'agreed') {
        // 各受让方就自己实际占用部分按约定比例承担；尾差（含未利用尾料）全部归让出方
        const receiverPaid = ids.map((_, i) =>
          i === 0 ? 0 : Math.round((opts.priceCents * weights[i]) / totalArea * agreedReceiverRatio)
        )
        const giverPaid = opts.priceCents - receiverPaid.reduce((a, b) => a + b, 0)
        sharesCents = [giverPaid, ...receiverPaid.slice(1)]
      } else {
        // actual：按实际占用面积，最大余数法
        sharesCents = largestRemainder(weights, opts.priceCents).shares
      }
    } else {
      // B 走法（层内多家）：一律实际占用面积 + 最大余数法
      sharesCents = largestRemainder(weights, opts.priceCents).shares
    }

    // 回填让料板说明（A 走法多家板：最上方首家是让出方）
    if (ids.length >= 2 && strategy === 'A_packThenMerge') {
      const giverId = ids[0]
      const giverRegion = sheet.regions
        .filter((x) => x.ownerId === giverId)
        .sort((a, b) => a.y0 - b.y0)[0]
      sheet.letInfo = {
        giverId,
        receiverIds: ids.slice(1),
        tailWMm: sheetW,
        tailHMm: Math.max(0, sheetH - giverRegion.y1),
        policy: letPolicy,
        paidCents: sharesCents,
        ownerIds: ids
      }
    }

    ids.forEach((ownerId, i) => {
      const alloc = allocMap.get(ownerId)
      if (!alloc) return
      const ownerRegions = sheet.regions.filter((r) => r.ownerId === ownerId)
      alloc.usedAreaMm2 += areaById.get(ownerId) ?? 0
      alloc.pieceCount += ownerRegions.reduce((m, r) => m + r.pieceCount, 0)
      alloc.shares.push({
        sheetIndex: sheet.index,
        usedAreaMm2: areaById.get(ownerId) ?? 0,
        shareCents: sharesCents[i],
        regions: regionCountById.get(ownerId) ?? 0
      })
    })
  }

  const owners_out = [...allocMap.values()]
  for (const a of owners_out) {
    a.sharedCents = a.shares.reduce((m, s) => m + s.shareCents, 0)
    a.wholeOwnedSheets = chosen.sheets.filter((s) => s.ownerIds.length === 1 && s.ownerIds[0] === a.ownerId).length
    a.savedCents = a.separateCents - a.sharedCents
  }

  // ---- 取件清单（按门头 → 板 → 料件规格汇总） ----
  const pickMap = new Map<string, OwnerPickItem>()
  const cutMap = new Map<string, OwnerCutItem>()
  for (const sheet of chosen.sheets) {
    for (const p of sheet.pieces) {
      const w = p.rotated ? p.hMm : p.wMm
      const h = p.rotated ? p.wMm : p.hMm
      const pk = `${p.ownerId}|${sheet.index}|${p.label}|${p.wMm}x${p.hMm}`
      const hit = pickMap.get(pk)
      if (hit) hit.count++
      else pickMap.set(pk, { ownerId: p.ownerId, sheetIndex: sheet.index, label: p.label, wMm: p.wMm, hMm: p.hMm, count: 1 })
      // 裁切清单按落刀尺寸（旋转后的实际切出尺寸）
      const ck = `${p.ownerId}|${p.label}|${w}x${h}`
      const chit = cutMap.get(ck)
      if (chit) chit.count++
      else cutMap.set(ck, { ownerId: p.ownerId, label: p.label, wMm: w, hMm: h, count: 1 })
    }
  }
  const pickList = [...pickMap.values()].sort(
    (a, b) => a.ownerId.localeCompare(b.ownerId) || a.sheetIndex - b.sheetIndex || b.wMm * b.hMm - a.wMm * a.hMm
  )
  const cutList = [...cutMap.values()].sort(
    (a, b) => a.ownerId.localeCompare(b.ownerId) || b.wMm * b.hMm - a.wMm * a.hMm || a.label.localeCompare(b.label)
  )

  const totalAllocatedCents = owners_out.reduce((m, a) => m + a.sharedCents, 0)
  const separateCostCents = separateSheetCount * opts.priceCents

  return {
    strategyA,
    strategyB,
    strategy,
    chosen,
    decisionNotes,
    arbitrationNotes,
    separate,
    separateSheetCount,
    owners: owners_out,
    pickList,
    cutList,
    letOpportunities,
    oversize,
    sheetW,
    sheetH,
    kerfMm: kerf,
    priceCents: opts.priceCents,
    letPolicy,
    agreedReceiverRatio,
    totalAllocatedCents,
    totalCostCents,
    separateCostCents,
    savedSheets: separateSheetCount - chosen.sheetCount,
    savedCents: separateCostCents - totalCostCents
  }
}

/** 分摊一致性断言：Σ 各家分摊 = 板数 × 板价；且每家分摊 = 其逐板分摊之和 */
export function assertBatchAllocation(r: BatchNestingResult): { ok: boolean; messages: string[] } {
  const messages: string[] = []
  const sumOwners = r.owners.reduce((m, o) => m + o.sharedCents, 0)
  const sumShares = r.owners.reduce(
    (m, o) => m + o.shares.reduce((mm, s) => mm + s.shareCents, 0),
    0
  )
  const perSheetOk = r.chosen.sheets.every((s) => {
    const total = r.owners
      .flatMap((o) => o.shares)
      .filter((sh) => sh.sheetIndex === s.index)
      .reduce((m, sh) => m + sh.shareCents, 0)
    return total === r.priceCents
  })
  const savedOk = r.savedCents === r.owners.reduce((m, o) => m + o.savedCents, 0)
  const ok = sumOwners === r.totalCostCents && sumShares === r.totalCostCents && perSheetOk && savedOk
  messages.push(
    `Σ 各家分摊 = ${sumOwners} 分；整批板钱 = ${r.chosen.sheetCount} 张 × ${r.priceCents} 分 = ${r.totalCostCents} 分；` +
      `逐板分摊合计 = ${sumShares} 分 → ${sumOwners === r.totalCostCents && sumShares === r.totalCostCents ? '账齐（精确到分）' : '对不齐！'}`
  )
  messages.push(`每张板分入各家之和均等于板价：${perSheetOk ? '通过' : '失败'}`)
  messages.push(
    `分开排 ${r.separateSheetCount} 张（¥${(r.separateCostCents / 100).toFixed(2)}）→ 合排 ${r.chosen.sheetCount} 张（¥${(r.totalCostCents / 100).toFixed(2)}），省 ${r.savedSheets} 张、¥${(r.savedCents / 100).toFixed(2)}；各家省钱合计 ${r.owners.reduce((m, o) => m + o.savedCents, 0)} 分 → ${savedOk ? '与整批一致' : '不一致！'}`
  )
  return { ok, messages }
}

/** 整块性校验：每件必须落在本家的某片独占区域内；不同家区域互不重叠 */
export function assertRegionsWhole(r: BatchNestingResult): { ok: boolean; messages: string[] } {
  const msgs: string[] = []
  let ok = true
  for (const s of r.chosen.sheets) {
    // 每件都落在本家某片区域内
    for (const p of s.pieces) {
      const hit = s.regions.some(
        (rg) =>
          rg.ownerId === p.ownerId &&
          p.x + 1e-9 >= rg.x0 &&
          p.y + 1e-9 >= rg.y0 &&
          p.x + p.wMm <= rg.x1 + 1e-9 &&
          p.y + p.hMm <= rg.y1 + 1e-9
      )
      if (!hit) {
        ok = false
        msgs.push(`第 ${s.index + 1} 张板：${p.ownerId} 的件 ${p.label} 不在本家整块区域内（混进别家片）`)
      }
    }
    // 不同家区域两两不重叠
    for (let i = 0; i < s.regions.length; i++) {
      for (let j = i + 1; j < s.regions.length; j++) {
        const a = s.regions[i]
        const b = s.regions[j]
        if (a.ownerId === b.ownerId) continue
        const overlapX = Math.max(a.x0, b.x0) < Math.min(a.x1, b.x1) - 1e-9
        const overlapY = Math.max(a.y0, b.y0) < Math.min(a.y1, b.y1) - 1e-9
        if (overlapX && overlapY) {
          ok = false
          msgs.push(`第 ${s.index + 1} 张板：${a.ownerId} 与 ${b.ownerId} 的整块区域重叠`)
        }
      }
    }
  }
  msgs.push(ok ? '整块性校验通过：同板各家区域互不交叠、沿贯通刀切线即可整片拿走' : '整块性校验失败')
  return { ok, messages: msgs }
}

export function letPolicyLabel(p: LetPolicy): string {
  switch (p) {
    case 'actual':
      return '按实际占用分'
    case 'origin':
      return '按各家原始用量分（板归让出方）'
    case 'agreed':
      return '让出/受让双方按约定比例分担'
  }
}

/** 该家在让料板上实付（分）；非让料板或不在板上返回 null */
export function letPaidCents(sheet: BatchSheet, ownerId: string): number | null {
  if (!sheet.letInfo) return null
  const i = sheet.letInfo.ownerIds.indexOf(ownerId)
  return i >= 0 ? sheet.letInfo.paidCents[i] : null
}

/** 让料板上各家按 (ownerId, paidCents) 的顺序（首家=让出方） */
export function letParticipants(sheet: BatchSheet): Array<{ ownerId: string; paidCents: number; isGiver: boolean }> {
  if (!sheet.letInfo) return []
  return sheet.letInfo.ownerIds.map((id, i) => ({ ownerId: id, paidCents: sheet.letInfo!.paidCents[i], isGiver: i === 0 }))
}
