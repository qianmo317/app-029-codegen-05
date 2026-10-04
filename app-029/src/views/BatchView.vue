<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import BatchSheetDiagram from '../components/BatchSheetDiagram.vue'
import { computeBatch, PRIORITY_RULE, STRATEGY_NOTE, assertBatchInvariants, type BatchResult, type OwnerJob, type RemnantDecision, type RemnantMode } from '../logic/batchNesting'
import { exportAllocationCsv, exportBatchXls, exportCutListCsv, exportPickListCsv } from '../logic/batchExport'
import { ensureFont } from '../logic/fontLoader'
import { computeLayout } from '../logic/layout'
import { acrylicPieces } from '../logic/materials'
import { listProjects, loadPreset } from '../logic/store'
import { yuan } from '../logic/materials'
import type { Piece } from '../logic/nesting'
import type { Project } from '../logic/types'

const preset = loadPreset()
const projects = ref<Project[]>([])
const selected = ref<string[]>([])
const sheetId = ref(preset.acrylicSheets[0].id)
const tick = ref(0)

// 让料决定（以板号为键），改动即重算分摊；默认每块单户板余料自留
const remnantMode = ref<Record<number, RemnantMode>>({})
const remnantReceiver = ref<Record<number, string>>({})
const giverRatio = ref(0.5)

// 演示数据（不落库）：构造「单独排有零头、凑一起省板」的一批门头
const demoJobs = ref<OwnerJob[]>([])

function refresh(): void {
  projects.value = listProjects()
  // 清理已删除项目的勾选
  selected.value = selected.value.filter((id) => projects.value.some((p) => p.id === id))
}
onMounted(() => {
  refresh()
  if (projects.value.length >= 2) selected.value = projects.value.slice(0, Math.min(3, projects.value.length)).map((p) => p.id)
  void ensureProjectFonts(selected.value).then(() => {
    tick.value++
  })
})

const sheet = computed(() => preset.acrylicSheets.find((s) => s.id === sheetId.value) ?? preset.acrylicSheets[0])

/** 真实项目 → 合排活：需要字体就绪，未就绪时先触发加载 */
async function ensureProjectFonts(ids: string[]): Promise<void> {
  const need = new Set<string>()
  for (const p of projects.value) {
    if (ids.includes(p.id)) need.add(`${p.layout.settings.fontId}|${p.layout.settings.weight}`)
  }
  await Promise.all([...need].map((k) => {
    const [fid, w] = k.split('|')
    return ensureFont(fid, Number(w)).catch(() => undefined)
  }))
}

const projectJobs = computed<OwnerJob[]>(() => {
  void tick.value
  const out: OwnerJob[] = []
  for (const id of selected.value) {
    const p = projects.value.find((x) => x.id === id)
    if (!p) continue
    const lay = computeLayout(p.layout)
    const pieces: Piece[] = acrylicPieces(lay.chars)
    if (pieces.length === 0) continue
    out.push({ ownerId: p.id, ownerName: p.name, pieces })
  }
  return out
})

const jobs = computed<OwnerJob[]>(() => (demoJobs.value.length > 0 ? demoJobs.value : projectJobs.value))

function makeDemo(): void {
  const mk = (prefix: string, rows: Array<[number, number, string]>): Piece[] =>
    rows.map(([w, h, label], i) => ({ id: `${prefix}${i}`, label, wMm: w, hMm: h }))
  demoJobs.value = [
    {
      ownerId: 'demo-1',
      ownerName: '张记面馆',
      // 单独排：1100+1100 一张（尾余 237），1000 一张（尾余 1437）→ 2 张
      pieces: mk('d1', [
        [1200, 1100, '面-1'], [1200, 1100, '面-2'], [1200, 1000, '面-3']
      ])
    },
    {
      ownerId: 'demo-2',
      ownerName: '李姐奶茶',
      // 单独排：6 个 400 高料层 = 2415 正好一张（尾余 22）→ 1 张
      pieces: mk('d2', [
        [1200, 400, '茶-1'], [1200, 400, '茶-2'], [1200, 400, '茶-3'],
        [1200, 400, '茶-4'], [1200, 400, '茶-5'], [1200, 400, '茶-6']
      ])
    },
    {
      ownerId: 'demo-3',
      ownerName: '老王烧烤',
      // 单独排：700+700=1403 一张（尾余 1034）→ 1 张
      pieces: mk('d3', [
        [1200, 700, '烤-1'], [1200, 700, '烤-2']
      ])
    }
  ]
}

function clearDemo(): void {
  demoJobs.value = []
}

async function recomputeFonts(): Promise<void> {
  await ensureProjectFonts(selected.value)
  tick.value++
}

const batchSpec = computed(() => ({
  wMm: sheet.value.wMm,
  hMm: sheet.value.hMm,
  kerfMm: sheet.value.kerfMm,
  priceCents: sheet.value.priceCents,
  spec: sheet.value.spec
}))

const decisions = computed<RemnantDecision[]>(() => {
  const r = resultRaw.value
  if (!r) return []
  const out: RemnantDecision[] = []
  for (const s of r.sheets) {
    if (!s.remnant) continue
    const mode = remnantMode.value[s.index] ?? 'keep'
    out.push({
      sheetIndex: s.index,
      mode,
      giverRatio: giverRatio.value,
      receiverId: mode === 'keep' ? null : remnantReceiver.value[s.index] ?? otherOwner(s.remnant.ownerId)
    })
  }
  return out
})

function otherOwner(excludeId: string): string | null {
  const hit = jobs.value.find((j) => j.ownerId !== excludeId)
  return hit ? hit.ownerId : null
}

const resultRaw = computed<BatchResult | null>(() => (jobs.value.length < 2 ? null : computeBatch(jobs.value, batchSpec.value)))

// 板号随输入重新编排，旧的按板号让料决策作废，避免错户
watch(
  [() => selected.value.slice().sort().join(','), () => demoJobs.value.length, sheetId],
  () => {
    remnantMode.value = {}
    remnantReceiver.value = {}
  }
)
const result = computed<BatchResult | null>(() => {
  const r = resultRaw.value
  if (!r) return null
  return computeBatch(jobs.value, batchSpec.value, { decisions: decisions.value })
})

const invariants = computed(() => (result.value ? assertBatchInvariants(result.value) : null))

function ownerName(id: string): string {
  return jobs.value.find((j) => j.ownerId === id)?.ownerName ?? id
}

function modeOf(sheetIndex: number): RemnantMode {
  return remnantMode.value[sheetIndex] ?? 'keep'
}

function setMode(sheetIndex: number, mode: RemnantMode): void {
  remnantMode.value = { ...remnantMode.value, [sheetIndex]: mode }
  const s = resultRaw.value?.sheets[sheetIndex]
  if (s?.remnant && !remnantReceiver.value[sheetIndex]) {
    const other = otherOwner(s.remnant.ownerId)
    if (other) remnantReceiver.value = { ...remnantReceiver.value, [sheetIndex]: other }
  }
}

function setReceiver(sheetIndex: number, receiverId: string): void {
  remnantReceiver.value = { ...remnantReceiver.value, [sheetIndex]: receiverId }
}

function exportAll(): void {
  if (!result.value) return
  exportBatchXls(result.value)
  exportPickListCsv(result.value)
  exportCutListCsv(result.value)
  exportAllocationCsv(result.value)
}

function printPage(): void {
  window.print()
}
</script>

<template>
  <div class="page">
    <div class="card no-print">
      <header>
        <h1>集中开料：一批门头凑同一批板</h1>
        <span class="hint">整块拿走优先 · 按门头拆取件/裁切清单 · 板钱逐户分摊到分</span>
      </header>
      <div class="banner info">
        <b>{{ STRATEGY_NOTE }}</b>
      </div>
      <div class="banner warn">
        <b>{{ PRIORITY_RULE }}</b>
      </div>

      <div class="split" style="align-items: start">
        <div>
          <div class="field">
            <label>板材（全批同规格同单价，与「材料与拼版」页同源）</label>
            <div class="ctl">
              <select v-model="sheetId">
                <option v-for="s in preset.acrylicSheets" :key="s.id" :value="s.id">{{ s.spec }} · ¥{{ yuan(s.priceCents) }}/张</option>
              </select>
            </div>
          </div>
          <p class="muted" style="margin: 4px 0 10px">料件按外接矩形、每层板宽贯通一刀切；异形字不用轮廓面积。</p>
          <p class="muted" v-if="projects.length < 2">本地项目不足 2 个，可先用右侧演示数据体验完整流程。</p>
          <table v-if="projects.length">
            <thead>
              <tr><th style="width: 30px"></th><th>门头</th><th class="num">字数</th><th class="num">门头 mm</th></tr>
            </thead>
            <tbody>
              <tr v-for="p in projects" :key="p.id">
                <td><input type="checkbox" :value="p.id" v-model="selected" @change="recomputeFonts" :disabled="demoJobs.length > 0" /></td>
                <td>{{ p.name }}<div class="muted">{{ p.layout.settings.baseSizeMm }}mm · {{ p.layout.items.length }} 字</div></td>
                <td class="num">{{ p.layout.items.length }}</td>
                <td class="num">{{ p.layout.panel.wMm }}×{{ p.layout.panel.hMm }}</td>
              </tr>
            </tbody>
          </table>
          <div class="row" style="margin-top: 10px">
            <button v-if="demoJobs.length === 0" @click="makeDemo">载入演示数据（3 家·凑板省 1 张）</button>
            <button v-else @click="clearDemo">退出演示，回到真实项目</button>
          </div>
        </div>

        <div>
          <h3>规则口径（所有导出同此一份）</h3>
          <ul class="notes">
            <li><b>整块拿走：</b>每家在每张板上只占一条横向贯通的连续横带，一刀切下整户拿走，带内零混户。</li>
            <li><b>走法二选一：</b>选 A「先各自装箱再合并（BFD 最少板 + 板内按户收拢）」；B「先全批一趟再回拆」在本场景为什么不划算、何时翻案，见下方对照。</li>
            <li><b>冲突仲裁：</b>更省板与整块拿走冲突时，以整块拿走为准（已写入全部导出说明）。</li>
            <li><b>板钱分摊：</b>每张板按各户实际占用片区面积（板宽×带高）比例分，整数分，余差用最大余额法；Σ各户分摊必等于整批合计。</li>
            <li><b>单户板余料：</b>默认可让出（用于受让方别的活），计价三选一，见每块板的处置选项。</li>
          </ul>
        </div>
      </div>
    </div>

    <template v-if="result">
      <!-- 总结果 -->
      <div class="card" style="margin-top: 14px">
        <header>
          <h2>整批排样结果</h2>
          <span class="hint no-print">{{ invariants?.ok ? '不变量自检通过' : '自检失败' }}</span>
        </header>
        <div class="banner bad" v-for="(m, i) in invariants && !invariants.ok ? invariants.messages : []" :key="i">{{ m }}</div>
        <div class="banner bad" v-if="result.oversize.length">
          超板料件（不合排，需换大板或分件拼接）：
          <span v-for="(o, i) in result.oversize" :key="i">{{ o.ownerName }}-{{ o.label }} {{ o.wMm }}×{{ o.hMm }}；</span>
        </div>
        <div class="kv-list" style="grid-template-columns: repeat(4, auto 1fr)">
          <span class="muted">参与门头</span><span>{{ result.owners.length }} 家，{{ result.owners.reduce((s, o) => s + o.pieceCount, 0) }} 件料</span>
          <span class="muted">板材</span><span>{{ result.spec.spec }}</span>
          <span class="muted">分开排</span><span><b>{{ result.baselineSheets }}</b> 张 · ¥{{ yuan(result.baselineCents) }} · 利用率 {{ (result.baselineUtilization * 100).toFixed(1) }}%</span>
          <span class="muted">集中合排</span><span><b>{{ result.sheetCount }}</b> 张 · ¥{{ yuan(result.totalCents) }} · 利用率 {{ (result.utilization * 100).toFixed(1) }}%</span>
          <span class="muted">省下</span><span class="mono"><b style="color: #116b3b">{{ result.savedSheets }} 张板 / ¥{{ yuan(result.savedCents) }}</b></span>
          <span class="muted">分摊校验</span><span class="mono">Σ各户 ¥{{ yuan(result.owners.reduce((s, o) => s + o.allocatedCents, 0)) }} = 整批 ¥{{ yuan(result.totalCents) }}</span>
        </div>
        <div class="banner info" v-for="(w, i) in result.warnings" :key="`w${i}`">{{ w }}</div>

        <div class="row no-print" style="margin-top: 10px">
          <button class="primary" @click="exportAll">导出全部（汇总xls + 取件/裁切/分摊 CSV）</button>
          <button @click="exportPickListCsv(result)">取件清单 CSV</button>
          <button @click="exportCutListCsv(result)">裁切清单 CSV</button>
          <button @click="exportAllocationCsv(result)">分摊结果 CSV</button>
          <button @click="printPage">打印 / PDF</button>
        </div>
      </div>

      <!-- 走法 A vs B -->
      <div class="card" style="margin-top: 14px">
        <header>
          <h2>两种合排走法：为什么选 A、B 何时翻案</h2>
        </header>
        <table>
          <thead>
            <tr><th>走法</th><th class="num">板数</th><th class="num">同户被夹断的板</th><th>整块拿走</th><th>结论</th></tr>
          </thead>
          <tbody>
            <tr class="row-active">
              <td><b>A 先各自装箱再合并</b><div class="muted">BFD 分最少板 → 板内按户收拢成连续带</div></td>
              <td class="num"><b>{{ result.sheetCount }}</b></td>
              <td class="num">0</td>
              <td>✅ 每家一条横带，一刀切走</td>
              <td><b>本工具采用</b>；户内料层与单户排样完全一致，板数已是 BFD 最少</td>
            </tr>
            <tr>
              <td>B 先全批合成一趟再按门头回拆<div class="muted">同一批料层全局高低铺满（裸排，不收拢）</div></td>
              <td class="num">{{ result.planB.sheets }}</td>
              <td class="num">{{ result.planB.contaminatedSheets }} 张 / {{ result.planB.brokenPairs }} 处</td>
              <td :style="{ color: result.planB.contaminatedSheets > 0 ? '#9b1c1c' : undefined }">
                {{ result.planB.contaminatedSheets > 0 ? '❌ 有 A-B-A 夹断' : '✅ 本批恰好不夹断' }}
              </td>
              <td>
                补整块约束 = 把板内按户收拢，板数 {{ result.planB.constrainedSheets }} 张与 A 相同，却拿不回单户原样料层 → <b>不划算</b>
              </td>
            </tr>
          </tbody>
        </table>
        <ul class="notes" style="margin-top: 8px">
          <li><b>本场景 B 为什么不划算：</b>料层都是板宽贯通的长条，A 与 B 的板数由同一维装箱决定（本工具 BFD 已取最少 {{ result.sheetCount }} 张）；B 唯一的差别是板内保持全局顺序，出现 A-B-A 时某家的字被别户夹在中间、要分两段取，违反整块拿走。把 B 补成整块就得板内按户收拢，结果就是 A——板数相同，且 A 保留了各户自己家排出来的料层原样（车间各干各的、合并只动分页）。</li>
          <li><b>什么条件翻到 B：</b>只有当「① 全批一趟的全局装箱比各自装箱后合并用到更细的粒度（例如允许跨户把同一块料件重排进别家料层内部、90° 转向混排），实际板数严格更少，且 ② 板内裸排没有任何同户夹断、每家仍能整段拿走」两个条件同时成立时才翻；一旦仍需夹断，按冲突仲裁规则以整块拿走为准，不翻。</li>
        </ul>
      </div>

      <!-- 拼版图 -->
      <div class="card" style="margin-top: 14px">
        <header>
          <h2>整批拼版图（{{ result.spec.wMm }}×{{ result.spec.hMm }}mm，锯缝 {{ result.spec.kerfMm }}mm）</h2>
          <span class="hint">每种颜色一户；同色一整条横带即可整块拿走；斜灰区为板尾余料</span>
        </header>
        <BatchSheetDiagram :result="result" />
      </div>

      <!-- 余料处置 -->
      <div class="card" style="margin-top: 14px" v-if="result.sheets.some((s) => s.remnant)">
        <header>
          <h2>单户板板尾余料：让不让、钱归谁</h2>
          <span class="hint">某块板只剩一家人的活时，板边那片料可让给下一家（用于它别的活）；计价三选一</span>
        </header>
        <table>
          <thead>
            <tr><th>板号</th><th>占用户（让出方）</th><th class="num">余料 mm</th><th>处置</th><th>受让方</th><th>让出方分担比例</th></tr>
          </thead>
          <tbody>
            <tr v-for="s in result.sheets.filter((x) => x.remnant)" :key="s.index">
              <td>第 {{ s.index + 1 }} 张</td>
              <td>{{ ownerName(s.remnant!.ownerId) }}</td>
              <td class="num">{{ s.remnant!.wMm }}×{{ Math.round(s.remnant!.hMm) }}</td>
              <td>
                <select :value="modeOf(s.index)" @change="setMode(s.index, ($event.target as HTMLSelectElement).value as RemnantMode)">
                  <option value="keep">① 自留（不让料，板钱全归占用戶）</option>
                  <option value="ratio">③ 约定比例分担（推荐）</option>
                  <option value="actual">② 按实际占用（让出方承担整板）</option>
                  <option value="orig">② 按各家原始用量分</option>
                </select>
              </td>
              <td>
                <select
                  :value="remnantReceiver[s.index] ?? ''"
                  :disabled="modeOf(s.index) === 'keep'"
                  @change="setReceiver(s.index, ($event.target as HTMLSelectElement).value)"
                >
                  <option v-for="j in jobs.filter((x) => x.ownerId !== s.remnant!.ownerId)" :key="j.ownerId" :value="j.ownerId">{{ j.ownerName }}</option>
                </select>
              </td>
              <td>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="5"
                  :disabled="modeOf(s.index) !== 'ratio'"
                  :value="Math.round(giverRatio * 100)"
                  @input="giverRatio = Number(($event.target as HTMLInputElement).value) / 100"
                />%
              </td>
            </tr>
          </tbody>
        </table>
        <ul class="notes" style="margin-top: 8px">
          <li><b>选定 ③ 约定比例（默认让出方 50%）：</b>受让方出了钱、拿到可用于自己后续活的整片余料；让出方也因让料少掏一半，两家都有动机，且比例写进分摊表。</li>
          <li><b>若选「按实际占用」：</b>让出方占了全部生产区，板钱 100% 归它、受让方 0 元拿料——受让方白拿材料，让出方比自留还亏，材料流向和钱对不上实际使用，容易让让出方多掏（两家账虽能配平整批，但没人愿意当让出方）。</li>
          <li><b>若选「按各家原始用量」：</b>按两户独立排时的用板张数比例分这一张板的钱，与这张板上谁实际占用了多少无关——用板多的大户给与自己无关的余料板长期贴钱，会把两家在别块板上的实际账搅在一起；按原始用量各自四舍五入还会出现分摊之和与整批合计差几分钱的口径问题，必须再做余差摊回。</li>
        </ul>
      </div>

      <!-- 逐户对比 + 取件 + 裁切 + 分摊 -->
      <div class="card" style="margin-top: 14px">
        <header>
          <h2>按门头拆回：逐项对比、取件清单、裁切清单、分摊</h2>
          <span class="hint">每家一份，可单独导出分发</span>
        </header>
        <table>
          <thead>
            <tr>
              <th>门头</th><th class="num">料件</th><th class="num">分开排(张)</th><th class="num">分开排板钱</th>
              <th class="num">合排分摊</th><th class="num">省板</th><th class="num">省钱</th><th>取/裁清单</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="o in result.owners" :key="o.ownerId">
              <td><b>{{ o.ownerName }}</b></td>
              <td class="num">{{ o.pieceCount }}</td>
              <td class="num">{{ o.standaloneSheets }}</td>
              <td class="num">¥{{ yuan(o.standaloneCents) }}</td>
              <td class="num">¥{{ yuan(o.allocatedCents) }}</td>
              <td class="num">{{ o.standaloneSheets - new Set(o.pick.filter((p) => p.kind === 'pieces').map((p) => p.boardNo)).size }} 张</td>
              <td class="num" :style="{ color: o.savedCents >= 0 ? '#116b3b' : '#9b1c1c' }">{{ o.savedCents >= 0 ? '省' : '增' }} ¥{{ yuan(Math.abs(o.savedCents)) }}</td>
              <td class="no-print">
                <button @click="exportPickListCsv(result, o)">取件</button>
                <button @click="exportCutListCsv(result, o)">裁切</button>
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td>合计</td>
              <td class="num">{{ result.owners.reduce((s, o) => s + o.pieceCount, 0) }}</td>
              <td class="num">{{ result.baselineSheets }}</td>
              <td class="num">¥{{ yuan(result.baselineCents) }}</td>
              <td class="num">¥{{ yuan(result.totalCents) }}</td>
              <td class="num">{{ result.savedSheets }}</td>
              <td class="num">¥{{ yuan(result.savedCents) }}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
        <p class="muted">「省钱」为负（增）表示该户在合排中承担的分摊高于其独立排板钱——通常发生在它占用了合排版却没省下整板、或作为受让方分担了让料板费用；整批合计仍严格等于分开排总额减省板钱。</p>
      </div>

      <!-- 每家明细（打印友好） -->
      <div class="card" style="margin-top: 14px" v-for="o in result.owners" :key="`d${o.ownerId}`">
        <header>
          <h2>{{ o.ownerName }} · 取件与裁切</h2>
          <span class="hint no-print">
            <button @click="exportPickListCsv(result, o)">导出取件 CSV</button>
            <button @click="exportCutListCsv(result, o)">导出裁切 CSV</button>
          </span>
        </header>
        <div class="split" style="align-items: start">
          <div>
            <h3>取件清单（在哪块板的哪一片、几件）</h3>
            <table>
              <thead><tr><th>板号</th><th>片区/余料</th><th class="num">件数</th><th>料件</th><th>备注</th></tr></thead>
              <tbody>
                <tr v-for="(row, i) in o.pick" :key="i">
                  <td>第 {{ row.boardNo }} 张</td>
                  <td>{{ row.bandText }}</td>
                  <td class="num">{{ row.count }}</td>
                  <td class="muted">{{ row.labels.slice(0, 8).join(' ') }}{{ row.labels.length > 8 ? '…' : '' }}</td>
                  <td class="muted">{{ row.note }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div>
            <h3>裁切清单（同尺寸合并，标注所在板）</h3>
            <table>
              <thead><tr><th>料件</th><th class="num">宽</th><th class="num">高</th><th class="num">数量</th><th>板</th></tr></thead>
              <tbody>
                <tr v-for="(c, i) in o.cut" :key="i">
                  <td>{{ c.label }}</td><td class="num">{{ c.wMm }}</td><td class="num">{{ c.hMm }}</td>
                  <td class="num">{{ c.count }}</td><td class="num">{{ c.boards.map((b) => `第${b}张`).join(' ') }}</td>
                </tr>
              </tbody>
            </table>
            <h3 style="margin-top: 12px">板钱分摊明细</h3>
            <table>
              <thead><tr><th>板号</th><th>计价</th><th class="num">分摊</th><th>说明</th></tr></thead>
              <tbody>
                <tr v-for="(a, i) in o.allocations" :key="i">
                  <td>第 {{ a.boardNo }} 张</td>
                  <td>{{ a.basis === 'area' ? '按占用面积' : a.basis.includes('ratio') ? '约定比例' : a.basis.includes('orig') ? '原始用量' : '按实际占用' }}</td>
                  <td class="num">¥{{ yuan(a.cents) }}</td>
                  <td class="muted">{{ a.note }}</td>
                </tr>
              </tbody>
              <tfoot><tr><td colspan="2">小计</td><td class="num">¥{{ yuan(o.allocatedCents) }}</td><td></td></tr></tfoot>
            </table>
          </div>
        </div>
      </div>

      <!-- 政策说明（打印保留） -->
      <div class="card" style="margin-top: 14px">
        <header><h2>说明（取件清单 / 裁切清单 / 分摊导出同此口径）</h2></header>
        <ul class="notes">
          <li v-for="(p, i) in [STRATEGY_NOTE, PRIORITY_RULE, ...result.warnings]" :key="i">{{ p }}</li>
          <li>分摊精度到「分」：单张板按面积比例的零头用最大余额法（余额大者多分 1 分）收齐；各户分摊之和 {{ result.owners.reduce((s, o) => s + o.allocatedCents, 0) === result.totalCents ? '已核对 = 整批合计' : '不平！' }}。</li>
          <li>板材：{{ result.spec.spec }}，¥{{ yuan(result.spec.priceCents) }}/张；分开排 {{ result.baselineSheets }} 张、合排 {{ result.sheetCount }} 张，省 {{ result.savedSheets }} 张 / ¥{{ yuan(result.savedCents) }}。</li>
        </ul>
      </div>
    </template>

    <div v-else class="card" style="margin-top: 14px">
      <p class="muted">勾选至少 2 个门头（或载入演示数据），即按同一板材做集中开料。</p>
    </div>
  </div>
</template>
