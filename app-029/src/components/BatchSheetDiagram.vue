<script setup lang="ts">
import { computed } from 'vue'
import type { BatchSheet } from '../logic/batchNesting'

const props = defineProps<{
  sheets: BatchSheet[]
  sheetW: number
  sheetH: number
  ownerNames: Map<string, string>
  active?: number
}>()

// 每家门头固定一色（与列表图例一致）
const PALETTE = ['#cfe3d0', '#d7e3f5', '#f6e2c0', '#ead7f2', '#f5d2d2', '#cfeaea', '#e8e6c0', '#d9d9f5']
const colorOf = (id: string): string => {
  const ids = [...props.ownerNames.keys()].sort()
  return PALETTE[ids.indexOf(id) % PALETTE.length] ?? '#e6e6e6'
}

const labelSize = computed(() => Math.max(props.sheetW, props.sheetH) * 0.02)
const viewBox = computed(() => `-10 -10 ${props.sheetW + 20} ${props.sheetH + 20}`)
</script>

<template>
  <div class="grid" :style="{ gridTemplateColumns: sheets.length > 1 ? 'repeat(2, minmax(0,1fr))' : 'minmax(0,1fr)' }">
    <div v-for="s in sheets" :key="s.index">
      <svg class="sheet-svg" :viewBox="viewBox">
        <rect :x="0" :y="0" :width="sheetW" :height="sheetH" fill="#ffffff" stroke="#a9b4c6" :stroke-width="labelSize * 0.35" />
        <!-- 整块区域底色（按门头着色） -->
        <rect
          v-for="(r, i) in s.regions"
          :key="`r${i}`"
          :x="r.x0"
          :y="r.y0"
          :width="r.widthMm"
          :height="r.heightMm"
          :fill="colorOf(r.ownerId)"
          fill-opacity="0.35"
          :stroke="colorOf(r.ownerId)"
          :stroke-width="labelSize * 0.4"
          stroke-dasharray="14 8"
        />
        <!-- 横向贯通切线 -->
        <line
          v-for="(y, i) in s.horizontalCutYs"
          :key="`h${i}`"
          :x1="0"
          :y1="y"
          :x2="sheetW"
          :y2="y"
          stroke="#9aa7bd"
          :stroke-width="labelSize * 0.1"
          stroke-dasharray="8 6"
        />
        <!-- 竖切回拆线（走法 B） -->
        <line
          v-for="(v, i) in s.verticalCuts"
          :key="`v${i}`"
          :x1="v.x"
          :y1="v.y0"
          :x2="v.x"
          :y2="v.y1"
          stroke="#c08a3e"
          :stroke-width="labelSize * 0.12"
          stroke-dasharray="6 5"
        />
        <!-- 料件 -->
        <g v-for="(p, i) in s.pieces" :key="`p${i}`">
          <rect
            :x="p.x"
            :y="p.y"
            :width="p.wMm"
            :height="p.hMm"
            :fill="colorOf(p.ownerId)"
            stroke="#3d5a46"
            :stroke-width="labelSize * 0.13"
          />
          <text
            :x="p.x + p.wMm / 2"
            :y="p.y + p.hMm / 2"
            class="svg-label"
            text-anchor="middle"
            dominant-baseline="middle"
            :style="{ fontSize: Math.max(9, Math.min(p.wMm, p.hMm) * 0.26) + 'px' }"
          >
            {{ p.label }}
          </text>
        </g>
      </svg>
      <p class="muted">
        第 {{ s.index + 1 }} 张：{{ s.pieces.length }} 件，
        <span v-for="(id, i) in s.ownerIds" :key="id">
          <b :style="{ color: '#33513d' }">{{ ownerNames.get(id) ?? id }}</b>（{{ s.regions.filter((r) => r.ownerId === id).length }} 片）{{ i < s.ownerIds.length - 1 ? '、' : '' }}
        </span>
        ；利用率 {{ (s.utilization * 100).toFixed(1) }}%<template v-if="s.letInfo">；<b>让料板</b></template>
      </p>
    </div>
  </div>
</template>
