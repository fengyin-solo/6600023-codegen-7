from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import HTMLResponse, StreamingResponse
import base64
import io
from typing import Optional

from app.models.schemas import (
    ReportGenerationRequest,
    ReportExportResponse,
    AnalysisReport,
    ReportFormat,
    ECGAnalysisResponse,
)
from app.services.report_service import (
    generate_analysis_report,
    export_report,
    export_report_from_analysis,
    generate_html_report,
)

router = APIRouter(prefix="/report", tags=["Report"])


@router.post("/generate", response_model=AnalysisReport)
async def generate_report(request: ReportGenerationRequest):
    """
    Generate a complete ECG analysis report with waveform snapshots,
    HRV metrics, arrhythmia detection, and recommendations.
    """
    try:
        report = generate_analysis_report(request)
        return report
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate report: {str(e)}")


@router.post("/export", response_model=ReportExportResponse)
async def export_report_endpoint(request: ReportGenerationRequest):
    """
    Generate and export a report in the specified format (HTML or PDF).
    Returns the report content encoded for download.
    """
    try:
        report = generate_analysis_report(request)
        export_response = export_report(report, request.format)
        return export_response
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to export report: {str(e)}")


@router.post("/export-from-analysis", response_model=ReportExportResponse)
async def export_from_existing_analysis(
    analysis_data: ECGAnalysisResponse,
    format: ReportFormat = ReportFormat.HTML,
    patient_id: Optional[str] = None,
    include_snapshots: bool = True,
    snapshot_count: int = 3,
):
    """
    Export a report directly from existing ECG analysis results.
    Useful when you already have the analysis data and just need the report.
    """
    try:
        export_response = export_report_from_analysis(
            analysis_data=analysis_data,
            format=format,
            patient_id=patient_id,
            include_snapshots=include_snapshots,
            snapshot_count=snapshot_count,
        )
        return export_response
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to export report: {str(e)}")


@router.post("/download/html")
async def download_html_report(request: ReportGenerationRequest):
    """
    Generate and download an HTML report as a file.
    """
    try:
        report = generate_analysis_report(request)
        html_content = generate_html_report(report)
        
        timestamp = report.generated_at.strftime('%Y%m%d_%H%M%S')
        filename = f"ECG_Report_{report.report_id}_{timestamp}.html"
        
        return Response(
            content=html_content,
            media_type="text/html",
            headers={
                "Content-Disposition": f"attachment; filename={filename}"
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate HTML report: {str(e)}")


@router.post("/preview/html")
async def preview_html_report(request: ReportGenerationRequest):
    """
    Generate and return an HTML report for preview in the browser.
    """
    try:
        report = generate_analysis_report(request)
        html_content = generate_html_report(report)
        
        return HTMLResponse(content=html_content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate preview: {str(e)}")


@router.get("/{report_id}")
async def get_report(report_id: str):
    """
    Get a previously generated report by ID.
    
    Note: In a production environment, this would fetch from a database.
    This is a placeholder endpoint.
    """
    raise HTTPException(
        status_code=501,
        detail="Report retrieval by ID is not implemented in this demo version. "
               "Reports are generated on-demand and not persisted."
    )
