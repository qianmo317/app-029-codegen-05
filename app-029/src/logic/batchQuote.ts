/**
 * 集中开料导出：取件清单 / 裁切清单 / 板钱分摊，三种 CSV + 一个 .xls 合订本。
 * 全部导出都带「冲突仲裁」「选定走法」「让料板分账规则」说明，保证口径处处一致。
 * 金额单位：整数「分」，展示到 0.01 元。
 */

import {
  letParticipants,
  letPolicyLabel,
  type BatchNestingResult,
  type LetPolicy
} from './batchNesting'

function yuan(cents: number): string {
  return (cents / 100).toFixed(2)
}

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

function csvCell(s: string | number): string {
  const v = String(s)
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

function csv(lines: Array<Array<string | number>>): Blob {
  const body = lines.map((row) => row.map(csvCell).join(',')).join('\r\n')
  return new Blob([`﻿${body}`], { type: 'text/csv;charset=utf-8' })
}

export interface BatchExportMeta {
  batchName: string
  ownerNames: Map<string, string>
  sheetSpec: string
  date: string
}

function policyExplain(p: LetPolicy): string {
  switch (p) {
    case 'actual':
      return '按实际占用分（默认）：每板各家按实际占用面积比分钱、最大余数法把零头按占比补到分；Σ分摊=整批板钱，不偏不倚。'
    case 'origin':
      return '按各家原始用量分：让料板的钱全部由让出方承担、受让方白用——让出方多掏了板边料的钱（会让让出方多掏钱，仅在双方约定“借料不收钱”时使用）。'
    case 'agreed':
      return '让出/受让双方按约定比例分担：受让方仅就其实际占用部分按约定比例承担（本次比例见分摊表），让出方占用与未利用尾料仍归让出方；四舍五入 ±1 分尾差归让出方，保证账齐。'
  }
}

function headRows(r: BatchNestingResult, meta: BatchExportMeta): Array<Array<string | number>> {
  return [
    [`集中开料单（${r.chosen.label}）`],
    ['批次', meta.batchName, '日期', meta.date],
    ['板材', meta.sheetSpec, '板幅(mm)', `${r.sheetW}×${r.sheetH}`],
    ['锯缝(mm)', r.kerfMm, '板单价(元)', yuan(r.priceCents)],
    [],
    ['冲突仲裁（以本条款为准）'],
    ...r.arbitrationNotes.map((n) => [n]),
    [],
    ['走法选择说明'],
    ...r.decisionNotes.map((n) => [n]),
    [],
    ['让料板分账规则', letPolicyLabel(r.letPolicy)],
    [policyExplain(r.letPolicy)],
    r.letPolicy === 'agreed' ? [`约定比例（受让方承担其占用部分）：${(r.agreedReceiverRatio * 100).toFixed(0)}%`] : [''],
    []
  ]
}

/** 取件清单 CSV：每家用的是哪块板的哪一片、各几件 */
export function exportPickListCsv(r: BatchNestingResult, meta: BatchExportMeta): void {
  const lines: Array<Array<string | number>> = [
    ...headRows(r, meta),
    ['取件清单（按门头整块拿走；同一门头在同一张板上只进自己的整片）'],
    ['门头', '板材编号', '整片区域', '料件', '落刀宽mm', '落刀高mm', '件数']
  ]
  for (const owner of r.owners) {
    const items = r.pickList.filter((p) => p.ownerId === owner.ownerId)
    const perSheet = new Map<number, number>()
    for (const it of items) perSheet.set(it.sheetIndex, (perSheet.get(it.sheetIndex) ?? 0) + it.count)
    for (const [sheetIndex, count] of [...perSheet.entries()].sort((a, b) => a[0] - b[0])) {
      const sheetNo = sheetIndex + 1
      const regionDesc = describeRegion(r, owner.ownerId, sheetIndex)
      const rows = items.filter((it) => it.sheetIndex === sheetIndex)
      rows.forEach((it, i) => {
        lines.push([
          i === 0 ? owner.name : '',
          i === 0 ? `第${sheetNo}张` : '',
          i === 0 ? regionDesc : '',
          it.label,
          it.wMm,
          it.hMm,
          i === 0 && rows.length === 1 ? count : it.count
        ])
      })
    }
    lines.push([`${owner.name} 小计`, '', '', '', '', '', owner.pieceCount])
  }
  download(`${meta.batchName}-取件清单.csv`, csv(lines))
}

function describeRegion(r: BatchNestingResult, ownerId: string, sheetIndex: number): string {
  const regions = r.chosen.sheets[sheetIndex]?.regions.filter((rg) => rg.ownerId === ownerId) ?? []
  if (regions.length === 0) return ''
  return regions
    .map((rg) => {
      if (rg.x0 <= 1e-6 && rg.x1 >= r.sheetW - 1e-6) {
        return `横贯通片 宽${Math.round(rg.widthMm)}×高${Math.round(rg.heightMm)}mm（y ${Math.round(rg.y0)}~${Math.round(rg.y1)}）`
      }
      return `矩形片 ${Math.round(rg.widthMm)}×${Math.round(rg.heightMm)}mm（x ${Math.round(rg.x0)}~${Math.round(rg.x1)}，y ${Math.round(rg.y0)}~${Math.round(rg.y1)}）`
    })
    .join('；')
}

/** 裁切清单 CSV：按门头列出落刀尺寸与件数 */
export function exportCutListCsv(r: BatchNestingResult, meta: BatchExportMeta): void {
  const lines: Array<Array<string | number>> = [
    ...headRows(r, meta),
    ['裁切清单（落刀尺寸；异形字按外接矩形，锯缝已在排样中预留）'],
    ['门头', '料件', '落刀宽mm', '落刀高mm', '件数']
  ]
  for (const owner of r.owners) {
    const items = r.cutList.filter((c) => c.ownerId === owner.ownerId)
    items.forEach((c) => lines.push([owner.name, c.label, c.wMm, c.hMm, c.count]))
    lines.push([`${owner.name} 小计`, '', '', '', items.reduce((m, c) => m + c.count, 0)])
  }
  download(`${meta.batchName}-裁切清单.csv`, csv(lines))
}

/** 分摊结果 CSV：每张板由谁用掉多少、各家分摊合计 */
export function exportAllocationCsv(r: BatchNestingResult, meta: BatchExportMeta): void {
  const lines: Array<Array<string | number>> = [
    ...headRows(r, meta),
    ['板钱分摊（每张板分入各家之和=板价；Σ各家分摊=整批合计，精确到分）'],
    ['板材编号', '门头', '该板占用面积mm2', '该家整片数', '分摊金额(元)']
  ]
  for (const sheet of r.chosen.sheets) {
    for (const owner of r.owners) {
      const sh = owner.shares.find((s) => s.sheetIndex === sheet.index)
      if (!sh) continue
      lines.push([`第${sheet.index + 1}张`, owner.name, Math.round(sh.usedAreaMm2), sh.regions, yuan(sh.shareCents)])
    }
    lines.push([`第${sheet.index + 1}张 小计`, '', '', '', yuan(r.priceCents)])
  }
  lines.push([])
  lines.push(['门头', '分开排板数', '分开排金额(元)', '合排占用面积mm2', '合排分摊(元)', '独占板数', '省(元)'])
  for (const o of r.owners) {
    lines.push([o.name, o.separateSheets, yuan(o.separateCents), Math.round(o.usedAreaMm2), yuan(o.sharedCents), o.wholeOwnedSheets, yuan(o.savedCents)])
  }
  lines.push(['合计', r.separateSheetCount, yuan(r.separateCostCents), '', yuan(r.totalAllocatedCents), '', yuan(r.savedCents)])
  lines.push([])
  lines.push(['让料板说明'])
  const letSheets = r.chosen.sheets.filter((s) => s.letInfo)
  if (letSheets.length === 0) lines.push(['本批没有让料板'])
  for (const s of letSheets) {
    const info = s.letInfo!
    const giver = r.owners.find((o) => o.ownerId === info.giverId)?.name ?? info.giverId
    const parts = letParticipants(s).map((pt) => {
      const nm = r.owners.find((o) => o.ownerId === pt.ownerId)?.name ?? pt.ownerId
      return `${nm}${pt.isGiver ? '(让出方)' : '(受让方)'} ${yuan(pt.paidCents)} 元`
    })
    lines.push([
      `第${s.index + 1}张`,
      `让出方 ${giver} → 受让方 ${info.receiverIds.length} 家`,
      `让出尾料 ${info.tailWMm}×${Math.round(info.tailHMm)}mm`,
      `规则：${letPolicyLabel(info.policy)}`,
      parts.join('；')
    ])
  }
  download(`${meta.batchName}-板钱分摊.csv`, csv(lines))
}

/** .xls 合订本：一套文件含全部清单与说明 */
export function exportBatchXls(r: BatchNestingResult, meta: BatchExportMeta): void {
  const esc = (s: string | number): string =>
    String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const tr = (cells: Array<string | number>, head = false): string =>
    `<tr>${cells.map((c) => `<${head ? 'th' : 'td'}>${esc(c)}</${head ? 'th' : 'td'}>`).join('')}</tr>`

  const blocks: string[] = []
  blocks.push('<table border="1">')
  blocks.push(tr(['集中开料合订本（取件 / 裁切 / 分摊）'], true))
  blocks.push(tr(['批次', meta.batchName, '日期', meta.date]))
  blocks.push(tr(['选定走法', r.chosen.label, '板材', meta.sheetSpec]))
  blocks.push(tr(['分开排(张)', r.separateSheetCount, '合排(张)', r.chosen.sheetCount, '省(张)', r.savedSheets]))
  blocks.push(tr(['分开排金额(元)', yuan(r.separateCostCents), '合排金额(元)', yuan(r.totalCostCents), '省(元)', yuan(r.savedCents)]))
  blocks.push('</table>')

  blocks.push('<table border="1">')
  blocks.push(tr(['冲突仲裁与走法选择（以本说明为准）'], true))
  for (const n of [...r.arbitrationNotes, ...r.decisionNotes]) blocks.push(`<tr><td>${esc(n)}</td></tr>`)
  blocks.push(`<tr><td>${esc('让料板分账规则：' + letPolicyLabel(r.letPolicy))}</td></tr>`)
  blocks.push(`<tr><td>${esc(policyExplain(r.letPolicy))}</td></tr>`)
  if (r.letPolicy === 'agreed') blocks.push(`<tr><td>${esc(`约定比例（受让方承担其占用部分）：${(r.agreedReceiverRatio * 100).toFixed(0)}%；四舍五入 ±1 分尾差归让出方`)}</td></tr>`)
  blocks.push('</table>')

  // 取件清单
  blocks.push('<table border="1">')
  blocks.push(tr(['一、取件清单（按门头整块拿走）'], true))
  blocks.push(tr(['门头', '板材编号', '整片区域', '料件', '落刀宽mm', '落刀高mm', '件数'], true))
  for (const owner of r.owners) {
    const items = r.pickList.filter((p) => p.ownerId === owner.ownerId)
    const sheetIndexes = [...new Set(items.map((i) => i.sheetIndex))].sort((a, b) => a - b)
    for (const si of sheetIndexes) {
      const rows = items.filter((it) => it.sheetIndex === si)
      const regionDesc = describeRegion(r, owner.ownerId, si)
      rows.forEach((it, i) =>
        blocks.push(
          tr([i === 0 ? owner.name : '', i === 0 ? `第${si + 1}张` : '', i === 0 ? regionDesc : '', it.label, it.wMm, it.hMm, it.count])
        )
      )
    }
    blocks.push(tr([`${owner.name} 小计`, '', '', '', '', '', owner.pieceCount]))
  }
  blocks.push('</table>')

  // 裁切清单
  blocks.push('<table border="1">')
  blocks.push(tr(['二、裁切清单（落刀尺寸）'], true))
  blocks.push(tr(['门头', '料件', '落刀宽mm', '落刀高mm', '件数'], true))
  for (const owner of r.owners) {
    for (const c of r.cutList.filter((c) => c.ownerId === owner.ownerId)) blocks.push(tr([owner.name, c.label, c.wMm, c.hMm, c.count]))
  }
  blocks.push('</table>')

  // 分摊
  blocks.push('<table border="1">')
  blocks.push(tr(['三、板钱分摊（逐板；每板小计=板价）'], true))
  blocks.push(tr(['板材编号', '门头', '占用面积mm2', '整片数', '分摊(元)'], true))
  for (const sheet of r.chosen.sheets) {
    for (const owner of r.owners) {
      const sh = owner.shares.find((s) => s.sheetIndex === sheet.index)
      if (sh) blocks.push(tr([`第${sheet.index + 1}张`, owner.name, Math.round(sh.usedAreaMm2), sh.regions, yuan(sh.shareCents)]))
    }
    blocks.push(tr([`第${sheet.index + 1}张 小计`, '', '', '', yuan(r.priceCents)]))
  }
  blocks.push('</table>')

  blocks.push('<table border="1">')
  blocks.push(tr(['四、与各家分开排逐项对比'], true))
  blocks.push(tr(['门头', '分开排板数', '分开排(元)', '合排分摊(元)', '独占板数', '省(元)'], true))
  for (const o of r.owners) blocks.push(tr([o.name, o.separateSheets, yuan(o.separateCents), yuan(o.sharedCents), o.wholeOwnedSheets, yuan(o.savedCents)]))
  blocks.push(tr(['合计', r.separateSheetCount, yuan(r.separateCostCents), yuan(r.totalAllocatedCents), '', yuan(r.savedCents)]))
  blocks.push('</table>')

  // 让料板
  blocks.push('<table border="1">')
  blocks.push(tr(['五、让料板（一张板只剩一家、板边料让给下一家）'], true))
  const letSheets = r.chosen.sheets.filter((s) => s.letInfo)
  if (letSheets.length === 0) blocks.push(tr(['本批没有实际发生让料的板']))
  for (const s of letSheets) {
    const info = s.letInfo!
    const giver = r.owners.find((o) => o.ownerId === info.giverId)?.name ?? info.giverId
    const receivers = info.receiverIds.map((id) => r.owners.find((o) => o.ownerId === id)?.name ?? id).join('、')
    const paidDesc = letParticipants(s)
      .map((pt) => {
        const nm = r.owners.find((o) => o.ownerId === pt.ownerId)?.name ?? pt.ownerId
        return `${nm}${pt.isGiver ? '(让出方)' : ''} ${yuan(pt.paidCents)}`
      })
      .join('；')
    blocks.push(tr([`第${s.index + 1}张`, `${giver} → ${receivers}`, `尾料 ${info.tailWMm}×${Math.round(info.tailHMm)}mm`, paidDesc]))
  }
  blocks.push('</table>')

  // 让料机会（含让不出去的余料）
  blocks.push('<table border="1">')
  blocks.push(tr(['六、板边余料让料判定（单家板）'], true))
  blocks.push(tr(['板材编号', '门头', '余料mm', '能否让', '说明'], true))
  for (const op of r.letOpportunities) {
    const name = r.owners.find((o) => o.ownerId === op.ownerId)?.name ?? op.ownerId
    blocks.push(tr([`第${op.sheetIndex + 1}张`, name, `${op.tailWMm}×${Math.round(op.tailHMm)}`, op.canLet ? '能让' : '不能让', op.note]))
  }
  blocks.push('</table>')

  if (r.oversize.length > 0) {
    blocks.push('<table border="1">')
    blocks.push(tr(['七、超板料件（已拦截，未排入本批）'], true))
    blocks.push(tr(['门头', '料件', '宽mm', '高mm'], true))
    for (const p of r.oversize) blocks.push(tr([p.ownerId, p.label, p.wMm, p.hMm]))
    blocks.push('</table>')
  }

  const html = `<html><head><meta charset="utf-8"></head><body>${blocks.join('<br/>')}</body></html>`
  download(`${meta.batchName}-集中开料.xls`, new Blob([`﻿${html}`], { type: 'application/vnd.ms-excel;charset=utf-8' }))
}
