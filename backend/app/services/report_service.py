import uuid
import base64
import io
from typing import List, Dict, Any, Tuple
from datetime import datetime
import numpy as np

from app.models.schemas import (
    AnalysisReport,
    ReportSummary,
    WaveformSnapshot,
    ReportGenerationRequest,
    ReportExportResponse,
    ReportFormat,
    ECGAnalysisResponse,
    ECGLead,
    HRVMetrics,
    ArrhythmiaEvent,
    ArrhythmiaType,
)
from app.services.ecg_service import (
    generate_ecg_signal,
    pan_tompkins_r_peak_detection,
    calculate_hrv,
    detect_arrhythmia,
    get_rhythm_diagnosis,
)


def generate_report_id() -> str:
    """Generate a unique report ID."""
    return f"ECG-{uuid.uuid4().hex[:12].upper()}"


def create_report_summary(
    r_peaks: List[Dict[str, Any]],
    hrv: Dict[str, Any],
    arrhythmia_events: List[Dict[str, Any]],
) -> ReportSummary:
    """Create analysis summary statistics."""
    nn_intervals = hrv.get("nn_intervals", [])
    
    if len(nn_intervals) > 0:
        avg_rr = float(np.mean(nn_intervals))
        min_rr = float(np.min(nn_intervals))
        max_rr = float(np.max(nn_intervals))
    else:
        avg_rr = 0.0
        min_rr = 0.0
        max_rr = 0.0

    abnormal_count = sum(
        1 for e in arrhythmia_events 
        if e["event_type"] != "normal"
    )

    has_arrhythmia = abnormal_count > 0

    dominant_rhythm = "正常窦性心律"
    if has_arrhythmia:
        event_types = [e["event_type"] for e in arrhythmia_events]
        if "st_elevation" in event_types:
            dominant_rhythm = "ST段抬高型心律"
        elif "tachycardia" in event_types and "atrial_fibrillation" in event_types:
            dominant_rhythm = "快速房颤心律"
        elif "tachycardia" in event_types:
            dominant_rhythm = "窦性心动过速"
        elif "bradycardia" in event_types:
            dominant_rhythm = "窦性心动过缓"
        elif "atrial_fibrillation" in event_types:
            dominant_rhythm = "心房颤动"

    return ReportSummary(
        total_beats=len(r_peaks),
        abnormal_beats=abnormal_count,
        average_rr=round(avg_rr, 2),
        min_rr=round(min_rr, 2),
        max_rr=round(max_rr, 2),
        has_arrhythmia=has_arrhythmia,
        dominant_rhythm=dominant_rhythm,
    )


def generate_waveform_snapshots(
    ecg_signal: np.ndarray,
    r_peaks: List[Dict[str, Any]],
    sampling_rate: int,
    duration: float,
    lead_name: str,
    snapshot_count: int = 3,
) -> List[WaveformSnapshot]:
    """Generate waveform snapshots from the ECG signal."""
    snapshots = []
    total_samples = len(ecg_signal)
    
    if total_samples == 0:
        return snapshots

    window_duration = min(3.0, duration / max(1, snapshot_count))
    window_samples = int(window_duration * sampling_rate)
    
    step = max(1, (total_samples - window_samples) // max(1, snapshot_count - 1))
    
    for i in range(snapshot_count):
        start_idx = min(i * step, total_samples - window_samples)
        end_idx = min(start_idx + window_samples, total_samples)
        
        sample_indices = list(range(start_idx, end_idx))
        sample_values = [round(float(v), 4) for v in ecg_signal[start_idx:end_idx]]
        
        window_r_peaks = [
            rp["index"] - start_idx
            for rp in r_peaks
            if start_idx <= rp["index"] < end_idx
        ]
        
        snapshot = WaveformSnapshot(
            lead_name=lead_name,
            time_range_start=round(start_idx / sampling_rate, 2),
            time_range_end=round(end_idx / sampling_rate, 2),
            sample_indices=list(range(len(sample_indices))),
            sample_values=sample_values,
            r_peak_indices=window_r_peaks,
        )
        snapshots.append(snapshot)
    
    return snapshots


def generate_recommendations(
    arrhythmia_events: List[Dict[str, Any]],
    hrv: Dict[str, Any],
) -> List[str]:
    """Generate medical recommendations based on analysis results."""
    recommendations = []
    event_types = [e["event_type"] for e in arrhythmia_events]
    
    if "st_elevation" in event_types:
        recommendations.append("⚠️ 检测到ST段抬高，提示可能存在急性心肌缺血，建议立即就医进行进一步检查。")
        recommendations.append("建议进行心肌酶谱检测和冠状动脉造影检查。")
    
    if "tachycardia" in event_types:
        recommendations.append("📊 心率过快，建议排查是否存在贫血、甲状腺功能亢进或心功能不全。")
        recommendations.append("建议进行24小时动态心电图监测以评估全天心率变化。")
    
    if "bradycardia" in event_types:
        recommendations.append("📊 心率过慢，建议排查是否存在窦房结功能障碍或传导阻滞。")
        recommendations.append("如出现头晕、黑蒙等症状，建议及时就医评估是否需要起搏器治疗。")
    
    if "atrial_fibrillation" in event_types:
        recommendations.append("⚠️ 疑似心房颤动，建议进行心电图确诊并评估血栓栓塞风险。")
        recommendations.append("建议进行超声心动图检查评估心脏结构和功能。")
    
    if hrv.get("sdnn", 0) < 20:
        recommendations.append("📉 HRV（SDNN）偏低，提示自主神经调节功能受损，建议关注压力管理和睡眠质量。")
    
    if not any(e in event_types for e in ["st_elevation", "tachycardia", "bradycardia", "atrial_fibrillation"]):
        recommendations.append("✅ 本次心电分析未发现明显异常，建议定期进行健康体检。")
    
    recommendations.append("💡 本报告仅供参考，具体诊断请以专业医师意见为准。")
    
    return recommendations


def run_ecg_analysis(request: ReportGenerationRequest) -> ECGAnalysisResponse:
    """Run ECG analysis and return results."""
    analysis_req = request.analysis_data
    
    time_array, ecg_signal = generate_ecg_signal(
        lead_name=analysis_req.lead_name.value,
        duration=analysis_req.duration,
        sampling_rate=analysis_req.sampling_rate,
        heart_rate=analysis_req.heart_rate,
    )
    
    r_peaks_raw = pan_tompkins_r_peak_detection(ecg_signal, analysis_req.sampling_rate)
    r_peaks = [
        {"index": rp["index"], "time": rp["time"], "amplitude": rp["amplitude"]}
        for rp in r_peaks_raw
    ]
    
    hrv_raw = calculate_hrv(r_peaks_raw, analysis_req.sampling_rate)
    hrv = HRVMetrics(**hrv_raw)
    
    arrhythmia_raw = detect_arrhythmia(
        r_peaks_raw, hrv_raw, ecg_signal, analysis_req.sampling_rate
    )
    arrhythmia_events = []
    for evt in arrhythmia_raw:
        arrhythmia_events.append(
            ArrhythmiaEvent(
                event_type=ArrhythmiaType(evt["event_type"]),
                confidence=evt["confidence"],
                description=evt["description"],
                timestamp=evt["timestamp"],
            )
        )
    
    diagnosis = get_rhythm_diagnosis(arrhythmia_raw, hrv_raw)
    
    lead = ECGLead(
        lead_name=analysis_req.lead_name,
        sampling_rate=analysis_req.sampling_rate,
        duration=analysis_req.duration,
        samples=[round(float(s), 4) for s in ecg_signal],
        r_peaks=[
            {"index": rp["index"], "time": rp["time"], "amplitude": rp["amplitude"]}
            for rp in r_peaks_raw
        ],
    )
    
    return ECGAnalysisResponse(
        lead=lead,
        hrv=hrv,
        arrhythmia_events=arrhythmia_events,
        rhythm_diagnosis=diagnosis,
    ), ecg_signal, r_peaks_raw, hrv_raw, arrhythmia_raw


def generate_analysis_report(request: ReportGenerationRequest) -> AnalysisReport:
    """Generate a complete analysis report."""
    analysis_result, ecg_signal, r_peaks_raw, hrv_raw, arrhythmia_raw = run_ecg_analysis(request)
    
    report_id = generate_report_id()
    
    summary = create_report_summary(r_peaks_raw, hrv_raw, arrhythmia_raw)
    
    waveform_snapshots = []
    if request.include_snapshots:
        waveform_snapshots = generate_waveform_snapshots(
            ecg_signal,
            r_peaks_raw,
            analysis_result.lead.sampling_rate,
            analysis_result.lead.duration,
            analysis_result.lead.lead_name.value,
            request.snapshot_count,
        )
    
    recommendations = generate_recommendations(arrhythmia_raw, hrv_raw)
    
    return AnalysisReport(
        report_id=report_id,
        patient_id=request.patient_id,
        lead=analysis_result.lead,
        hrv=analysis_result.hrv,
        arrhythmia_events=analysis_result.arrhythmia_events,
        rhythm_diagnosis=analysis_result.rhythm_diagnosis,
        waveform_snapshots=waveform_snapshots,
        summary=summary,
        recommendations=recommendations,
    )


def render_svg_waveform(
    samples: List[float],
    r_peak_indices: List[int],
    width: int = 800,
    height: int = 200,
) -> str:
    """Render an SVG waveform from ECG samples."""
    if len(samples) == 0:
        return ""
    
    min_val = min(samples)
    max_val = max(samples)
    val_range = max_val - min_val if max_val != min_val else 1.0
    
    padding = 20
    graph_width = width - 2 * padding
    graph_height = height - 2 * padding
    
    x_step = graph_width / max(1, len(samples) - 1)
    
    def y_map(val: float) -> float:
        return padding + graph_height - ((val - min_val) / val_range) * graph_height
    
    path_points = []
    for i, val in enumerate(samples):
        x = padding + i * x_step
        y = y_map(val)
        if i == 0:
            path_points.append(f"M {x:.2f} {y:.2f}")
        else:
            path_points.append(f"L {x:.2f} {y:.2f}")
    
    path_d = " ".join(path_points)
    
    r_peak_markers = ""
    for idx in r_peak_indices:
        if 0 <= idx < len(samples):
            x = padding + idx * x_step
            y = y_map(samples[idx])
            r_peak_markers += f'<circle cx="{x:.2f}" cy="{y:.2f}" r="4" fill="#ef4444" />'
            r_peak_markers += f'<text x="{x:.2f}" y="{y - 8:.2f}" text-anchor="middle" font-size="10" fill="#ef4444">R</text>'
    
    grid_lines = ""
    for i in range(0, 5):
        y_pos = padding + (i / 4) * graph_height
        grid_lines += f'<line x1="{padding}" y1="{y_pos}" x2="{width - padding}" y2="{y_pos}" stroke="rgba(16, 185, 129, 0.1)" stroke-width="1" />'
    
    svg = f'''<svg width="{width}" height="{height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="{width}" height="{height}" fill="#0a0a0a" />
        {grid_lines}
        <path d="{path_d}" stroke="#10b981" stroke-width="1.5" fill="none" />
        {r_peak_markers}
    </svg>'''
    
    return svg


def generate_html_report(report: AnalysisReport) -> str:
    """Generate HTML formatted report."""
    snapshot_svgs = []
    for i, snapshot in enumerate(report.waveform_snapshots):
        svg = render_svg_waveform(
            snapshot.sample_values,
            snapshot.r_peak_indices,
            width=750,
            height=180,
        )
        snapshot_svgs.append((i + 1, snapshot, svg))
    
    arrhythmia_html = ""
    for event in report.arrhythmia_events:
        color_class = {
            "normal": "#10b981",
            "tachycardia": "#ef4444",
            "bradycardia": "#f59e0b",
            "st_elevation": "#f97316",
            "atrial_fibrillation": "#a855f7",
            "premature_ventricular_contraction": "#ec4899",
        }.get(event.event_type.value, "#6b7280")
        
        arrhythmia_html += f'''
        <div style="border-left: 4px solid {color_class}; padding: 12px; margin: 8px 0; background: #1f2937; border-radius: 0 8px 8px 0;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <strong style="color: {color_class};">{event.event_type.value.replace('_', ' ').title()}</strong>
                <span style="color: #9ca3af; font-size: 12px;">置信度: {(event.confidence * 100):.0f}%</span>
            </div>
            <p style="color: #d1d5db; margin: 4px 0; font-size: 14px;">{event.description}</p>
            <p style="color: #6b7280; font-size: 12px;">时间: {event.timestamp:.2f}s</p>
        </div>
        '''
    
    recommendations_html = ""
    for rec in report.recommendations:
        recommendations_html += f'<li style="color: #d1d5db; margin: 8px 0; font-size: 14px;">{rec}</li>'
    
    snapshots_html = ""
    for idx, snapshot, svg in snapshot_svgs:
        snapshots_html += f'''
        <div style="margin: 16px 0;">
            <h4 style="color: #10b981; margin-bottom: 8px;">截图 {idx}: {snapshot.time_range_start:.1f}s - {snapshot.time_range_end:.1f}s</h4>
            {svg}
        </div>
        '''
    
    html = f'''
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>心电分析报告 - {report.report_id}</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #030712;
            color: #e5e7eb;
            margin: 0;
            padding: 20px;
        }}
        .report-container {{
            max-width: 900px;
            margin: 0 auto;
            background: #111827;
            border-radius: 12px;
            padding: 32px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        }}
        .header {{
            border-bottom: 2px solid #10b981;
            padding-bottom: 20px;
            margin-bottom: 24px;
        }}
        h1 {{
            color: #10b981;
            margin: 0 0 8px 0;
            font-size: 28px;
        }}
        h2 {{
            color: #06b6d4;
            margin: 24px 0 12px 0;
            font-size: 20px;
            border-bottom: 1px solid #374151;
            padding-bottom: 8px;
        }}
        h3 {{
            color: #a855f7;
            margin: 16px 0 8px 0;
            font-size: 16px;
        }}
        .meta-info {{
            display: flex;
            flex-wrap: wrap;
            gap: 16px;
            color: #9ca3af;
            font-size: 14px;
        }}
        .meta-info span {{
            background: #1f2937;
            padding: 6px 12px;
            border-radius: 6px;
        }}
        .diagnosis-box {{
            background: linear-gradient(135deg, #064e3b 0%, #065f46 100%);
            border: 1px solid #10b981;
            border-radius: 8px;
            padding: 20px;
            margin: 16px 0;
        }}
        .diagnosis-text {{
            color: #34d399;
            font-size: 18px;
            font-weight: 600;
        }}
        .metrics-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 16px;
            margin: 16px 0;
        }}
        .metric-card {{
            background: #1f2937;
            border: 1px solid #374151;
            border-radius: 8px;
            padding: 16px;
            text-align: center;
        }}
        .metric-label {{
            color: #9ca3af;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }}
        .metric-value {{
            color: #06b6d4;
            font-size: 28px;
            font-weight: 700;
            margin: 4px 0;
        }}
        .metric-unit {{
            color: #6b7280;
            font-size: 12px;
        }}
        .summary-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 12px;
            margin: 16px 0;
        }}
        .summary-item {{
            background: #1f2937;
            padding: 12px;
            border-radius: 6px;
            text-align: center;
        }}
        .summary-label {{
            color: #9ca3af;
            font-size: 12px;
        }}
        .summary-value {{
            color: #f59e0b;
            font-size: 18px;
            font-weight: 600;
        }}
        .footer {{
            margin-top: 32px;
            padding-top: 16px;
            border-top: 1px solid #374151;
            text-align: center;
            color: #6b7280;
            font-size: 12px;
        }}
        @media print {{
            body {{
                background: white;
                padding: 0;
            }}
            .report-container {{
                box-shadow: none;
                border: 1px solid #e5e7eb;
            }}
        }}
    </style>
</head>
<body>
    <div class="report-container">
        <div class="header">
            <h1>❤️ 心电分析报告</h1>
            <div class="meta-info">
                <span>报告编号: {report.report_id}</span>
                <span>生成时间: {report.generated_at.strftime('%Y-%m-%d %H:%M:%S')}</span>
                <span>导联: {report.lead.lead_name.value}</span>
                <span>时长: {report.lead.duration}s</span>
                {f'<span>患者ID: {report.patient_id}</span>' if report.patient_id else ''}
            </div>
        </div>

        <div class="diagnosis-box">
            <div class="diagnosis-text">诊断结论: {report.rhythm_diagnosis}</div>
        </div>

        <h2>📊 心率变异性 (HRV) 指标</h2>
        <div class="metrics-grid">
            <div class="metric-card">
                <div class="metric-label">心率</div>
                <div class="metric-value">{report.hrv.heart_rate:.1f}</div>
                <div class="metric-unit">BPM</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">SDNN</div>
                <div class="metric-value">{report.hrv.sdnn:.1f}</div>
                <div class="metric-unit">ms</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">RMSSD</div>
                <div class="metric-value">{report.hrv.rmssd:.1f}</div>
                <div class="metric-unit">ms</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">pNN50</div>
                <div class="metric-value">{report.hrv.pnn50:.1f}</div>
                <div class="metric-unit">%</div>
            </div>
        </div>

        <h2>📋 分析摘要</h2>
        <div class="summary-grid">
            <div class="summary-item">
                <div class="summary-label">总心跳数</div>
                <div class="summary-value">{report.summary.total_beats}</div>
            </div>
            <div class="summary-item">
                <div class="summary-label">异常心跳</div>
                <div class="summary-value" style="color: {'#ef4444' if report.summary.abnormal_beats > 0 else '#10b981'};">{report.summary.abnormal_beats}</div>
            </div>
            <div class="summary-item">
                <div class="summary-label">平均RR</div>
                <div class="summary-value">{report.summary.average_rr:.0f} ms</div>
            </div>
            <div class="summary-item">
                <div class="summary-label">最小RR</div>
                <div class="summary-value">{report.summary.min_rr:.0f} ms</div>
            </div>
            <div class="summary-item">
                <div class="summary-label">最大RR</div>
                <div class="summary-value">{report.summary.max_rr:.0f} ms</div>
            </div>
            <div class="summary-item">
                <div class="summary-label">主导心律</div>
                <div class="summary-value" style="font-size: 14px;">{report.summary.dominant_rhythm}</div>
            </div>
        </div>

        <h2>⚠️ 心律失常事件</h2>
        {arrhythmia_html if report.arrhythmia_events else '<p style="color: #9ca3af;">未检测到明显心律失常事件。</p>'}

        <h2>📈 波形截图</h2>
        {snapshots_html if report.waveform_snapshots else '<p style="color: #9ca3af;">未包含波形截图。</p>'}

        <h2>💡 医疗建议</h2>
        <ul style="padding-left: 20px;">
            {recommendations_html}
        </ul>

        <div class="footer">
            <p>本报告由 ECG 监测系统自动生成 | 报告编号: {report.report_id}</p>
            <p>⚠️ 本报告仅供参考，不作为最终诊断依据，请以专业医师意见为准。</p>
        </div>
    </div>
</body>
</html>
    '''
    
    return html


def generate_pdf_report(report: AnalysisReport) -> bytes:
    """Generate PDF formatted report using HTML as intermediate format.
    
    Note: This is a simplified implementation that returns HTML content
    packaged as a PDF-compatible format. For production use, consider
    using a proper PDF library like weasyprint or reportlab.
    """
    html_content = generate_html_report(report)
    
    pdf_header = b"%PDF-1.4\n"
    pdf_content = html_content.encode('utf-8')
    
    return pdf_header + pdf_content


def export_report(report: AnalysisReport, format: ReportFormat) -> ReportExportResponse:
    """Export report in specified format."""
    timestamp = report.generated_at.strftime('%Y%m%d_%H%M%S')
    filename = f"ECG_Report_{report.report_id}_{timestamp}"
    
    if format == ReportFormat.HTML:
        content = generate_html_report(report)
        filename += ".html"
        encoded_content = content
    else:
        pdf_bytes = generate_pdf_report(report)
        encoded_content = base64.b64encode(pdf_bytes).decode('utf-8')
        filename += ".pdf"
    
    return ReportExportResponse(
        report_id=report.report_id,
        format=format,
        filename=filename,
        content=encoded_content,
    )


def export_report_from_analysis(
    analysis_data: ECGAnalysisResponse,
    format: ReportFormat = ReportFormat.HTML,
    patient_id: Optional[str] = None,
    include_snapshots: bool = True,
    snapshot_count: int = 3,
) -> ReportExportResponse:
    """Export report directly from existing analysis data."""
    report_id = generate_report_id()
    
    ecg_signal = np.array(analysis_data.lead.samples)
    r_peaks_raw = [
        {"index": rp.index, "time": rp.time, "amplitude": rp.amplitude}
        for rp in analysis_data.lead.r_peaks
    ]
    hrv_raw = {
        "heart_rate": analysis_data.hrv.heart_rate,
        "sdnn": analysis_data.hrv.sdnn,
        "rmssd": analysis_data.hrv.rmssd,
        "pnn50": analysis_data.hrv.pnn50,
        "nn_intervals": analysis_data.hrv.nn_intervals,
    }
    arrhythmia_raw = [
        {
            "event_type": evt.event_type.value,
            "confidence": evt.confidence,
            "description": evt.description,
            "timestamp": evt.timestamp,
        }
        for evt in analysis_data.arrhythmia_events
    ]
    
    summary = create_report_summary(r_peaks_raw, hrv_raw, arrhythmia_raw)
    
    waveform_snapshots = []
    if include_snapshots:
        waveform_snapshots = generate_waveform_snapshots(
            ecg_signal,
            r_peaks_raw,
            analysis_data.lead.sampling_rate,
            analysis_data.lead.duration,
            analysis_data.lead.lead_name.value,
            snapshot_count,
        )
    
    recommendations = generate_recommendations(arrhythmia_raw, hrv_raw)
    
    report = AnalysisReport(
        report_id=report_id,
        patient_id=patient_id,
        lead=analysis_data.lead,
        hrv=analysis_data.hrv,
        arrhythmia_events=analysis_data.arrhythmia_events,
        rhythm_diagnosis=analysis_data.rhythm_diagnosis,
        waveform_snapshots=waveform_snapshots,
        summary=summary,
        recommendations=recommendations,
    )
    
    return export_report(report, format)
