/**
 * 集中开料导出：取件清单 / 裁切清单 / 分摊结果（CSV），以及一份总表（.xls）。
 * 每份导出都带同一套「合排走法 + 整块优先仲裁 + 让料计价」说明，保证口径处处一致。
 * 纯前端生成，不引入第三方库（与 quote.ts 同一套做法）。
 */

import { PRIORITY_RULE, STRATEGY_NOTE, type BatchResult, type OwnerReport, type RemnantMode } from './batchNesting'
import { yuan } from './materials'

function download(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

function csvCell(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** 每份导出共用的说明条款 */
export function batchPolicyLines(r: BatchResult): string[] {
  return [
    STRATEGY_NOTE,
    PRIORITY_RULE,
    `合排结果：${r.sheetCount} 张（分开排基线 ${r.baselineSheets} 张，省 ${r.savedSheets} 张、省 ¥${yuan(r.savedCents)}）；板材 ${r.spec.spec}，单价 ¥${yuan(
      r.spec.priceCents
    )}/张，综合利用率 ${(r.utilization * 100).toFixed(1)}%。`,
    `走法 B 对照：先全批合成一趟再回拆的裸排为 ${r.planB.sheets} 张，其中 ${r.planB.contaminatedSheets} 张板有同户被夹断（${r.planB.brokenPairs} 处）；补整块约束后板数 ${r.planB.constrainedSheets} 张，与走法 A 相同。`,
    '翻到走法 B 的条件：只有当「板内不按户收拢的裸排本身就没有任何夹断」（各户料层恰好自然成带、且 B 板数更少）时才换；本批不满足。',
    '板钱分摊：每张板按各户实际占用片区面积（板宽×带高）比例分，整数分，余差按最大余额法补给面积占比最大的户；Σ各户分摊 = 整批板钱。',
    '单户板板尾余料三选一（默认自留）：①自留，板钱全归占用户；②按实际占用，让出方承担整板、受让方0元取料；③约定比例（本单见分摊表），让出方与受让方按比例分担。'
  ]
}

function modeLabel(m: RemnantMode): string {
  switch (m) {
    case 'keep':
      return '自留'
    case 'actual':
      return '按实际占用'
    case 'orig':
      return '按各家原始用量'
    case 'ratio':
      return '让出/受让约定比例'
  }
}

function decisionBySheet(r: BatchResult): Map<number, BatchResult['decisions'][number]> {
  return new Map(r.decisions.map((d) => [d.sheetIndex, d]))
}

/** 取件清单（全部门头一张表，可按户筛选后打印分发） */
export function exportPickListCsv(r: BatchResult, owner?: OwnerReport): void {
  const lines: string[] = []
  lines.push(csvCell(`集中开料 · 取件清单${owner ? `（${owner.ownerName}）` : '（全批）'}`))
  lines.push(['板材', csvCell(r.spec.spec)].join(','))
  lines.push(['生成口径', ...batchPolicyLines(r).slice(0, 2).map(csvCell)].join(','))
  lines.push('')
  const owners = owner ? [owner] : r.owners
  for (const o of owners) {
    lines.push(csvCell(`门头：${o.ownerName}（共 ${o.pieceCount} 件）`))
    lines.push(['板号', '片区/余料位置', '起y(mm)', '止y(mm)', '件数', '料件', '备注'].map(csvCell).join(','))
    for (const row of o.pick) {
      lines.push(
        [
          `第${row.boardNo}张`,
          row.bandText,
          Math.round(row.y0),
          Math.round(row.y1),
          row.count,
          row.labels.join(' '),
          row.note ?? ''
        ]
          .map(csvCell)
          .join(',')
      )
    }
    lines.push('')
  }
  for (const p of batchPolicyLines(r)) lines.push(csvCell(p))
  download(`集中开料-取件清单${owner ? `-${owner.ownerName}` : '-全批'}.csv`, new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' }))
}

/** 裁切清单（按户分组，含每件落在哪张板） */
export function exportCutListCsv(r: BatchResult, owner?: OwnerReport): void {
  const lines: string[] = []
  lines.push(csvCell(`集中开料 · 裁切清单${owner ? `（${owner.ownerName}）` : '（全批）'}`))
  lines.push(['板材', csvCell(r.spec.spec), `锯缝 ${r.spec.kerfMm}mm`].map(csvCell).join(','))
  lines.push('')
  const owners = owner ? [owner] : r.owners
  for (const o of owners) {
    lines.push(csvCell(`门头：${o.ownerName}`))
    lines.push(['料件', '宽mm', '高mm', '数量', '所在板（第n张）'].map(csvCell).join(','))
    for (const c of o.cut) {
      lines.push([c.label, c.wMm, c.hMm, c.count, c.boards.map((b) => `第${b}张`).join(' ')].map(csvCell).join(','))
    }
    lines.push('')
  }
  for (const p of batchPolicyLines(r)) lines.push(csvCell(p))
  download(`集中开料-裁切清单${owner ? `-${owner.ownerName}` : '-全批'}.csv`, new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' }))
}

/** 分摊结果（逐板逐户，含基线对比与余料决定） */
export function exportAllocationCsv(r: BatchResult): void {
  const lines: string[] = []
  lines.push('集中开料 · 板钱分摊结果')
  lines.push(['板材', csvCell(r.spec.spec), `单价(元)`, yuan(r.spec.priceCents), '张数', r.sheetCount].join(','))
  lines.push('')
  lines.push(['门头', '板号', '计价方式', '权重面积(mm²)', '分摊(元)', '说明'].map(csvCell).join(','))
  for (const o of r.owners) {
    for (const a of o.allocations) {
      lines.push(
        [o.ownerName, `第${a.boardNo}张`, allocBasisLabel(a.basis), Math.round(a.weightAreaMm2), yuan(a.cents), a.note]
          .map(csvCell)
          .join(',')
      )
    }
  }
  lines.push('')
  lines.push(['门头', '分开排板数', '分开排板钱(元)', '合排分摊(元)', '省板钱(元)', '让出余料板', '受让余料板'].map(csvCell).join(','))
  for (const o of r.owners) {
    lines.push(
      [
        o.ownerName,
        o.standaloneSheets,
        yuan(o.standaloneCents),
        yuan(o.allocatedCents),
        yuan(o.savedCents),
        o.givesBoards.map((b) => `第${b}张`).join(' ') || '—',
        o.remnantClaims
          .map((c) => `第${c.boardNo}张(自${r.owners.find((x) => x.ownerId === c.fromOwnerId)?.ownerName ?? c.fromOwnerId}让出)`)
          .join(' ') || '—'
      ]
        .map(csvCell)
        .join(',')
    )
  }
  lines.push(['合计', r.baselineSheets, yuan(r.baselineCents), yuan(r.totalCents), yuan(r.savedCents)].map(csvCell).join(','))
  lines.push('')
  lines.push('单户板余料处置')
  lines.push(['板号', '占用户（让出方）', '余料宽mm', '余料高mm', '处置', '受让方', '让出方分担(元)', '受让方分担(元)'].map(csvCell).join(','))
  const dm = decisionBySheet(r)
  for (const s of r.sheets) {
    if (!s.remnant) continue
    const d = dm.get(s.index)!
    const giverName = r.owners.find((o) => o.ownerId === s.remnant!.ownerId)?.ownerName ?? s.remnant.ownerId
    const receiverName = d.receiverId ? r.owners.find((o) => o.ownerId === d.receiverId)?.ownerName ?? d.receiverId : ''
    const giverAlloc = r.owners.find((o) => o.ownerId === s.remnant!.ownerId)?.allocations.find((a) => a.boardNo === s.index + 1)?.cents ?? 0
    const receiverAlloc = d.receiverId ? r.owners.find((o) => o.ownerId === d.receiverId)?.allocations.find((a) => a.boardNo === s.index + 1)?.cents ?? 0 : 0
    lines.push(
      [
        `第${s.index + 1}张`,
        giverName,
        s.remnant.wMm,
        Math.round(s.remnant.hMm),
        modeLabel(d.mode),
        receiverName || '（自留）',
        yuan(giverAlloc),
        yuan(receiverAlloc)
      ]
        .map(csvCell)
        .join(',')
    )
  }
  lines.push('')
  for (const p of batchPolicyLines(r)) lines.push(csvCell(p))
  download('集中开料-板钱分摊.csv', new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' }))
}

function allocBasisLabel(b: string): string {
  switch (b) {
    case 'area':
      return '按实际占用片区面积'
    case 'actual-give':
      return '让料板·按实际占用'
    case 'ratio-give':
      return '让料板·约定比例'
    case 'orig-give':
      return '让料板·按原始用量'
    default:
      return b
  }
}

/** 汇总总表（.xls：整批排样摘要 + 逐户对比 + 逐板分摊 + 余料决定 + 政策说明） */
export function exportBatchXls(r: BatchResult): void {
  const dm = decisionBySheet(r)
  const esc = (s: unknown): string =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  const rows: string[] = []
  rows.push('<table border="1">')
  rows.push('<tr><th colspan="7">集中开料汇总单（合排走法 A：先各自装箱，再合并排 + 板内按户收拢）</th></tr>')
  rows.push(
    `<tr><td>板材</td><td colspan="6">${esc(r.spec.spec)}（${r.spec.wMm}×${r.spec.hMm}mm，锯缝 ${r.spec.kerfMm}mm，¥${yuan(
      r.spec.priceCents
    )}/张）</td></tr>`
  )
  rows.push(
    `<tr><td>总结果</td><td colspan="6">分开排 ${r.baselineSheets} 张 → 合排 ${r.sheetCount} 张，省 ${r.savedSheets} 张、省 ¥${yuan(
      r.savedCents
    )}；综合利用率 ${(r.utilization * 100).toFixed(1)}%（基线 ${(r.baselineUtilization * 100).toFixed(1)}%）</td></tr>`
  )
  rows.push(
    `<tr><td>走法B对照</td><td colspan="6">裸排 ${r.planB.sheets} 张、${r.planB.contaminatedSheets} 张板有同户夹断（${r.planB.brokenPairs} 处）；补整块约束后 ${r.planB.constrainedSheets} 张，与 A 相同 → 本场景 B 不划算</td></tr>`
  )
  rows.push('<tr><th colspan="7">逐门头对比（合排 vs 分开排）</th></tr>')
  rows.push('<tr><th>门头</th><th>料件数</th><th>分开排(张)</th><th>分开排板钱(元)</th><th>合排分摊(元)</th><th>省(元)</th><th>整批合计校验</th></tr>')
  for (const o of r.owners) {
    rows.push(
      `<tr><td>${esc(o.ownerName)}</td><td>${o.pieceCount}</td><td>${o.standaloneSheets}</td><td>${yuan(o.standaloneCents)}</td><td>${yuan(
        o.allocatedCents
      )}</td><td>${yuan(o.savedCents)}</td><td></td></tr>`
    )
  }
  rows.push(
    `<tr><td>合计</td><td>${r.owners.reduce((s, o) => s + o.pieceCount, 0)}</td><td>${r.baselineSheets}</td><td>${yuan(
      r.baselineCents
    )}</td><td>${yuan(r.totalCents)}</td><td>${yuan(r.savedCents)}</td><td>${
      r.owners.reduce((s, o) => s + o.allocatedCents, 0) === r.totalCents ? 'Σ各户=整批 ✓' : '不平！'
    }</td></tr>`
  )
  rows.push('<tr><th colspan="7">逐板分摊</th></tr>')
  rows.push('<tr><th>板号</th><th>门头</th><th>片区 y(mm)</th><th>件数</th><th>计价方式</th><th>分摊(元)</th><th>说明</th></tr>')
  for (const s of r.sheets) {
    for (const o of r.owners) {
      const area = s.byOwner.get(o.ownerId)
      if (!area) continue
      const ys = area.bands.map((b) => `${Math.round(b.y0)}–${Math.round(b.y1)}`).join('；')
      const cnt = area.bands.reduce((n, b) => n + b.pieces.length, 0)
      const alloc = o.allocations.find((a) => a.boardNo === s.index + 1)
      rows.push(
        `<tr><td>第${s.index + 1}张</td><td>${esc(o.ownerName)}</td><td>${ys}</td><td>${cnt}</td><td>${alloc ? esc(
          allocBasisLabel(alloc.basis)
        ) : ''}</td><td>${alloc ? yuan(alloc.cents) : '0.00'}</td><td>${esc(alloc?.note ?? '')}</td></tr>`
      )
    }
    if (s.remnant) {
      const d = dm.get(s.index)!
      rows.push(
        `<tr><td>第${s.index + 1}张</td><td colspan="2">板尾余料 ${s.remnant.wMm}×${Math.round(s.remnant.hMm)}mm</td><td colspan="4">${esc(
          modeLabel(d.mode)
        )}${d.receiverId ? ` → 受让方 ${esc(r.owners.find((o) => o.ownerId === d.receiverId)?.ownerName ?? '')}` : '（自留）'}</td></tr>`
      )
    }
  }
  rows.push('<tr><th colspan="7">说明（取件清单、裁切清单、分摊导出同此口径）</th></tr>')
  for (const p of batchPolicyLines(r)) rows.push(`<tr><td colspan="7">${esc(p)}</td></tr>`)
  rows.push('</table>')
  const html = `<html><head><meta charset="utf-8"></head><body>${rows.join('\n')}</body></html>`
  download('集中开料汇总单.xls', new Blob([`﻿${html}`], { type: 'application/vnd.ms-excel;charset=utf-8' }))
}

/** 浏览器打印：把汇总区域内容交给页面 @media print 样式（页面调用 window.print 即可） */
export function batchPrintTitle(r: BatchResult): string {
  return `集中开料汇总 · ${r.sheetCount} 张板 · 省 ${r.savedSheets} 张 / ¥${yuan(r.savedCents)}`
}
