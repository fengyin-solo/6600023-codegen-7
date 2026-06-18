export interface ECGLead {
  leadName: string;
  samplingRate: number;
  duration: number;
  samples: number[];
  rPeaks: RPeak[];
}

export interface RPeak {
  index: number;
  time: number;
  amplitude: number;
}

export interface HRVData {
  heartRate: number;
  sdnn: number;
  rmssd: number;
  pnn50: number;
  nnIntervals: number[];
}

export interface ArrhythmiaEvent {
  eventType: 'normal' | 'tachycardia' | 'bradycardia' | 'st_elevation' | 'atrial_fibrillation' | 'premature_ventricular_contraction';
  confidence: number;
  description: string;
  timestamp: number;
}

export interface ECGAnalysisResponse {
  lead: ECGLead;
  hrv: HRVData;
  arrhythmiaEvents: ArrhythmiaEvent[];
  rhythmDiagnosis: string;
}

export interface ECGAnalysisRequest {
  leadName: string;
  duration: number;
  samplingRate: number;
  heartRate: number;
}

export type ReportFormat = 'html' | 'pdf';

export interface WaveformSnapshot {
  leadName: string;
  timeRangeStart: number;
  timeRangeEnd: number;
  imageData?: string;
  sampleIndices: number[];
  sampleValues: number[];
  rPeakIndices: number[];
}

export interface ReportSummary {
  totalBeats: number;
  abnormalBeats: number;
  averageRr: number;
  minRr: number;
  maxRr: number;
  hasArrhythmia: boolean;
  dominantRhythm: string;
}

export interface AnalysisReport {
  reportId: string;
  generatedAt: string;
  patientId?: string;
  lead: ECGLead;
  hrv: HRVData;
  arrhythmiaEvents: ArrhythmiaEvent[];
  rhythmDiagnosis: string;
  waveformSnapshots: WaveformSnapshot[];
  summary: ReportSummary;
  recommendations: string[];
}

export interface ReportGenerationRequest {
  analysisData: ECGAnalysisRequest;
  patientId?: string;
  format: ReportFormat;
  includeSnapshots: boolean;
  snapshotCount: number;
}

export interface ReportExportResponse {
  reportId: string;
  format: ReportFormat;
  filename: string;
  downloadUrl?: string;
  content?: string;
}

export const LEAD_NAMES: string[] = [
  'I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'
];

export const REPORT_FORMATS: { value: ReportFormat; label: string }[] = [
  { value: 'html', label: 'HTML 格式' },
  { value: 'pdf', label: 'PDF 格式' },
];
