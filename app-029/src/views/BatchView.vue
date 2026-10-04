<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import BatchSheetDiagram from '../components/BatchSheetDiagram.vue'
import {
  assertBatchAllocation,
  assertRegionsWhole,
  planBatchNesting,
  letParticipants,
  letPolicyLabel,
  type BatchNestingResult,
  type LetPolicy
} from '../logic/batchNesting'
import { exportAllocationCsv, exportBatchXls, exportCutListCsv, exportPickListCsv, type BatchExportMeta } from '../logic/batchQuote'
import { ensureFont } from '../logic/fontLoader'
import { computeLayout, textToItems } from '../logic/layout'
import { acrylicPieces } from '../logic/materials'
import { createProject, listProjects, loadPreset, saveProject } from '../logic/store'
import type { Project } from '../logic/types'
import type { Piece } from '../logic/nesting'

const projects = ref<Project[]>([])
const preset = ref(loadPreset())
const selected = ref<string[]>([])
const sheetId = ref(preset.value.acrylicSheets[0]?.id ?? '')
const letPolicy = ref<LetPolicy>('actual')
const agreedRatio = ref(0.5)
const tick = ref(0)
const busy = ref(false)

function refresh(): void {
  projects.value = listProjects()
}
onMounted(refresh)

const sheet = computed(() => preset.value.acrylicSheets.find((s) => s.id === sheetId.value) ?? preset.value.acrylicSheets[0])

// 选中项变化时预加载字体
watch(
  selected,
  async () => {
    busy.value = true
    const need = new Set<string>()
    for (const p of projects.value) {
      if (!selected.value.includes(p.id)) continue
      need.add(`${p.layout.settings.fontId}|${p.layout.settings.weight}`)
    }
    for (const key of need) {
      const [fid, w] = key.split('|')
      try {
        await ensureFont(fid, Number(w))
      } catch {
        // 字体缺失仍可计算（缺字不产生料件，会在页面标注）
      }
    }
    tick.value++
    busy.value = false
  },
  { immediate: true }
)

interface OwnerRow {
  id: string
  name: string
  pieces: Piece[]
  missing: number
  pieceCount: number
}

const ownerInputs = computed<OwnerRow[]>(() => {
  void tick.value
  return projects.value
    .filter((p) => selected.value.includes(p.id))
    .map((p) => {
      const lay = computeLayout(p.layout)
      const pieces: Piece[] = acrylicPieces(lay.chars).map((q, i) => ({ ...q, id: `${p.id}#${i}` }))
      return { id: p.id, name: p.name, pieces, missing: lay.missingCount, pieceCount: pieces.length }
    })
})

const result = computed<BatchNestingResult | null>(() => {
  void tick.value
  if (ownerInputs.value.length < 2 || !sheet.value) return null
  return planBatchNesting(
    ownerInputs.value.map((o) => ({ id: o.id, name: o.name, pieces: o.pieces })),
    {
      sheetW: sheet.value.wMm,
      sheetH: sheet.value.hMm,
      kerfMm: sheet.value.kerfMm,
      priceCents: sheet.value.priceCents,
      letPolicy: letPolicy.value,
      agreedReceiverRatio: agreedRatio.value
    }
  )
})

const ownerNames = computed(() => {
  const m = new Map<string, string>()
  for (const o of ownerInputs.value) m.set(o.id, o.name)
  return m
})

const allocCheck = computed(() => (result.value ? assertBatchAllocation(result.value) : null))
const regionCheck = computed(() => (result.value ? assertRegionsWhole(result.value) : null))

function yuan(c: number): string {
  return (c / 100).toFixed(2)
}

function exportMeta(): BatchExportMeta {
  return {
    batchName: `集中开料-${new Date().toISOString().slice(0, 10)}`,
    ownerNames: ownerNames.value,
    sheetSpec: sheet.value?.spec ?? '',
    date: new Date().toLocaleDateString('zh-CN')
  }
}

// 取件清单：每条料件规格只在其所属（门头×板）的第一行显示门头/板/区域
function isFirstOnSheet(ownerId: string, sheetIndex: number, rowIndexAmongOwner: number): boolean {
  const items = result.value?.pickList.filter((p) => p.ownerId === ownerId) ?? []
  const before = items.slice(0, rowIndexAmongOwner)
  return !before.some((it) => it.sheetIndex === sheetIndex)
}

function regionText(ownerId: string, sheetIndex: number): string {
  const r = result.value
  if (!r) return ''
  const regions = r.chosen.sheets[sheetIndex]?.regions.filter((rg) => rg.ownerId === ownerId) ?? []
  return regions
    .map((rg) => {
      if (rg.x0 <= 1e-6 && rg.x1 >= r.sheetW - 1e-6) return `横贯通片 高${Math.round(rg.heightMm)}mm`
      return `矩形片 ${Math.round(rg.widthMm)}×${Math.round(rg.heightMm)}mm`
    })
    .join('；')
}

function sheetOwnerName(sheetIndex: number, ownerId: string): string {
  void sheetIndex
  return ownerNames.value.get(ownerId) ?? ownerId
}

/** 建 3 个文字量不同的示例门头，直观演示让料与省板 */
function demo(): void {  const defs: Array<[string, string, number, number]> = [
    ['奶茶店', '奶茶鲜果茶', 2600, 280],
    ['烟酒店', '烟酒副食', 1800, 300],
    ['洗衣店', '干洗洗衣', 1600, 280]
  ]
  const ids: string[] = []
  for (const [name, text, w, size] of defs) {
    const p = createProject(name, { wMm: w, hMm: 900, frameMm: 60 })
    p.layout.settings.fontId = 'hei'
    p.layout.settings.weight = 400
    p.layout.settings.baseSizeMm = size
    p.layout.items = textToItems(text, [], p.layout.settings, size)
    saveProject(p)
    ensureFont('hei', 400).catch(() => undefined)
    ids.push(p.id)
  }
  refresh()
  selected.value = ids
}
</script>

<template>
  <div class="page">
    <section class="card">
      <header>
        <h1>集中开料（一批门头同批拼版）</h1>
        <span class="hint">先各自装箱再合并，板边余料跨家让用，按门头整块拿走</span>
      </header>
      <div class="banner">
        <b>冲突仲裁（以本条款为准，已写进全部导出）：</b
        >当「整批更省板」与「一家人家的件要能整块拿走」冲突时，<b>以整块拿走为准</b
        >——不许把同一门头的字混进别家区域；每张板上每家只占可一刀切分的整片，宁可多开一张板，也不跨门头混排。
      </div>
      <div class="split" style="margin-top: 10px">
        <div>
          <div class="field">
            <label>勾选本批门头（≥2 家）</label>
          </div>
          <table>
            <thead>
              <tr>
                <th style="width: 30px"></th>
                <th>门头</th>
                <th class="num">料件数</th>
                <th class="num">缺字</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in projects" :key="p.id">
                <td><input type="checkbox" :value="p.id" v-model="selected" /></td>
                <td>{{ p.name }}<span class="muted">　{{ p.layout.panel.wMm }}×{{ p.layout.panel.hMm }}mm</span></td>
                <td class="num">{{ ownerInputs.find((o) => o.id === p.id)?.pieceCount ?? '—' }}</td>
                <td class="num">{{ ownerInputs.find((o) => o.id === p.id)?.missing ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
          <p class="muted" v-if="projects.length < 2">项目不足 2 个，可点右侧按钮建 3 个示例门头。</p>
        </div>
        <div>
          <div class="field">
            <label>板材规格（整批统一）</label>
            <div class="ctl">
              <select v-model="sheetId">
                <option v-for="s in preset.acrylicSheets" :key="s.id" :value="s.id">{{ s.spec }}　¥{{ (s.priceCents / 100).toFixed(2) }}/张</option>
              </select>
            </div>
          </div>
          <div class="field">
            <label>让料板钱怎么分（三选一）</label>
            <div class="ctl">
              <select v-model="letPolicy">
                <option value="actual">{{ letPolicyLabel('actual') }}（默认，账一定齐）</option>
                <option value="origin">{{ letPolicyLabel('origin') }}</option>
                <option value="agreed">{{ letPolicyLabel('agreed') }}</option>
              </select>
            </div>
          </div>
          <div class="field" v-if="letPolicy === 'agreed'">
            <label>受让方承担其占用部分的比例</label>
            <div class="ctl">
              <input type="number" min="0" max="1" step="0.05" v-model.number="agreedRatio" style="width: 90px" />
              <span class="muted">= {{ (agreedRatio * 100).toFixed(0) }}%；尾差 ±1 分归让出方</span>
            </div>
          </div>
          <div class="row" style="margin-top: 8px">
            <button @click="demo">建 3 个示例门头并勾选</button>
            <span class="muted" v-if="busy">字体加载中…</span>
          </div>
          <ul class="notes" style="margin-top: 8px">
            <li><b>按实际占用分</b>：与通用口径一致，零头最大余数法补到分；不让任何一方多掏。</li>
            <li><b>按原始用量分</b>：让料板钱全归让出方、受让方白用——<b>让出方多掏</b>板边料的钱。</li>
            <li><b>约定比例分担</b>：按双方约定切分；尾差固定归让出方，账仍与整批合计一致。</li>
          </ul>
        </div>
      </div>
    </section>

    <template v-if="result && sheet">
      <!-- 总览与走法决策 -->
      <section class="card" style="margin-top: 14px">
        <header>
          <h2>合排结果与走法选择</h2>
          <span class="hint">两种走法都实测，按既定准则二选一，全套清单只走选定的一套</span>
        </header>
        <table>
          <thead>
            <tr>
              <th>走法</th>
              <th class="num">用板</th>
              <th class="num">整块区域数</th>
              <th class="num">综合利用率</th>
              <th>是否选定</th>
            </tr>
          </thead>
          <tbody>
            <tr :class="{ 'row-active': result.strategy === 'A_packThenMerge' }">
              <td>A：先各家装箱、再合并排</td>
              <td class="num">{{ result.strategyA.sheetCount }} 张</td>
              <td class="num">{{ result.strategyA.regionCount }}</td>
              <td class="num">{{ (result.strategyA.utilization * 100).toFixed(1) }}%</td>
              <td>{{ result.strategy === 'A_packThenMerge' ? '✔ 选定' : '' }}</td>
            </tr>
            <tr :class="{ 'row-active': result.strategy === 'B_mergeThenSplit' }">
              <td>B：先全批合排、再按门头回拆</td>
              <td class="num">{{ result.strategyB.sheetCount }} 张</td>
              <td class="num">{{ result.strategyB.regionCount }}</td>
              <td class="num">{{ (result.strategyB.utilization * 100).toFixed(1) }}%</td>
              <td>{{ result.strategy === 'B_mergeThenSplit' ? '✔ 选定' : '' }}</td>
            </tr>
            <tr style="background: #f6f7fa">
              <td>各家分开排（基线）</td>
              <td class="num">{{ result.separateSheetCount }} 张</td>
              <td class="num">—</td>
              <td class="num">{{ (result.separate.utilization * 100).toFixed(1) }}%</td>
              <td>对照</td>
            </tr>
          </tbody>
        </table>
        <ul class="notes" style="margin-top: 8px">
          <li v-for="(n, i) in result.decisionNotes" :key="i">{{ n }}</li>
        </ul>
        <div class="kv-list" style="margin-top: 8px">
          <span class="muted">整批用板</span><span class="mono"><b>{{ result.chosen.sheetCount }}</b> 张（{{ sheet.spec }}）</span>
          <span class="muted">分开排用板</span><span class="mono">{{ result.separateSheetCount }} 张</span>
          <span class="muted">省板</span><span class="mono"><b>{{ result.savedSheets }}</b> 张</span>
          <span class="muted">省钱</span
          ><span class="mono"><b>¥{{ yuan(result.savedCents) }}</b>（{{ yuan(result.separateCostCents) }} → {{ yuan(result.totalCostCents) }} 元）</span>
        </div>
      </section>

      <!-- 排样图 -->
      <section class="card" style="margin-top: 14px">
        <header>
          <h2>整批排样图（{{ result.sheetW }}×{{ result.sheetH }}mm，按选定走法：{{ result.chosen.label }}）</h2>
          <span class="hint">粗虚线框=门头整片；灰虚线=横向贯通切线；橙虚线=层内竖切回切线</span>
        </header>
        <div class="row" style="margin-bottom: 8px">
          <span v-for="o in ownerInputs" :key="o.id" class="chip">● {{ o.name }}</span>
        </div>
        <BatchSheetDiagram :sheets="result.chosen.sheets" :sheet-w="result.sheetW" :sheet-h="result.sheetH" :owner-names="ownerNames" />
        <p class="muted" v-for="(m, i) in regionCheck?.messages ?? []" :key="i" :style="regionCheck?.ok ? '' : 'color:#b3372f'">{{ m }}</p>
      </section>

      <!-- 逐家对比 -->
      <section class="card" style="margin-top: 14px">
        <header>
          <h2>与各家分开排逐项对比</h2>
          <span class="hint">分开排金额 = 各家独自装箱板数 × 板价</span>
        </header>
        <table>
          <thead>
            <tr>
              <th>门头</th>
              <th class="num">料件</th>
              <th class="num">占用面积 ㎡</th>
              <th class="num">分开排板数</th>
              <th class="num">分开排金额</th>
              <th class="num">合排分摊</th>
              <th class="num">独占板</th>
              <th class="num">省</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="o in result.owners" :key="o.ownerId">
              <td>{{ o.name }}</td>
              <td class="num">{{ o.pieceCount }}</td>
              <td class="num">{{ (o.usedAreaMm2 / 1e6).toFixed(3) }}</td>
              <td class="num">{{ o.separateSheets }}</td>
              <td class="num">¥{{ yuan(o.separateCents) }}</td>
              <td class="num"><b>¥{{ yuan(o.sharedCents) }}</b></td>
              <td class="num">{{ o.wholeOwnedSheets }}</td>
              <td class="num" :class="o.savedCents > 0 ? 'good' : ''">¥{{ yuan(o.savedCents) }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td>合计</td>
              <td class="num">{{ result.owners.reduce((m, o) => m + o.pieceCount, 0) }}</td>
              <td class="num">{{ (result.chosen.totalUsedAreaMm2 / 1e6).toFixed(3) }}</td>
              <td class="num">{{ result.separateSheetCount }}</td>
              <td class="num">¥{{ yuan(result.separateCostCents) }}</td>
              <td class="num">¥{{ yuan(result.totalAllocatedCents) }}</td>
              <td></td>
              <td class="num">¥{{ yuan(result.savedCents) }}</td>
            </tr>
          </tfoot>
        </table>
        <p class="muted" v-for="(m, i) in allocCheck?.messages ?? []" :key="i">{{ m }}</p>
      </section>

      <!-- 每张板谁用了多少 -->
      <section class="card" style="margin-top: 14px">
        <header>
          <h2>每张板由谁用掉多少（板钱分摊到分）</h2>
          <span class="hint">每板分入各家之和 = ¥{{ yuan(result.priceCents) }}</span>
        </header>
        <table>
          <thead>
            <tr>
              <th>板材</th>
              <th>门头（整片）</th>
              <th class="num">占用面积 mm²</th>
              <th class="num">整片数</th>
              <th class="num">分摊金额</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="s in result.chosen.sheets" :key="s.index">
              <tr
                v-for="o in result.owners.filter((o) => o.shares.some((sh) => sh.sheetIndex === s.index))"
                :key="`${s.index}-${o.ownerId}`"
              >
                <td>第 {{ s.index + 1 }} 张</td>
                <td>
                  {{ o.name }}<span v-if="o.shares.find((sh) => sh.sheetIndex === s.index) && s.letInfo?.giverId === o.ownerId" class="muted">（让出方）</span
                  ><span v-if="s.letInfo?.receiverIds.includes(o.ownerId)" class="muted">（受让方）</span>
                </td>
                <td class="num">{{ Math.round(o.shares.find((sh) => sh.sheetIndex === s.index)?.usedAreaMm2 ?? 0) }}</td>
                <td class="num">{{ o.shares.find((sh) => sh.sheetIndex === s.index)?.regions ?? 0 }}</td>
                <td class="num">¥{{ yuan(o.shares.find((sh) => sh.sheetIndex === s.index)?.shareCents ?? 0) }}</td>
              </tr>
              <tr style="background: #f6f7fa">
                <td colspan="4">第 {{ s.index + 1 }} 张小计</td>
                <td class="num"><b>¥{{ yuan(result.priceCents) }}</b></td>
              </tr>
            </template>
          </tbody>
        </table>
      </section>

      <!-- 让料板与余料判定 -->
      <section class="card" style="margin-top: 14px">
        <header>
          <h2>板边余料让料判定与分账</h2>
          <span class="hint">规则：{{ letPolicyLabel(result.letPolicy) }}</span>
        </header>
        <table>
          <thead>
            <tr>
              <th>板材</th>
              <th>板上的家</th>
              <th class="num">余料 mm</th>
              <th>状态</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in result.chosen.sheets" :key="`l${s.index}`">
              <td>第 {{ s.index + 1 }} 张</td>
              <td>
                <template v-if="s.letInfo">
                  {{ sheetOwnerName(s.index, s.letInfo.giverId) }}（让出方） →
                  {{ s.letInfo.receiverIds.map((id) => sheetOwnerName(s.index, id)).join('、') }}
                </template>
                <template v-else>{{ s.ownerIds.map((id) => sheetOwnerName(s.index, id)).join('、') }}</template>
              </td>
              <td class="num">
                <template v-if="s.letInfo">{{ s.letInfo.tailWMm }}×{{ Math.round(s.letInfo.tailHMm) }}</template>
                <template v-else
                  >{{ result.sheetW }}×{{ Math.round(result.sheetH - s.regions.reduce((m, r) => m + r.heightMm, 0)) }}</template
                >
              </td>
              <td>{{ s.letInfo ? `已让给 ${s.letInfo.receiverIds.length} 家` : s.ownerIds.length > 1 ? '合占' : result.letOpportunities.find((o) => o.sheetIndex === s.index)?.canLet ? '能让' : '不能让/满板' }}</td>
              <td class="muted">
                <template v-if="s.letInfo">
                  {{ letParticipants(s).map((pt) => `${sheetOwnerName(s.index, pt.ownerId)}${pt.isGiver ? '(让出方)' : ''} ¥${yuan(pt.paidCents)}`).join('；') }}
                </template>
                <template v-else-if="s.ownerIds.length > 1">按实际占用分摊</template>
                <template v-else>{{ result.letOpportunities.find((o) => o.sheetIndex === s.index)?.note ?? '已排满' }}</template>
              </td>
            </tr>
          </tbody>
        </table>
        <ul class="notes" style="margin-top: 8px">
          <li v-for="(op, i) in result.letOpportunities.filter((o) => !o.canLet && o.tailHMm > 0)" :key="i">
            第 {{ op.sheetIndex + 1 }} 张（{{ sheetOwnerName(op.sheetIndex, op.ownerId) }}）：{{ op.note }}
          </li>
        </ul>
      </section>

      <!-- 取件清单 -->
      <section class="card" style="margin-top: 14px">
        <header>
          <h2>取件清单（按门头拆回：哪块板的哪一片、几件）</h2>
          <span class="hint">同一家在同一张板上只取自己的整片</span>
        </header>
        <table>
          <thead>
            <tr>
              <th>门头</th>
              <th>板材</th>
              <th>整片</th>
              <th>料件</th>
              <th class="num">宽 mm</th>
              <th class="num">高 mm</th>
              <th class="num">件数</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="o in result.owners" :key="o.ownerId">
              <tr v-for="(item, i) in result.pickList.filter((p) => p.ownerId === o.ownerId)" :key="`${o.ownerId}-${i}`">
                <td v-if="isFirstOnSheet(o.ownerId, item.sheetIndex, i)">{{ o.name }}</td>
                <td v-if="isFirstOnSheet(o.ownerId, item.sheetIndex, i)">第 {{ item.sheetIndex + 1 }} 张</td>
                <td v-if="isFirstOnSheet(o.ownerId, item.sheetIndex, i)" class="muted">{{ regionText(o.ownerId, item.sheetIndex) }}</td>
                <td>{{ item.label }}</td>
                <td class="num">{{ item.wMm }}</td>
                <td class="num">{{ item.hMm }}</td>
                <td class="num">{{ item.count }}</td>
              </tr>
            </template>
          </tbody>
        </table>
      </section>

      <!-- 裁切清单 -->
      <section class="card" style="margin-top: 14px">
        <header>
          <h2>裁切清单（按门头，落刀尺寸）</h2>
          <span class="hint">同尺寸合并计数；锯缝 {{ result.kerfMm }}mm 已预留</span>
        </header>
        <table>
          <thead>
            <tr>
              <th>门头</th>
              <th>料件</th>
              <th class="num">落刀宽 mm</th>
              <th class="num">落刀高 mm</th>
              <th class="num">件数</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(c, i) in result.cutList" :key="i">
              <td>{{ ownerNames.get(c.ownerId) ?? c.ownerId }}</td>
              <td>{{ c.label }}</td>
              <td class="num">{{ c.wMm }}</td>
              <td class="num">{{ c.hMm }}</td>
              <td class="num">{{ c.count }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <div class="banner bad" v-if="result.oversize.length">
        <b>超板料件（已拦截，未排入本批，需换大板或分件拼接）：</b>
        <span v-for="(p, i) in result.oversize" :key="i">
          {{ ownerNames.get(p.ownerId) ?? p.ownerId }}-{{ p.label }}（{{ p.wMm }}×{{ p.hMm }}mm）；
        </span>
      </div>

      <!-- 导出 -->
      <section class="card" style="margin-top: 14px">
        <header>
          <h2>导出</h2>
          <span class="hint">取件清单 / 裁切清单 / 分摊结果都可导出，说明条款随文件带走</span>
        </header>
        <div class="row">
          <button @click="exportPickListCsv(result!, exportMeta())">导出取件清单 CSV</button>
          <button @click="exportCutListCsv(result!, exportMeta())">导出裁切清单 CSV</button>
          <button @click="exportAllocationCsv(result!, exportMeta())">导出分摊结果 CSV</button>
          <button class="primary" @click="exportBatchXls(result!, exportMeta())">导出合订本 XLS（含全部清单与说明）</button>
        </div>
        <ul class="notes" style="margin-top: 8px">
          <li v-for="(n, i) in result.arbitrationNotes" :key="i">{{ n }}</li>
        </ul>
      </section>
    </template>

    <section class="card" v-else-if="!busy" style="margin-top: 14px">
      <p class="muted">勾选 2 个以上门头后自动集中排样；料件来自各门头当前排版的字形外接矩形。</p>
    </section>
  </div>
</template>
