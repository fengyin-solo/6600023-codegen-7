from pydantic import BaseModel, Field
from typing import List, Optional
from enum import Enum
from datetime import datetime


class LeadName(str, Enum):
    I = "I"
    II = "II"
    III = "III"
    aVR = "aVR"
    aVL = "aVL"
    aVF = "aVF"
    V1 = "V1"
    V2 = "V2"
    V3 = "V3"
    V4 = "V4"
    V5 = "V5"
    V6 = "V6"


class ArrhythmiaType(str, Enum):
    NORMAL = "normal"
    TACHYCARDIA = "tachycardia"
    BRADYCARDIA = "bradycardia"
    ST_ELEVATION = "st_elevation"
    AFIB = "atrial_fibrillation"
    PVC = "premature_ventricular_contraction"


class RPeak(BaseModel):
    index: int = Field(..., description="Sample index of R-peak")
    time: float = Field(..., description="Time in seconds")
    amplitude: float = Field(..., description="Amplitude in mV")


class HRVMetrics(BaseModel):
    heart_rate: float = Field(..., description="Heart rate in BPM")
    sdnn: float = Field(..., description="Standard deviation of NN intervals (ms)")
    rmssd: float = Field(..., description="Root mean square of successive differences (ms)")
    pnn50: float = Field(..., description="Percentage of successive differences > 50ms")
    nn_intervals: List[float] = Field(default_factory=list, description="NN intervals in ms")


class ArrhythmiaEvent(BaseModel):
    event_type: ArrhythmiaType = Field(..., description="Type of arrhythmia detected")
    confidence: float = Field(..., ge=0, le=1, description="Detection confidence")
    description: str = Field(..., description="Human-readable description")
    timestamp: float = Field(..., description="Event timestamp in seconds")


class ECGLead(BaseModel):
    lead_name: LeadName = Field(..., description="ECG lead name")
    sampling_rate: int = Field(default=500, description="Sampling rate in Hz")
    duration: float = Field(default=10.0, description="Duration in seconds")
    samples: List[float] = Field(default_factory=list, description="ECG samples in mV")
    r_peaks: List[RPeak] = Field(default_factory=list, description="Detected R-peaks")


class ECGAnalysisRequest(BaseModel):
    lead_name: LeadName = Field(default=LeadName.II, description="ECG lead to analyze")
    duration: float = Field(default=10.0, ge=1.0, le=60.0, description="Duration in seconds")
    sampling_rate: int = Field(default=500, ge=100, le=1000, description="Sampling rate in Hz")
    heart_rate: float = Field(default=72.0, ge=30, le=200, description="Simulated heart rate BPM")


class ECGAnalysisResponse(BaseModel):
    lead: ECGLead = Field(..., description="ECG lead data")
    hrv: HRVMetrics = Field(..., description="HRV analysis results")
    arrhythmia_events: List[ArrhythmiaEvent] = Field(default_factory=list, description="Detected arrhythmia events")
    rhythm_diagnosis: str = Field(..., description="Overall rhythm diagnosis")


class ReportFormat(str, Enum):
    HTML = "html"
    PDF = "pdf"


class ReportSummary(BaseModel):
    total_beats: int = Field(..., description="Total number of heart beats")
    abnormal_beats: int = Field(..., description="Number of abnormal beats")
    average_rr: float = Field(..., description="Average RR interval in ms")
    min_rr: float = Field(..., description="Minimum RR interval in ms")
    max_rr: float = Field(..., description="Maximum RR interval in ms")
    has_arrhythmia: bool = Field(..., description="Whether arrhythmia was detected")
    dominant_rhythm: str = Field(..., description="Dominant rhythm type")


class WaveformSnapshot(BaseModel):
    lead_name: str = Field(..., description="ECG lead name")
    time_range_start: float = Field(..., description="Start time of snapshot in seconds")
    time_range_end: float = Field(..., description="End time of snapshot in seconds")
    image_data: Optional[str] = Field(None, description="Base64 encoded waveform image (for client-provided)")
    sample_indices: List[int] = Field(default_factory=list, description="Sample indices for server-side rendering")
    sample_values: List[float] = Field(default_factory=list, description="Sample values for server-side rendering")
    r_peak_indices: List[int] = Field(default_factory=list, description="R-peak indices in this window")


class AnalysisReport(BaseModel):
    report_id: str = Field(..., description="Unique report identifier")
    generated_at: datetime = Field(default_factory=datetime.now, description="Report generation timestamp")
    patient_id: Optional[str] = Field(None, description="Patient identifier")
    lead: ECGLead = Field(..., description="ECG lead data")
    hrv: HRVMetrics = Field(..., description="HRV analysis results")
    arrhythmia_events: List[ArrhythmiaEvent] = Field(default_factory=list, description="Detected arrhythmia events")
    rhythm_diagnosis: str = Field(..., description="Overall rhythm diagnosis")
    waveform_snapshots: List[WaveformSnapshot] = Field(default_factory=list, description="Waveform snapshots")
    summary: ReportSummary = Field(..., description="Analysis summary")
    recommendations: List[str] = Field(default_factory=list, description="Medical recommendations")


class ReportGenerationRequest(BaseModel):
    analysis_data: ECGAnalysisRequest = Field(..., description="ECG analysis parameters")
    patient_id: Optional[str] = Field(None, description="Patient identifier")
    format: ReportFormat = Field(default=ReportFormat.HTML, description="Report export format")
    include_snapshots: bool = Field(default=True, description="Whether to include waveform snapshots")
    snapshot_count: int = Field(default=3, ge=1, le=5, description="Number of waveform snapshots")


class ReportExportResponse(BaseModel):
    report_id: str = Field(..., description="Report identifier")
    format: ReportFormat = Field(..., description="Export format")
    filename: str = Field(..., description="Export filename")
    download_url: Optional[str] = Field(None, description="Download URL for the report")
    content: Optional[str] = Field(None, description="Report content (base64 encoded for PDF, HTML string for HTML)")
