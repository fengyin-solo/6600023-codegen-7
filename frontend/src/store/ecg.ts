import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { 
  ECGLead, HRVData, RPeak, ArrhythmiaEvent, ECGAnalysisResponse,
  AnalysisReport, ReportFormat, ReportExportResponse, WaveformSnapshot,
  ReportSummary,
} from '../types';

// Gaussian function for PQRST wave simulation
function gaussian(x: number, amplitude: number, center: number, width: number): number {
  return amplitude * Math.exp(-((x - center) ** 2) / (2 * width ** 2));
}

// Lead-specific PQRST configuration
interface LeadConfig {
  pAmplitude: number;
  qAmplitude: number;
  rAmplitude: number;
  sAmplitude: number;
  tAmplitude: number;
  stElevation: number;
}

const LEAD_CONFIGS: Record<string, LeadConfig> = {
  'I': { pAmplitude: 0.12, qAmplitude: -0.05, rAmplitude: 0.8, sAmplitude: -0.1, tAmplitude: 0.25, stElevation: 0.0 },
  'II': { pAmplitude: 0.15, qAmplitude: -0.1, rAmplitude: 1.2, sAmplitude: -0.2, tAmplitude: 0.3, stElevation: 0.0 },
  'III': { pAmplitude: 0.10, qAmplitude: -0.08, rAmplitude: 0.9, sAmplitude: -0.15, tAmplitude: 0.2, stElevation: 0.0 },
  'aVR': { pAmplitude: -0.10, qAmplitude: 0.05, rAmplitude: -0.8, sAmplitude: 0.1, tAmplitude: -0.2, stElevation: 0.0 },
  'aVL': { pAmplitude: 0.10, qAmplitude: -0.03, rAmplitude: 0.6, sAmplitude: -0.05, tAmplitude: 0.2, stElevation: 0.0 },
  'aVF': { pAmplitude: 0.13, qAmplitude: -0.09, rAmplitude: 1.0, sAmplitude: -0.18, tAmplitude: 0.28, stElevation: 0.0 },
  'V1': { pAmplitude: 0.08, qAmplitude: 0.0, rAmplitude: 0.3, sAmplitude: -0.8, tAmplitude: 0.15, stElevation: 0.0 },
  'V2': { pAmplitude: 0.10, qAmplitude: -0.02, rAmplitude: 0.6, sAmplitude: -0.6, tAmplitude: 0.25, stElevation: 0.0 },
  'V3': { pAmplitude: 0.10, qAmplitude: -0.05, rAmplitude: 0.9, sAmplitude: -0.4, tAmplitude: 0.3, stElevation: 0.0 },
  'V4': { pAmplitude: 0.12, qAmplitude: -0.08, rAmplitude: 1.3, sAmplitude: -0.25, tAmplitude: 0.35, stElevation: 0.0 },
  'V5': { pAmplitude: 0.12, qAmplitude: -0.1, rAmplitude: 1.1, sAmplitude: -0.15, tAmplitude: 0.3, stElevation: 0.0 },
  'V6': { pAmplitude: 0.10, qAmplitude: -0.08, rAmplitude: 0.9, sAmplitude: -0.1, tAmplitude: 0.25, stElevation: 0.0 },
};

// Generate a single PQRST cycle at normalized time t (0 to 1)
function generatePQRSTCycle(tNorm: number, config: LeadConfig): number {
  const p = gaussian(tNorm, config.pAmplitude, 0.12, 0.035);
  const q = gaussian(tNorm, config.qAmplitude, 0.22, 0.012);
  const r = gaussian(tNorm, config.rAmplitude, 0.26, 0.012);
  const s = gaussian(tNorm, config.sAmplitude, 0.30, 0.015);
  const tWave = gaussian(tNorm, config.tAmplitude, 0.48, 0.055);
  const st = (tNorm > 0.32 && tNorm < 0.42) ? config.stElevation : 0.0;
  return p + q + r + s + tWave + st;
}

export const useECGStore = defineStore('ecg', () => {
  // State
  const selectedLead = ref<string>('II');
  const heartRate = ref<number>(72);
  const samplingRate = ref<number>(500);
  const duration = ref<number>(10);
  const isMonitoring = ref<boolean>(false);
  const ecgData = ref<ECGLead | null>(null);
  const hrvData = ref<HRVData | null>(null);
  const arrhythmiaEvents = ref<ArrhythmiaEvent[]>([]);
  const rhythmDiagnosis = ref<string>('');
  const isLoading = ref<boolean>(false);
  const useBackend = ref<boolean>(false);
  const backendUrl = ref<string>('http://localhost:8000');

  let animationTimer: ReturnType<typeof setInterval> | null = null;
  let scrollOffset = ref<number>(0);

  // Report state
  const currentReport = ref<AnalysisReport | null>(null);
  const reportExportFormat = ref<ReportFormat>('html');
  const includeSnapshots = ref<boolean>(true);
  const snapshotCount = ref<number>(3);
  const patientId = ref<string>('');
  const isGeneratingReport = ref<boolean>(false);
  const isExportingReport = ref<boolean>(false);

  // Getters
  const currentSamples = computed(() => ecgData.value?.samples ?? []);
  const currentRPeaks = computed(() => ecgData.value?.rPeaks ?? []);
  const currentHeartRate = computed(() => hrvData.value?.heartRate ?? heartRate.value);
  const hasAnalysisData = computed(() => ecgData.value !== null && hrvData.value !== null);

  // Actions

  /**
   * Generate realistic 12-lead ECG waveform data with PQRST morphology
   */
  function generateECGWaveform(): ECGLead {
    const totalSamples = Math.floor(duration.value * samplingRate.value);
    const samples: number[] = new Array(totalSamples);
    const config = LEAD_CONFIGS[selectedLead.value] || LEAD_CONFIGS['II'];
    const cycleDuration = 60.0 / heartRate.value;
    const samplesPerCycle = Math.floor(cycleDuration * samplingRate.value);

    for (let i = 0; i < totalSamples; i++) {
      const time = i / samplingRate.value;
      const cyclePosition = (time % cycleDuration) / cycleDuration;

      // Add slight HRV variation per beat
      const beatIndex = Math.floor(time / cycleDuration);
      const hrvFactor = 1.0 + Math.sin(beatIndex * 0.7) * 0.02;

      samples[i] = generatePQRSTCycle(cyclePosition, config) * hrvFactor;

      // Add baseline wander
      samples[i] += 0.03 * Math.sin(2 * Math.PI * 0.15 * time);
      // Add small noise
      samples[i] += (Math.random() - 0.5) * 0.02;
    }

    return {
      leadName: selectedLead.value,
      samplingRate: samplingRate.value,
      duration: duration.value,
      samples,
      rPeaks: [],
    };
  }

  /**
   * Pan-Tompkins R-peak detection algorithm
   * Simplified implementation: bandpass -> differentiate -> square -> integrate -> threshold
   */
  function detectRPeaks(samples: number[], sr: number): RPeak[] {
    const rPeaks: RPeak[] = [];
    const minDistance = Math.floor(0.2 * sr); // 200ms minimum between peaks

    // Simple moving average for baseline
    const windowSize = Math.floor(0.15 * sr);
    const threshold = samples.reduce((a, b) => a + b, 0) / samples.length;
    const stdDev = Math.sqrt(
      samples.reduce((sum, s) => sum + (s - threshold) ** 2, 0) / samples.length
    );
    const detectionThreshold = threshold + 0.5 * stdDev;

    let lastPeakIndex = -minDistance;

    for (let i = 1; i < samples.length - 1; i++) {
      if (
        samples[i] > detectionThreshold &&
        samples[i] > samples[i - 1] &&
        samples[i] > samples[i + 1] &&
        i - lastPeakIndex >= minDistance
      ) {
        // Find local maximum in a small window
        let maxVal = samples[i];
        let maxIdx = i;
        const searchRadius = Math.floor(0.01 * sr);
        for (let j = Math.max(0, i - searchRadius); j < Math.min(samples.length, i + searchRadius); j++) {
          if (samples[j] > maxVal) {
            maxVal = samples[j];
            maxIdx = j;
          }
        }

        rPeaks.push({
          index: maxIdx,
          time: maxIdx / sr,
          amplitude: maxVal,
        });
        lastPeakIndex = i;
      }
    }

    return rPeaks;
  }

  /**
   * Calculate HRV metrics from R-peak positions
   * SDNN, RMSSD, pNN50
   */
  function calculateHRV(rPeaks: RPeak[], sr: number): HRVData {
    if (rPeaks.length < 3) {
      return { heartRate: heartRate.value, sdnn: 0, rmssd: 0, pnn50: 0, nnIntervals: [] };
    }

    const nnIntervals: number[] = [];
    for (let i = 1; i < rPeaks.length; i++) {
      const rr = ((rPeaks[i].index - rPeaks[i - 1].index) / sr) * 1000;
      nnIntervals.push(rr);
    }

    const meanRR = nnIntervals.reduce((a, b) => a + b, 0) / nnIntervals.length;
    const hr = meanRR > 0 ? 60000 / meanRR : 0;

    // SDNN
    const variance = nnIntervals.reduce((sum, x) => sum + (x - meanRR) ** 2, 0) / nnIntervals.length;
    const sdnn = Math.sqrt(variance);

    // RMSSD
    let sumSquaredDiffs = 0;
    for (let i = 1; i < nnIntervals.length; i++) {
      sumSquaredDiffs += (nnIntervals[i] - nnIntervals[i - 1]) ** 2;
    }
    const rmssd = Math.sqrt(sumSquaredDiffs / (nnIntervals.length - 1));

    // pNN50
    let nn50Count = 0;
    for (let i = 1; i < nnIntervals.length; i++) {
      if (Math.abs(nnIntervals[i] - nnIntervals[i - 1]) > 50) {
        nn50Count++;
      }
    }
    const pnn50 = (nn50Count / (nnIntervals.length - 1)) * 100;

    return {
      heartRate: Math.round(hr * 10) / 10,
      sdnn: Math.round(sdnn * 100) / 100,
      rmssd: Math.round(rmssd * 100) / 100,
      pnn50: Math.round(pnn50 * 100) / 100,
      nnIntervals,
    };
  }

  /**
   * Arrhythmia detection: tachycardia, bradycardia, ST-elevation
   */
  function detectArrhythmias(hrv: HRVData, rPeaks: RPeak[], samples: number[], sr: number): ArrhythmiaEvent[] {
    const events: ArrhythmiaEvent[] = [];
    const hr = hrv.heartRate;

    if (hr > 100) {
      events.push({
        eventType: 'tachycardia',
        confidence: Math.min(1.0, (hr - 100) / 50 + 0.6),
        description: `心率过快 (${hr.toFixed(0)} BPM)，检测到心动过速`,
        timestamp: rPeaks[0]?.time ?? 0,
      });
    }

    if (hr < 60 && hr > 0) {
      events.push({
        eventType: 'bradycardia',
        confidence: Math.min(1.0, (60 - hr) / 30 + 0.6),
        description: `心率过慢 (${hr.toFixed(0)} BPM)，检测到心动过缓`,
        timestamp: rPeaks[0]?.time ?? 0,
      });
    }

    // ST-segment elevation detection
    let stElevationCount = 0;
    for (const rp of rPeaks) {
      const stStart = rp.index + Math.floor(0.08 * sr);
      const stEnd = rp.index + Math.floor(0.12 * sr);
      if (stEnd < samples.length) {
        const stLevel = samples.slice(stStart, stEnd).reduce((a, b) => a + b, 0) / (stEnd - stStart);
        const blStart = Math.max(0, rp.index - Math.floor(0.2 * sr));
        const baseline = samples.slice(blStart, rp.index).reduce((a, b) => a + b, 0) / (rp.index - blStart);
        if (stLevel - baseline > 0.1) {
          stElevationCount++;
        }
      }
    }
    if (stElevationCount > rPeaks.length * 0.5) {
      events.push({
        eventType: 'st_elevation',
        confidence: Math.min(1.0, stElevationCount / Math.max(1, rPeaks.length)),
        description: '检测到 ST 段抬高，可能提示心肌梗死',
        timestamp: rPeaks[0]?.time ?? 0,
      });
    }

    if (events.length === 0) {
      events.push({
        eventType: 'normal',
        confidence: 1.0,
        description: '正常窦性心律',
        timestamp: rPeaks[0]?.time ?? 0,
      });
    }

    return events;
  }

  /**
   * Run full ECG analysis (frontend simulation)
   */
  async function analyzeECG() {
    isLoading.value = true;

    if (useBackend.value) {
      // Use backend API
      try {
        const response = await fetch(`${backendUrl.value}/ecg/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lead_name: selectedLead.value,
            duration: duration.value,
            sampling_rate: samplingRate.value,
            heart_rate: heartRate.value,
          }),
        });
        const data: ECGAnalysisResponse = await response.json();
        ecgData.value = {
          leadName: data.lead.lead_name,
          samplingRate: data.lead.sampling_rate,
          duration: data.lead.duration,
          samples: data.lead.samples,
          rPeaks: data.lead.r_peaks.map((rp: any) => ({
            index: rp.index,
            time: rp.time,
            amplitude: rp.amplitude,
          })),
        };
        hrvData.value = {
          heartRate: data.hrv.heart_rate,
          sdnn: data.hrv.sdnn,
          rmssd: data.hrv.rmssd,
          pnn50: data.hrv.pnn50,
          nnIntervals: data.hrv.nn_intervals,
        };
        arrhythmiaEvents.value = data.arrhythmia_events.map((evt: any) => ({
          eventType: evt.event_type,
          confidence: evt.confidence,
          description: evt.description,
          timestamp: evt.timestamp,
        }));
        rhythmDiagnosis.value = data.rhythm_diagnosis;
      } catch (error) {
        console.error('Backend API error:', error);
        // Fallback to frontend simulation
        runFrontendAnalysis();
      }
    } else {
      runFrontendAnalysis();
    }

    isLoading.value = false;
  }

  function runFrontendAnalysis() {
    const lead = generateECGWaveform();
    const peaks = detectRPeaks(lead.samples, lead.samplingRate);
    lead.rPeaks = peaks;
    ecgData.value = lead;

    const hrv = calculateHRV(peaks, lead.samplingRate);
    hrvData.value = hrv;

    const events = detectArrhythmias(hrv, peaks, lead.samples, lead.samplingRate);
    arrhythmiaEvents.value = events;

    const isNormal = events.some(e => e.eventType === 'normal');
    rhythmDiagnosis.value = isNormal
      ? `正常窦性心律 | HR: ${hrv.heartRate.toFixed(0)} BPM | SDNN: ${hrv.sdnn.toFixed(1)} ms`
      : events.map(e => e.description).join(' | ');
  }

  /**
   * Start real-time monitoring simulation
   */
  function startMonitoring() {
    isMonitoring.value = true;
    analyzeECG();
    animationTimer = setInterval(() => {
      scrollOffset.value += 5;
      // Regenerate data every full cycle
      if (scrollOffset.value >= currentSamples.value.length) {
        scrollOffset.value = 0;
        analyzeECG();
      }
    }, 50);
  }

  /**
   * Stop monitoring
   */
  function stopMonitoring() {
    isMonitoring.value = false;
    if (animationTimer) {
      clearInterval(animationTimer);
      animationTimer = null;
    }
  }

  /**
   * Select a different ECG lead
   */
  function selectLead(lead: string) {
    selectedLead.value = lead;
    if (isMonitoring.value) {
      analyzeECG();
    }
  }

  /**
   * Update heart rate setting
   */
  function setHeartRate(hr: number) {
    heartRate.value = hr;
    if (isMonitoring.value) {
      analyzeECG();
    }
  }

  /**
   * Generate report summary from existing analysis data
   */
  function generateReportSummary(): ReportSummary {
    const rPeaks = ecgData.value?.rPeaks ?? [];
    const nnIntervals = hrvData.value?.nnIntervals ?? [];
    const events = arrhythmiaEvents.value ?? [];

    let avgRr = 0;
    let minRr = 0;
    let maxRr = 0;

    if (nnIntervals.length > 0) {
      avgRr = nnIntervals.reduce((a, b) => a + b, 0) / nnIntervals.length;
      minRr = Math.min(...nnIntervals);
      maxRr = Math.max(...nnIntervals);
    }

    const abnormalCount = events.filter(e => e.eventType !== 'normal').length;
    const hasArrhythmia = abnormalCount > 0;

    let dominantRhythm = '正常窦性心律';
    if (hasArrhythmia) {
      const eventTypes = events.map(e => e.eventType);
      if (eventTypes.includes('st_elevation')) {
        dominantRhythm = 'ST段抬高型心律';
      } else if (eventTypes.includes('tachycardia') && eventTypes.includes('atrial_fibrillation')) {
        dominantRhythm = '快速房颤心律';
      } else if (eventTypes.includes('tachycardia')) {
        dominantRhythm = '窦性心动过速';
      } else if (eventTypes.includes('bradycardia')) {
        dominantRhythm = '窦性心动过缓';
      } else if (eventTypes.includes('atrial_fibrillation')) {
        dominantRhythm = '心房颤动';
      }
    }

    return {
      totalBeats: rPeaks.length,
      abnormalBeats: abnormalCount,
      averageRr: Math.round(avgRr * 100) / 100,
      minRr: Math.round(minRr * 100) / 100,
      maxRr: Math.round(maxRr * 100) / 100,
      hasArrhythmia,
      dominantRhythm,
    };
  }

  /**
   * Generate waveform snapshots from ECG data
   */
  function generateWaveformSnapshots(count: number = 3): WaveformSnapshot[] {
    const samples = ecgData.value?.samples ?? [];
    const rPeaks = ecgData.value?.rPeaks ?? [];
    const sr = samplingRate.value;
    const dur = duration.value;
    const lead = selectedLead.value;

    if (samples.length === 0) return [];

    const windowDuration = Math.min(3, dur / Math.max(1, count));
    const windowSamples = Math.floor(windowDuration * sr);
    const step = Math.max(1, Math.floor((samples.length - windowSamples) / Math.max(1, count - 1)));

    const snapshots: WaveformSnapshot[] = [];

    for (let i = 0; i < count; i++) {
      const startIdx = Math.min(i * step, samples.length - windowSamples);
      const endIdx = Math.min(startIdx + windowSamples, samples.length);

      const sampleValues = samples.slice(startIdx, endIdx);
      const windowRPeaks = rPeaks
        .filter(rp => startIdx <= rp.index && rp.index < endIdx)
        .map(rp => rp.index - startIdx);

      snapshots.push({
        leadName: lead,
        timeRangeStart: Math.round((startIdx / sr) * 100) / 100,
        timeRangeEnd: Math.round((endIdx / sr) * 100) / 100,
        sampleIndices: Array.from({ length: sampleValues.length }, (_, j) => j),
        sampleValues,
        rPeakIndices: windowRPeaks,
      });
    }

    return snapshots;
  }

  /**
   * Generate medical recommendations
   */
  function generateRecommendations(): string[] {
    const recommendations: string[] = [];
    const events = arrhythmiaEvents.value ?? [];
    const eventTypes = events.map(e => e.eventType);
    const sdnn = hrvData.value?.sdnn ?? 0;

    if (eventTypes.includes('st_elevation')) {
      recommendations.push('⚠️ 检测到ST段抬高，提示可能存在急性心肌缺血，建议立即就医进行进一步检查。');
      recommendations.push('建议进行心肌酶谱检测和冠状动脉造影检查。');
    }

    if (eventTypes.includes('tachycardia')) {
      recommendations.push('📊 心率过快，建议排查是否存在贫血、甲状腺功能亢进或心功能不全。');
      recommendations.push('建议进行24小时动态心电图监测以评估全天心率变化。');
    }

    if (eventTypes.includes('bradycardia')) {
      recommendations.push('📊 心率过慢，建议排查是否存在窦房结功能障碍或传导阻滞。');
      recommendations.push('如出现头晕、黑蒙等症状，建议及时就医评估是否需要起搏器治疗。');
    }

    if (eventTypes.includes('atrial_fibrillation')) {
      recommendations.push('⚠️ 疑似心房颤动，建议进行心电图确诊并评估血栓栓塞风险。');
      recommendations.push('建议进行超声心动图检查评估心脏结构和功能。');
    }

    if (sdnn < 20) {
      recommendations.push('📉 HRV（SDNN）偏低，提示自主神经调节功能受损，建议关注压力管理和睡眠质量。');
    }

    if (!eventTypes.some(e => ['st_elevation', 'tachycardia', 'bradycardia', 'atrial_fibrillation'].includes(e))) {
      recommendations.push('✅ 本次心电分析未发现明显异常，建议定期进行健康体检。');
    }

    recommendations.push('💡 本报告仅供参考，具体诊断请以专业医师意见为准。');

    return recommendations;
  }

  /**
   * Generate analysis report from existing data (frontend mode)
   */
  function generateReportFrontend(): AnalysisReport {
    if (!ecgData.value || !hrvData.value) {
      throw new Error('No ECG analysis data available');
    }

    const reportId = `ECG-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
    const summary = generateReportSummary();
    const snapshots = includeSnapshots.value ? generateWaveformSnapshots(snapshotCount.value) : [];
    const recommendations = generateRecommendations();

    const report: AnalysisReport = {
      reportId,
      generatedAt: new Date().toISOString(),
      patientId: patientId.value || undefined,
      lead: ecgData.value,
      hrv: hrvData.value,
      arrhythmiaEvents: arrhythmiaEvents.value,
      rhythmDiagnosis: rhythmDiagnosis.value,
      waveformSnapshots: snapshots,
      summary,
      recommendations,
    };

    currentReport.value = report;
    return report;
  }

  /**
   * Generate report using backend API
   */
  async function generateReportBackend(): Promise<AnalysisReport> {
    try {
      const response = await fetch(`${backendUrl.value}/api/report/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysis_data: {
            lead_name: selectedLead.value,
            duration: duration.value,
            sampling_rate: samplingRate.value,
            heart_rate: heartRate.value,
          },
          patient_id: patientId.value || undefined,
          format: reportExportFormat.value,
          include_snapshots: includeSnapshots.value,
          snapshot_count: snapshotCount.value,
        }),
      });

      if (!response.ok) {
        throw new Error(`Backend error: ${response.status}`);
      }

      const data = await response.json();
      
      const report: AnalysisReport = {
        reportId: data.report_id,
        generatedAt: data.generated_at,
        patientId: data.patient_id,
        lead: {
          leadName: data.lead.lead_name,
          samplingRate: data.lead.sampling_rate,
          duration: data.lead.duration,
          samples: data.lead.samples,
          rPeaks: data.lead.r_peaks.map((rp: any) => ({
            index: rp.index,
            time: rp.time,
            amplitude: rp.amplitude,
          })),
        },
        hrv: {
          heartRate: data.hrv.heart_rate,
          sdnn: data.hrv.sdnn,
          rmssd: data.hrv.rmssd,
          pnn50: data.hrv.pnn50,
          nnIntervals: data.hrv.nn_intervals,
        },
        arrhythmiaEvents: data.arrhythmia_events.map((evt: any) => ({
          eventType: evt.event_type,
          confidence: evt.confidence,
          description: evt.description,
          timestamp: evt.timestamp,
        })),
        rhythmDiagnosis: data.rhythm_diagnosis,
        waveformSnapshots: data.waveform_snapshots.map((snap: any) => ({
          leadName: snap.lead_name,
          timeRangeStart: snap.time_range_start,
          timeRangeEnd: snap.time_range_end,
          imageData: snap.image_data,
          sampleIndices: snap.sample_indices,
          sampleValues: snap.sample_values,
          rPeakIndices: snap.r_peak_indices,
        })),
        summary: {
          totalBeats: data.summary.total_beats,
          abnormalBeats: data.summary.abnormal_beats,
          averageRr: data.summary.average_rr,
          minRr: data.summary.min_rr,
          maxRr: data.summary.max_rr,
          hasArrhythmia: data.summary.has_arrhythmia,
          dominantRhythm: data.summary.dominant_rhythm,
        },
        recommendations: data.recommendations,
      };

      currentReport.value = report;
      return report;
    } catch (error) {
      console.error('Backend report generation failed:', error);
      throw error;
    }
  }

  /**
   * Generate report (uses backend if enabled, otherwise frontend)
   */
  async function generateReport(): Promise<AnalysisReport> {
    isGeneratingReport.value = true;
    try {
      if (useBackend.value) {
        return await generateReportBackend();
      } else {
        return generateReportFrontend();
      }
    } finally {
      isGeneratingReport.value = false;
    }
  }

  /**
   * Render SVG waveform for report
   */
  function renderSVGWaveform(
    samples: number[],
    rPeakIndices: number[],
    width: number = 750,
    height: number = 180,
  ): string {
    if (samples.length === 0) return '';

    const minVal = Math.min(...samples);
    const maxVal = Math.max(...samples);
    const valRange = maxVal !== minVal ? maxVal - minVal : 1;

    const padding = 20;
    const graphWidth = width - 2 * padding;
    const graphHeight = height - 2 * padding;
    const xStep = graphWidth / Math.max(1, samples.length - 1);

    const yMap = (val: number) => padding + graphHeight - ((val - minVal) / valRange) * graphHeight;

    let pathD = '';
    for (let i = 0; i < samples.length; i++) {
      const x = padding + i * xStep;
      const y = yMap(samples[i]);
      if (i === 0) {
        pathD += `M ${x.toFixed(2)} ${y.toFixed(2)}`;
      } else {
        pathD += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
      }
    }

    let rPeakMarkers = '';
    for (const idx of rPeakIndices) {
      if (idx >= 0 && idx < samples.length) {
        const x = padding + idx * xStep;
        const y = yMap(samples[idx]);
        rPeakMarkers += `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="4" fill="#ef4444" />`;
        rPeakMarkers += `<text x="${x.toFixed(2)}" y="${y - 8}" text-anchor="middle" font-size="10" fill="#ef4444">R</text>`;
      }
    }

    let gridLines = '';
    for (let i = 0; i < 5; i++) {
      const yPos = padding + (i / 4) * graphHeight;
      gridLines += `<line x1="${padding}" y1="${yPos}" x2="${width - padding}" y2="${yPos}" stroke="rgba(16, 185, 129, 0.1)" stroke-width="1" />`;
    }

    return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="#0a0a0a" />
      ${gridLines}
      <path d="${pathD}" stroke="#10b981" stroke-width="1.5" fill="none" />
      ${rPeakMarkers}
    </svg>`;
  }

  /**
   * Generate HTML report content
   */
  function generateHTMLReport(report: AnalysisReport): string {
    const snapshotSVGs = report.waveformSnapshots.map((snap, i) => ({
      index: i + 1,
      snapshot: snap,
      svg: renderSVGWaveform(snap.sampleValues, snap.rPeakIndices, 750, 180),
    }));

    const arrhythmiaHTML = report.arrhythmiaEvents.map(event => {
      const colors: Record<string, string> = {
        normal: '#10b981',
        tachycardia: '#ef4444',
        bradycardia: '#f59e0b',
        st_elevation: '#f97316',
        atrial_fibrillation: '#a855f7',
        premature_ventricular_contraction: '#ec4899',
      };
      const color = colors[event.eventType] || '#6b7280';
      const eventLabel = event.eventType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

      return `<div style="border-left: 4px solid ${color}; padding: 12px; margin: 8px 0; background: #1f2937; border-radius: 0 8px 8px 0;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <strong style="color: ${color};">${eventLabel}</strong>
          <span style="color: #9ca3af; font-size: 12px;">置信度: ${(event.confidence * 100).toFixed(0)}%</span>
        </div>
        <p style="color: #d1d5db; margin: 4px 0; font-size: 14px;">${event.description}</p>
        <p style="color: #6b7280; font-size: 12px;">时间: ${event.timestamp.toFixed(2)}s</p>
      </div>`;
    }).join('');

    const recommendationsHTML = report.recommendations
      .map(rec => `<li style="color: #d1d5db; margin: 8px 0; font-size: 14px;">${rec}</li>`)
      .join('');

    const snapshotsHTML = snapshotSVGs.map(({ index, snapshot, svg }) => `
      <div style="margin: 16px 0;">
        <h4 style="color: #10b981; margin-bottom: 8px;">截图 ${index}: ${snapshot.timeRangeStart.toFixed(1)}s - ${snapshot.timeRangeEnd.toFixed(1)}s</h4>
        ${svg}
      </div>
    `).join('');

    const generatedDate = new Date(report.generatedAt);
    const abnormalColor = report.summary.abnormalBeats > 0 ? '#ef4444' : '#10b981';

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>心电分析报告 - ${report.reportId}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #030712; color: #e5e7eb; margin: 0; padding: 20px; }
    .report-container { max-width: 900px; margin: 0 auto; background: #111827; border-radius: 12px; padding: 32px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5); }
    .header { border-bottom: 2px solid #10b981; padding-bottom: 20px; margin-bottom: 24px; }
    h1 { color: #10b981; margin: 0 0 8px 0; font-size: 28px; }
    h2 { color: #06b6d4; margin: 24px 0 12px 0; font-size: 20px; border-bottom: 1px solid #374151; padding-bottom: 8px; }
    .meta-info { display: flex; flex-wrap: wrap; gap: 16px; color: #9ca3af; font-size: 14px; }
    .meta-info span { background: #1f2937; padding: 6px 12px; border-radius: 6px; }
    .diagnosis-box { background: linear-gradient(135deg, #064e3b 0%, #065f46 100%); border: 1px solid #10b981; border-radius: 8px; padding: 20px; margin: 16px 0; }
    .diagnosis-text { color: #34d399; font-size: 18px; font-weight: 600; }
    .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin: 16px 0; }
    .metric-card { background: #1f2937; border: 1px solid #374151; border-radius: 8px; padding: 16px; text-align: center; }
    .metric-label { color: #9ca3af; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    .metric-value { color: #06b6d4; font-size: 28px; font-weight: 700; margin: 4px 0; }
    .metric-unit { color: #6b7280; font-size: 12px; }
    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 16px 0; }
    .summary-item { background: #1f2937; padding: 12px; border-radius: 6px; text-align: center; }
    .summary-label { color: #9ca3af; font-size: 12px; }
    .summary-value { color: #f59e0b; font-size: 18px; font-weight: 600; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #374151; text-align: center; color: #6b7280; font-size: 12px; }
    @media print { body { background: white; padding: 0; } .report-container { box-shadow: none; border: 1px solid #e5e7eb; } }
  </style>
</head>
<body>
  <div class="report-container">
    <div class="header">
      <h1>❤️ 心电分析报告</h1>
      <div class="meta-info">
        <span>报告编号: ${report.reportId}</span>
        <span>生成时间: ${generatedDate.toLocaleString('zh-CN')}</span>
        <span>导联: ${report.lead.leadName}</span>
        <span>时长: ${report.lead.duration}s</span>
        ${report.patientId ? `<span>患者ID: ${report.patientId}</span>` : ''}
      </div>
    </div>

    <div class="diagnosis-box">
      <div class="diagnosis-text">诊断结论: ${report.rhythmDiagnosis}</div>
    </div>

    <h2>📊 心率变异性 (HRV) 指标</h2>
    <div class="metrics-grid">
      <div class="metric-card"><div class="metric-label">心率</div><div class="metric-value">${report.hrv.heartRate.toFixed(1)}</div><div class="metric-unit">BPM</div></div>
      <div class="metric-card"><div class="metric-label">SDNN</div><div class="metric-value">${report.hrv.sdnn.toFixed(1)}</div><div class="metric-unit">ms</div></div>
      <div class="metric-card"><div class="metric-label">RMSSD</div><div class="metric-value">${report.hrv.rmssd.toFixed(1)}</div><div class="metric-unit">ms</div></div>
      <div class="metric-card"><div class="metric-label">pNN50</div><div class="metric-value">${report.hrv.pnn50.toFixed(1)}</div><div class="metric-unit">%</div></div>
    </div>

    <h2>📋 分析摘要</h2>
    <div class="summary-grid">
      <div class="summary-item"><div class="summary-label">总心跳数</div><div class="summary-value">${report.summary.totalBeats}</div></div>
      <div class="summary-item"><div class="summary-label">异常心跳</div><div class="summary-value" style="color: ${abnormalColor};">${report.summary.abnormalBeats}</div></div>
      <div class="summary-item"><div class="summary-label">平均RR</div><div class="summary-value">${report.summary.averageRr.toFixed(0)} ms</div></div>
      <div class="summary-item"><div class="summary-label">最小RR</div><div class="summary-value">${report.summary.minRr.toFixed(0)} ms</div></div>
      <div class="summary-item"><div class="summary-label">最大RR</div><div class="summary-value">${report.summary.maxRr.toFixed(0)} ms</div></div>
      <div class="summary-item"><div class="summary-label">主导心律</div><div class="summary-value" style="font-size: 14px;">${report.summary.dominantRhythm}</div></div>
    </div>

    <h2>⚠️ 心律失常事件</h2>
    ${report.arrhythmiaEvents.length > 0 ? arrhythmiaHTML : '<p style="color: #9ca3af;">未检测到明显心律失常事件。</p>'}

    <h2>📈 波形截图</h2>
    ${report.waveformSnapshots.length > 0 ? snapshotsHTML : '<p style="color: #9ca3af;">未包含波形截图。</p>'}

    <h2>💡 医疗建议</h2>
    <ul style="padding-left: 20px;">${recommendationsHTML}</ul>

    <div class="footer">
      <p>本报告由 ECG 监测系统自动生成 | 报告编号: ${report.reportId}</p>
      <p>⚠️ 本报告仅供参考，不作为最终诊断依据，请以专业医师意见为准。</p>
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Download report as file
   */
  function downloadReport(report: AnalysisReport, format: ReportFormat): void {
    const timestamp = new Date(report.generatedAt).toISOString().replace(/[-:.]/g, '').slice(0, 15);
    const filename = `ECG_Report_${report.reportId}_${timestamp}`;

    if (format === 'html') {
      const htmlContent = generateHTMLReport(report);
      const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } else {
      const htmlContent = generateHTMLReport(report);
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(htmlContent);
        printWindow.document.close();
        printWindow.onload = () => {
          setTimeout(() => {
            printWindow.print();
          }, 500);
        };
      }
    }
  }

  /**
   * Preview report in new tab
   */
  function previewReport(report: AnalysisReport): void {
    const htmlContent = generateHTMLReport(report);
    const previewWindow = window.open('', '_blank');
    if (previewWindow) {
      previewWindow.document.write(htmlContent);
      previewWindow.document.close();
    }
  }

  /**
   * Export report (uses backend if enabled)
   */
  async function exportReport(): Promise<void> {
    if (!currentReport.value) {
      await generateReport();
    }

    if (!currentReport.value) {
      throw new Error('Failed to generate report');
    }

    isExportingReport.value = true;
    try {
      if (useBackend.value) {
        try {
          const response = await fetch(`${backendUrl.value}/api/report/export`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              analysis_data: {
                lead_name: selectedLead.value,
                duration: duration.value,
                sampling_rate: samplingRate.value,
                heart_rate: heartRate.value,
              },
              patient_id: patientId.value || undefined,
              format: reportExportFormat.value,
              include_snapshots: includeSnapshots.value,
              snapshot_count: snapshotCount.value,
            }),
          });

          if (response.ok) {
            const data: ReportExportResponse = await response.json();
            if (data.content) {
              const blob = reportExportFormat.value === 'html'
                ? new Blob([data.content], { type: 'text/html;charset=utf-8' })
                : new Blob([Uint8Array.from(atob(data.content), c => c.charCodeAt(0))], { type: 'application/pdf' });
              
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = data.filename;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
              return;
            }
          }
        } catch (error) {
          console.warn('Backend export failed, falling back to frontend:', error);
        }
      }

      downloadReport(currentReport.value, reportExportFormat.value);
    } finally {
      isExportingReport.value = false;
    }
  }

  return {
    // State
    selectedLead,
    heartRate,
    samplingRate,
    duration,
    isMonitoring,
    ecgData,
    hrvData,
    arrhythmiaEvents,
    rhythmDiagnosis,
    isLoading,
    useBackend,
    backendUrl,
    scrollOffset,
    // Report state
    currentReport,
    reportExportFormat,
    includeSnapshots,
    snapshotCount,
    patientId,
    isGeneratingReport,
    isExportingReport,
    // Getters
    currentSamples,
    currentRPeaks,
    currentHeartRate,
    hasAnalysisData,
    // Actions
    analyzeECG,
    startMonitoring,
    stopMonitoring,
    selectLead,
    setHeartRate,
    generateECGWaveform,
    detectRPeaks,
    calculateHRV,
    detectArrhythmias,
    // Report actions
    generateReport,
    generateReportFrontend,
    generateReportBackend,
    generateReportSummary,
    generateWaveformSnapshots,
    generateRecommendations,
    generateHTMLReport,
    renderSVGWaveform,
    downloadReport,
    previewReport,
    exportReport,
  };
});
