<template>
  <div class="report-generator bg-gray-900/60 rounded-lg border border-gray-800 p-4">
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-lg font-semibold text-purple-400 flex items-center gap-2">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        分析报告生成
      </h3>
    </div>

    <!-- Report Settings -->
    <div class="space-y-4 mb-4">
      <!-- Patient ID -->
      <div>
        <label class="block text-sm font-medium text-gray-300 mb-1">患者ID (可选)</label>
        <input
          v-model="store.patientId"
          type="text"
          placeholder="输入患者标识"
          class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500 transition-colors"
        />
      </div>

      <!-- Export Format -->
      <div>
        <label class="block text-sm font-medium text-gray-300 mb-1">导出格式</label>
        <div class="flex gap-2">
          <button
            v-for="fmt in REPORT_FORMATS"
            :key="fmt.value"
            @click="store.reportExportFormat = fmt.value"
            :class="[
              'flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all',
              store.reportExportFormat === fmt.value
                ? 'bg-purple-600 text-white'
                : 'bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-600',
            ]"
          >
            {{ fmt.label }}
          </button>
        </div>
      </div>

      <!-- Snapshot Options -->
      <div class="flex items-center justify-between">
        <label class="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
          <input
            v-model="store.includeSnapshots"
            type="checkbox"
            class="w-4 h-4 rounded accent-purple-500"
          />
          包含波形截图
        </label>
        <div v-if="store.includeSnapshots" class="flex items-center gap-2">
          <span class="text-xs text-gray-400">截图数量:</span>
          <select
            v-model.number="store.snapshotCount"
            class="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-purple-500"
          >
            <option :value="1">1 张</option>
            <option :value="2">2 张</option>
            <option :value="3">3 张</option>
            <option :value="4">4 张</option>
            <option :value="5">5 张</option>
          </select>
        </div>
      </div>
    </div>

    <!-- Action Buttons -->
    <div class="space-y-2">
      <button
        @click="handleGenerateReport"
        :disabled="!store.hasAnalysisData || store.isGeneratingReport"
        :class="[
          'w-full py-2.5 rounded-lg font-medium text-sm transition-all flex items-center justify-center gap-2',
          !store.hasAnalysisData || store.isGeneratingReport
            ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
            : 'bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-600/20',
        ]"
      >
        <svg v-if="store.isGeneratingReport" class="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        {{ store.isGeneratingReport ? '生成报告中...' : '生成分析报告' }}
      </button>

      <div v-if="store.currentReport" class="grid grid-cols-2 gap-2">
        <button
          @click="handlePreview"
          class="py-2 px-3 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white transition-all flex items-center justify-center gap-1"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          预览
        </button>
        <button
          @click="handleExport"
          :disabled="store.isExportingReport"
          :class="[
            'py-2 px-3 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-1',
            store.isExportingReport
              ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
              : 'bg-emerald-600 hover:bg-emerald-500 text-white',
          ]"
        >
          <svg v-if="store.isExportingReport" class="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          {{ store.isExportingReport ? '导出中...' : '导出报告' }}
        </button>
      </div>
    </div>

    <!-- Report Preview Card -->
    <div v-if="store.currentReport" class="mt-4 pt-4 border-t border-gray-700/50">
      <h4 class="text-sm font-semibold text-gray-300 mb-3">报告摘要</h4>
      <div class="bg-gray-800/50 rounded-lg p-3 space-y-2 text-sm">
        <div class="flex justify-between">
          <span class="text-gray-400">报告编号:</span>
          <span class="text-purple-300 font-mono">{{ store.currentReport.reportId }}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-gray-400">生成时间:</span>
          <span class="text-gray-300">{{ formatDate(store.currentReport.generatedAt) }}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-gray-400">主导心律:</span>
          <span :class="store.currentReport.summary.hasArrhythmia ? 'text-red-400' : 'text-emerald-400'">
            {{ store.currentReport.summary.dominantRhythm }}
          </span>
        </div>
        <div class="flex justify-between">
          <span class="text-gray-400">异常心跳:</span>
          <span :class="store.currentReport.summary.abnormalBeats > 0 ? 'text-red-400' : 'text-emerald-400'">
            {{ store.currentReport.summary.abnormalBeats }} 次
          </span>
        </div>
        <div class="flex justify-between">
          <span class="text-gray-400">波形截图:</span>
          <span class="text-cyan-400">{{ store.currentReport.waveformSnapshots.length }} 张</span>
        </div>
      </div>
    </div>

    <!-- No Data Warning -->
    <div v-if="!store.hasAnalysisData" class="mt-4 p-3 bg-amber-900/20 border border-amber-700/30 rounded-lg">
      <p class="text-amber-300 text-sm flex items-center gap-2">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        请先进行心电分析后再生成报告
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useECGStore } from '../store/ecg';
import { REPORT_FORMATS } from '../types';

const store = useECGStore();

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function handleGenerateReport() {
  try {
    await store.generateReport();
  } catch (error) {
    console.error('Failed to generate report:', error);
  }
}

function handlePreview() {
  if (store.currentReport) {
    store.previewReport(store.currentReport);
  }
}

async function handleExport() {
  try {
    await store.exportReport();
  } catch (error) {
    console.error('Failed to export report:', error);
  }
}
</script>

<style scoped>
/* Custom styles if needed */
</style>
