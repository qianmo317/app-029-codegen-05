<script setup lang="ts">
import { computed } from 'vue'
import { ownerColor, type BatchResult } from '../logic/batchNesting'

const props = defineProps<{
  result: BatchResult
}>()

const ownerIds = computed(() => props.result.owners.map((o) => o.ownerId))
const ownerName = (id: string): string => props.result.owners.find((o) => o.ownerId === id)?.ownerName ?? id
const viewBox = computed(() => `-10 -10 ${props.result.spec.wMm + 20} ${props.result.spec.hMm + 20}`)
const decisions = computed(() => new Map(props.result.decisions.map((d) => [d.sheetIndex, d])))

function color(id: string): string {
  return ownerColor(id, ownerIds.value)
}
</script>

<template>
  <div class="grid" :style="{ gridTemplateColumns: result.sheets.length > 1 ? 'repeat(2, minmax(0,1fr))' : 'minmax(0,1fr)' }">
    <div v-for="s in result.sheets" :key="s.index">
      <svg class="sheet-svg" :viewBox="viewBox">
        <rect x="0" y="0" :width="result.spec.wMm" :height="result.spec.hMm" fill="#ffffff" stroke="#a9b4c6" :stroke-width="6" />
        <!-- 各户整片（带）底色 -->
        <rect
          v-for="(b, i) in s.bands"
          :key="`b${i}`"
          :x="0"
          :y="b.y0"
          :width="result.spec.wMm"
          :height="b.heightMm"
          :fill="color(b.ownerId)"
          fill-opacity="0.12"
          :stroke="color(b.ownerId)"
          :stroke-width="3"
        />
        <!-- 料件 -->
        <template v-for="(b, bi) in s.bands" :key="`p${bi}`">
          <rect
            v-for="(p, i) in b.pieces"
            :key="i"
            :x="p.x"
            :y="p.y"
            :width="p.wMm"
            :height="p.hMm"
            :fill="p.rotated ? '#e8f1ff' : '#f2f7ee'"
            :stroke="color(b.ownerId)"
            :stroke-width="2.5"
          />
          <text
            v-for="(p, i) in b.pieces"
            :key="`t${i}`"
            :x="p.x + p.wMm / 2"
            :y="p.y + p.hMm / 2"
            class="svg-label"
            text-anchor="middle"
            dominant-baseline="middle"
            :style="{ fontSize: Math.max(9, Math.min(p.wMm, p.hMm) * 0.26) + 'px' }"
          >
            {{ p.label }}
          </text>
          <!-- 片区标签（左上角门头名） -->
          <text
            :x="8"
            :y="b.y0 + Math.max(16, b.heightMm * 0.05)"
            class="svg-label"
            :fill="color(b.ownerId)"
            :style="{ fontSize: Math.max(12, b.heightMm * 0.04) + 'px', fontWeight: 700 }"
          >
            {{ ownerName(b.ownerId) }}（整条拿走）
          </text>
        </template>
        <!-- 板尾余料 -->
        <rect
          v-if="s.remnant"
          :x="0"
          :y="s.remnant.y"
          :width="s.remnant.wMm"
          :height="s.remnant.hMm"
          fill="#f6f6f6"
        />
        <rect
          v-if="s.remnant"
          :x="0"
          :y="s.remnant.y"
          :width="s.remnant.wMm"
          :height="s.remnant.hMm"
          fill="none"
          stroke="#999"
          stroke-width="2"
          stroke-dasharray="10 8"
        />
        <text
          v-if="s.remnant"
          :x="result.spec.wMm / 2"
          :y="s.remnant.y + s.remnant.hMm / 2"
          class="svg-label"
          text-anchor="middle"
          dominant-baseline="middle"
          style="font-size: 16px; fill: #777"
        >
          板尾余料 {{ s.remnant.wMm }}×{{ Math.round(s.remnant.hMm) }}mm（{{ ownerName(s.remnant.ownerId) }}）
        </text>
      </svg>
      <p class="muted">
        第 {{ s.index + 1 }} 张：
        <template v-for="(a, oid) in [...s.byOwner.values()]" :key="oid">
          <span :style="{ color: color(a.ownerId) }">●</span> {{ ownerName(a.ownerId) }}
          {{ a.bands.reduce((n: number, b) => n + b.pieces.length, 0) }} 件 /
          横带 {{ a.bands.map((b) => `${Math.round(b.y0)}–${Math.round(b.y1)}`).join('、') }}；
        </template>
        <template v-if="s.remnant">
          余料处置：<b>{{ decisions.get(s.index)?.mode === 'keep' ? '自留' : decisions.get(s.index)?.mode === 'actual' ? '按实际占用让出' : decisions.get(s.index)?.mode === 'orig' ? '按原始用量让出' : '约定比例让出' }}</b>
        </template>
      </p>
    </div>
  </div>
</template>
