import logging
import os
import math
import uuid
from datetime import datetime, timezone, timedelta
from typing import List, Optional

import numpy as np
from fastapi import Depends, FastAPI, HTTPException, Request, status, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from sklearn.cluster import DBSCAN
from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    create_engine,
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

logger = logging.getLogger("pashuraksha")

# --- DATABASE SETUP ---
DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./surveillance.db")
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class ReportModel(Base):
    __tablename__ = "reports"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    tag_id = Column(String, index=True)
    species = Column(String)
    symptoms = Column(JSON)  # List of string symptom tags
    mortality_count = Column(Integer, default=0)
    latitude = Column(Float)
    longitude = Column(Float)
    village = Column(String)
    district = Column(String)
    reported_by = Column(String)  # Stores the User ID
    offline_created_at = Column(DateTime)
    server_received_at = Column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )

    # Triage outputs
    suspected_disease = Column(String)
    severity_level = Column(String)  # 'LOW', 'MODERATE', 'HIGH', 'CRITICAL', 'RESOLVED'
    cluster_id = Column(String, nullable=True)

    samples = relationship("SampleModel", back_populates="report")


class SampleModel(Base):
    __tablename__ = "samples"

    sample_id = Column(
        String,
        primary_key=True,
        default=lambda: f"SMP-{uuid.uuid4().hex[:6].upper()}",
    )
    report_id = Column(String, ForeignKey("reports.id"))
    sample_type = Column(String)  # 'Blood', 'Nasal Swab', 'Scab Tissue'
    collected_by = Column(String)
    status = Column(
        String, default="COLLECTED"
    )  # 'COLLECTED', 'IN_TRANSIT', 'TESTING', 'CONFIRMED'
    lab_name = Column(String, nullable=True)
    result = Column(String, nullable=True)  # 'POSITIVE', 'NEGATIVE', 'INCONCLUSIVE'
    collected_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    report = relationship("ReportModel", back_populates="samples")


Base.metadata.create_all(bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# --- RBAC & AUTH DEPENDENCIES ---
class UserPayload(BaseModel):
    user_id: str
    role: str


VALID_ROLES = ["FARMER", "VET", "ADMIN"]


def get_current_user(
    x_user_id: str = Header(..., description="Unique ID of the logged-in user"),
    x_user_role: str = Header(..., description="Role: FARMER, VET, ADMIN"),
) -> UserPayload:
    role = x_user_role.upper()
    if role not in VALID_ROLES:
        raise HTTPException(status_code=403, detail="Invalid user role provided.")
    return UserPayload(user_id=x_user_id, role=role)


def require_vet_or_admin(user: UserPayload = Depends(get_current_user)):
    if user.role not in ["VET", "ADMIN"]:
        raise HTTPException(status_code=403, detail="Access denied. Requires Vet or Admin privileges.")
    return user


def require_admin(user: UserPayload = Depends(get_current_user)):
    if user.role != "ADMIN":
        raise HTTPException(status_code=403, detail="Access denied. Admin privileges required.")
    return user


# --- SERIALIZATION HELPERS ---
def _ensure_utc(dt: Optional[datetime]) -> Optional[datetime]:
    """SQLite has no native timezone-aware DATETIME type, so SQLAlchemy's
    DateTime column silently drops tzinfo on the round trip: every timestamp
    we write is UTC (see the datetime.now(timezone.utc) calls throughout
    this file), but reading a row back gives a naive datetime. Re-attach UTC
    before comparing it against another tz-aware datetime, or before handing
    it to the frontend, so comparisons and displayed times are correct."""
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def serialize_report(r: ReportModel) -> dict:
    return {
        "id": r.id,
        "tag_id": r.tag_id,
        "species": r.species,
        "symptoms": r.symptoms,
        "mortality_count": r.mortality_count,
        "latitude": r.latitude,
        "longitude": r.longitude,
        "village": r.village,
        "district": r.district,
        "reported_by": r.reported_by,
        "offline_created_at": _ensure_utc(r.offline_created_at),
        "server_received_at": _ensure_utc(r.server_received_at),
        "suspected_disease": r.suspected_disease,
        "severity_level": r.severity_level,
        "cluster_id": r.cluster_id,
    }


def serialize_sample(s: SampleModel) -> dict:
    return {
        "sample_id": s.sample_id,
        "report_id": s.report_id,
        "sample_type": s.sample_type,
        "collected_by": s.collected_by,
        "status": s.status,
        "lab_name": s.lab_name,
        "result": s.result,
        "collected_at": _ensure_utc(s.collected_at),
    }


# --- SYNDROMIC TRIAGE ENGINE ---
TRIAGE_RULES = [
    {
        "disease": "Lumpy Skin Disease (LSD)",
        "species": ["Cattle", "Buffalo"],
        "symptoms": {"skin_nodules", "high_fever", "enlarged_lymph_nodes"},
        "severity": "HIGH",
        "advisory": "Isolate affected animals. Prevent vector/fly bites. Initiate ring vaccination in a 5km radius.",
    },
    {
        "disease": "Foot and Mouth Disease (FMD)",
        "species": ["Cattle", "Buffalo", "Goat", "Sheep", "Pig"],
        "symptoms": {"mouth_vesicles", "excessive_salivation", "foot_lesions", "lameness"},
        "severity": "CRITICAL",
        "advisory": "Strict movement restrictions. Apply mild disinfectant to lesions. Do not move cattle to common grazing areas.",
    },
    {
        "disease": "Anthrax",
        "species": ["Cattle", "Buffalo", "Sheep", "Goat"],
        "symptoms": {"sudden_death", "bloody_discharge", "high_fever"},
        "severity": "CRITICAL",
        "advisory": "EMERGENCY: Do not open carcass. Deep burial with quicklime at 6ft depth. Alert district veterinary officer immediately.",
    },
    {
        "disease": "Peste des Petits Ruminants (PPR)",
        "species": ["Goat", "Sheep"],
        "symptoms": {"nasal_discharge", "diarrhea", "mouth_vesicles", "high_fever"},
        "severity": "HIGH",
        "advisory": "Quarantine incoming small ruminants. Provide supportive fluid therapy and antibiotics for secondary infections.",
    },
]

def run_syndromic_triage(species: str, symptoms: List[str], mortality: int):
    symptom_set = set(s.lower().strip() for s in symptoms)
    if mortality > 0 and ("sudden_death" in symptom_set or "bloody_discharge" in symptom_set):
        return "Anthrax / Acute Septicemia", "CRITICAL"

    best_match_disease = None
    best_match_severity = "LOW"
    highest_score = 0

    for rule in TRIAGE_RULES:
        if species.capitalize() in rule["species"]:
            matches = symptom_set.intersection(rule["symptoms"])
            score = len(matches)
            if score >= 2 and score > highest_score:
                highest_score = score
                best_match_disease = rule["disease"]
                best_match_severity = rule["severity"]

    if best_match_disease:
        return best_match_disease, best_match_severity

    if len(symptoms) >= 3 or mortality > 0:
        return "Undifferentiated Febrile / Epidemic Syndrome", "MODERATE"
    return "General Non-Specific Illness", "LOW"


# --- FASTAPI APP ---
app = FastAPI(
    title="PashuRaksha Surveillance Backend",
    version="1.0.0",
    description="Livestock Early Warning & Syndromic Surveillance Engine with RBAC",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal server error: {exc}"},
    )


# --- SCHEMAS ---
class ReportCreate(BaseModel):
    tag_id: str = Field(..., pattern=r'^\d{12}$', example="123456789012", description="12-digit numerical tag ID")
    species: str = Field(..., example="Cattle")
    symptoms: List[str] = Field(..., example=["skin_nodules", "high_fever", "enlarged_lymph_nodes"])
    mortality_count: int = 0
    latitude: float = Field(..., example=12.8231)
    longitude: float = Field(..., example=80.0442)
    village: str = Field(..., example="Maraimalai Nagar")
    district: str = Field(..., example="Chengalpattu")
    offline_created_at: Optional[datetime] = None

    @field_validator('symptoms')
    def limit_symptoms(cls, v):
        if len(v) > 5:
            raise ValueError('Maximum 5 symptoms allowed to ensure triage accuracy.')
        return v

class BatchSync(BaseModel):
    reports: List[ReportCreate]

class SampleCreate(BaseModel):
    report_id: str
    sample_type: str
    lab_name: Optional[str] = None

class SampleUpdate(BaseModel):
    status: str
    result: Optional[str] = None


# --- ENDPOINTS ---

@app.post(
    "/api/v1/reports",
    status_code=status.HTTP_201_CREATED,
    summary="Submit single symptom report",
)
def submit_report(payload: ReportCreate, db=Depends(get_db), user: UserPayload = Depends(get_current_user)):
    existing_active_report = db.query(ReportModel).filter(
        ReportModel.tag_id == payload.tag_id,
        ReportModel.severity_level != "RESOLVED",
    ).first()

    if existing_active_report:
        raise HTTPException(
            status_code=400,
            detail=f"An active report already exists for Tag: {payload.tag_id}. Resolve it first."
        )

    disease, severity = run_syndromic_triage(
        payload.species, payload.symptoms, payload.mortality_count
    )

    db_report = ReportModel(
        tag_id=payload.tag_id,
        species=payload.species,
        symptoms=payload.symptoms,
        mortality_count=payload.mortality_count,
        latitude=payload.latitude,
        longitude=payload.longitude,
        village=payload.village,
        district=payload.district,
        reported_by=user.user_id,
        offline_created_at=payload.offline_created_at or datetime.now(timezone.utc),
        suspected_disease=disease,
        severity_level=severity,
    )
    db.add(db_report)
    db.commit()
    db.refresh(db_report)

    return {
        "status": "success",
        "report_id": db_report.id,
        "triage": {
            "suspected_disease": disease,
            "severity_level": severity,
            "immediate_action_required": severity in ["HIGH", "CRITICAL"],
        },
    }


@app.post(
    "/api/v1/reports/batch-sync",
    summary="Batch sync endpoint for offline mobile queue",
)
def batch_sync_reports(payload: BatchSync, db=Depends(get_db), user: UserPayload = Depends(get_current_user)):
    created_ids = []
    skipped_tags = []
    seen_in_batch = set()

    for rep in payload.reports:
        existing_active = db.query(ReportModel).filter(
            ReportModel.tag_id == rep.tag_id,
            ReportModel.severity_level != "RESOLVED"
        ).first()

        if existing_active or rep.tag_id in seen_in_batch:
            skipped_tags.append(rep.tag_id)
            continue

        disease, severity = run_syndromic_triage(
            rep.species, rep.symptoms, rep.mortality_count
        )
        db_report = ReportModel(
            tag_id=rep.tag_id,
            species=rep.species,
            symptoms=rep.symptoms,
            mortality_count=rep.mortality_count,
            latitude=rep.latitude,
            longitude=rep.longitude,
            village=rep.village,
            district=rep.district,
            reported_by=user.user_id,
            offline_created_at=rep.offline_created_at or datetime.now(timezone.utc),
            suspected_disease=disease,
            severity_level=severity,
        )
        db.add(db_report)
        created_ids.append(db_report.id)
        seen_in_batch.add(rep.tag_id)

    db.commit()
    return {
        "status": "synced",
        "synced_count": len(created_ids),
        "skipped_duplicate_tags": skipped_tags,
        "ids": created_ids,
    }


@app.get("/api/v1/reports", summary="Get all individual reports for GIS plotting")
def get_all_reports(db=Depends(get_db), user: UserPayload = Depends(require_vet_or_admin)):
    reports = (
        db.query(ReportModel)
        .order_by(ReportModel.server_received_at.desc())
        .all()
    )
    return [serialize_report(r) for r in reports]


@app.get("/api/v1/reports/mine", summary="Get reports submitted by the current logged-in user")
def get_my_reports(db=Depends(get_db), user: UserPayload = Depends(get_current_user)):
    reports = (
        db.query(ReportModel)
        .filter(ReportModel.reported_by == user.user_id)
        .order_by(ReportModel.server_received_at.desc())
        .all()
    )
    return [serialize_report(r) for r in reports]


@app.get(
    "/api/v1/analytics/clusters",
    summary="Run DBSCAN clustering to detect active outbreak zones & update DB",
)
def detect_disease_clusters(
    radius_km: float = 5.0, min_cases: int = 3, db=Depends(get_db), user: UserPayload = Depends(require_vet_or_admin)
):
    if min_cases < 1:
        raise HTTPException(status_code=400, detail="min_cases must be at least 1.")
    if radius_km <= 0:
        raise HTTPException(status_code=400, detail="radius_km must be greater than 0.")

    time_threshold = datetime.now(timezone.utc) - timedelta(days=14)

    active_reports = (
        db.query(ReportModel)
        .filter(ReportModel.severity_level.in_(["HIGH", "CRITICAL"]))
        .all()
    )
    
    for r in active_reports:
        r.cluster_id = None

    recent_active_reports = [
        r for r in active_reports if _ensure_utc(r.server_received_at) >= time_threshold
    ]

    if len(recent_active_reports) < min_cases:
        db.commit()
        return {"active_clusters_count": 0, "clusters": []}

    disease_groups = {}
    for r in recent_active_reports:
        disease_groups.setdefault(r.suspected_disease, []).append(r)

    clusters = []
    kms_per_radian = 6371.0088
    epsilon = radius_km / kms_per_radian
    cluster_counter = 1

    for disease, d_reports in disease_groups.items():
        if len(d_reports) < min_cases:
            continue

        coords = np.array([[r.latitude, r.longitude] for r in d_reports])
        dbscan = DBSCAN(
            eps=epsilon, min_samples=min_cases, metric="haversine", algorithm="ball_tree"
        )
        labels = dbscan.fit_predict(np.radians(coords))
        unique_labels = set(labels)

        for cluster_label in unique_labels:
            if cluster_label == -1:
                continue 

            cluster_indices = np.where(labels == cluster_label)[0]
            cluster_reports = [d_reports[i] for i in cluster_indices]
            
            disease_prefix = disease[:3].upper() if disease else "UNK"
            cluster_id_str = f"CLS-{disease_prefix}-{cluster_counter:03d}"
            cluster_counter += 1

            center_lat = float(np.mean([r.latitude for r in cluster_reports]))
            center_lng = float(np.mean([r.longitude for r in cluster_reports]))

            for r in cluster_reports:
                r.cluster_id = cluster_id_str

            clusters.append(
                {
                    "cluster_id": cluster_id_str,
                    "primary_disease": disease, 
                    "case_count": len(cluster_reports),
                    "center": [center_lat, center_lng],
                    "radius_km": radius_km,
                    "affected_villages": list(set(r.village for r in cluster_reports)),
                    "containment_status": "ACTIVE_CONTAINMENT",
                    "recommended_protocols": [
                        f"Establish a {radius_km}km ring vaccination corridor for {disease}",
                        "Suspend weekly livestock village markets (shandies)",
                        "Deploy mobile veterinary disinfectant vans",
                    ],
                }
            )

    db.commit()
    return {
        "active_clusters_count": len(clusters),
        "clusters": clusters,
    }


@app.post(
    "/api/v1/lab/samples",
    status_code=status.HTTP_201_CREATED,
    summary="Dispatch & track diagnostic lab specimen",
)
def create_sample_referral(payload: SampleCreate, db=Depends(get_db), user: UserPayload = Depends(require_vet_or_admin)):
    report = db.query(ReportModel).filter(ReportModel.id == payload.report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Incident report not found")

    sample = SampleModel(
        report_id=payload.report_id,
        sample_type=payload.sample_type,
        collected_by=user.user_id,
        lab_name=payload.lab_name,
    )
    db.add(sample)
    db.commit()
    db.refresh(sample)
    return {
        "status": "registered",
        "sample_id": sample.sample_id,
        "chain_of_custody": sample.status,
    }


@app.get("/api/v1/lab/samples", summary="List diagnostic lab samples")
def list_samples(
    report_id: Optional[str] = Query(None, description="Filter samples by report id"),
    db=Depends(get_db),
    user: UserPayload = Depends(require_vet_or_admin),
):
    query = db.query(SampleModel)
    if report_id:
        query = query.filter(SampleModel.report_id == report_id)
    samples = query.order_by(SampleModel.collected_at.desc()).all()
    return [serialize_sample(s) for s in samples]


@app.patch("/api/v1/lab/samples/{sample_id}", summary="Update lab test outcome")
def update_lab_status(
    sample_id: str, payload: SampleUpdate, db=Depends(get_db), user: UserPayload = Depends(require_vet_or_admin)
):
    sample = db.query(SampleModel).filter(SampleModel.sample_id == sample_id).first()
    if not sample:
        raise HTTPException(status_code=404, detail="Sample ID not found")

    sample.status = payload.status
    if payload.result:
        sample.result = payload.result
    db.commit()
    return {
        "sample_id": sample.sample_id,
        "status": sample.status,
        "result": sample.result,
    }

@app.delete("/api/v1/reports/{report_id}", summary="Delete a specific report by ID")
def delete_report(report_id: str, db=Depends(get_db), user: UserPayload = Depends(get_current_user)):
    report = db.query(ReportModel).filter(ReportModel.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    
    if user.role != "ADMIN":
        if report.reported_by != user.user_id:
            raise HTTPException(status_code=403, detail="Forbidden. You can only delete your own reports.")
        
        now_utc = datetime.now(timezone.utc)
        report_time_utc = _ensure_utc(report.server_received_at)
        time_diff = now_utc - report_time_utc
        
        if time_diff.days > 14:
            raise HTTPException(status_code=403, detail="Forbidden. Cannot delete reports older than 14 days.")
    
    db.query(SampleModel).filter(SampleModel.report_id == report_id).delete()
    db.delete(report)
    db.commit()
    return {"status": "success", "message": f"Report {report_id} and associated samples deleted"}


@app.delete("/api/v1/reports", summary="Reset/Clear all demo reports")
def delete_all_reports(db=Depends(get_db), user: UserPayload = Depends(require_admin)):
    db.query(SampleModel).delete()
    db.query(ReportModel).delete()
    db.commit()
    return {"status": "success", "message": "All test reports and samples cleared"}


@app.patch("/api/v1/reports/{report_id}/resolve", summary="Mark a case as resolved/quarantined")
def resolve_report(report_id: str, db=Depends(get_db), user: UserPayload = Depends(require_vet_or_admin)):
    report = db.query(ReportModel).filter(ReportModel.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    
    report.severity_level = "RESOLVED"
    report.cluster_id = None
    db.commit()
    return {
        "status": "success", 
        "message": f"Report {report_id} marked as RESOLVED (removed from active outbreak clusters)"
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
