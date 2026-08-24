import logging
import os
import random
import uuid
from datetime import datetime, timezone, timedelta
from typing import List, Optional

import numpy as np
from fastapi import Depends, FastAPI, HTTPException, Request, status, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import AliasChoices, BaseModel, Field, field_validator
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
    inspect,
    text,
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

from livestock_registry import (
    DEMO_OWNERS,
    DISTRICTS_COVERED,
    LEGACY_OWNERS,
    LIVESTOCK_REGISTRY,
    MAX_HOLDING,
    STATES_COVERED,
    holdings,
)

logger = logging.getLogger("pashuraksha")

# --- DATABASE SETUP ---
DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./surveillance.db")
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args, pool_pre_ping=True, pool_size=3, max_overflow=2)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class LivestockModel(Base):
    """The Pashu Aadhaar registry: 12-digit tag -> owner + registered location.

    This is the lookup table behind the report form's auto-fill. It is seeded
    from livestock_registry.py on startup and is read-only over the API.
    """

    __tablename__ = "livestock_registry"

    pashu_aadhaar = Column(String(12), primary_key=True)
    owner_id = Column(String, index=True, nullable=False)
    owner_name = Column(String, nullable=False)
    species = Column(String, nullable=False)
    breed = Column(String)
    sex = Column(String)
    age_years = Column(Float)
    village = Column(String)
    district = Column(String)
    state = Column(String)
    latitude = Column(Float)
    longitude = Column(Float)


class ReportModel(Base):
    __tablename__ = "reports"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    tag_id = Column(String, index=True)  # the animal's 12-digit Pashu Aadhaar
    species = Column(String)
    symptoms = Column(JSON)  # List of string symptom tags
    mortality_count = Column(Integer, default=0)
    latitude = Column(Float)
    longitude = Column(Float)
    village = Column(String)
    district = Column(String)
    state = Column(String)
    reported_by = Column(String)  # Stores the User ID of the *reporter*
    # Owner of the animal per the Pashu Aadhaar registry. Distinct from
    # reported_by: a vet can file a report against a farmer's animal, and the
    # case still belongs to that farmer for follow-up and compensation.
    owner_id = Column(String, index=True, nullable=True)
    owner_name = Column(String, nullable=True)
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


def _ensure_columns():
    """Add columns that create_all() won't add to an already-existing table.

    create_all() is a no-op for a table that exists, so a database created
    before owner_id/owner_name/state were introduced keeps its old shape and
    every query against the new columns fails. Both SQLite and Postgres accept
    this ALTER form, and IF NOT EXISTS isn't portable across them -- hence the
    inspector check instead.
    """
    inspector = inspect(engine)
    if "reports" not in inspector.get_table_names():
        return

    existing = {c["name"] for c in inspector.get_columns("reports")}
    additions = [
        ("owner_id", "VARCHAR"),
        ("owner_name", "VARCHAR"),
        ("state", "VARCHAR"),
    ]
    with engine.begin() as conn:
        for name, ddl_type in additions:
            if name not in existing:
                logger.info("Migrating reports table: adding column %s", name)
                conn.execute(text(f"ALTER TABLE reports ADD COLUMN {name} {ddl_type}"))


def seed_livestock_registry():
    """Insert any registry rows the database doesn't have yet.

    Idempotent, so it's safe to run on every cold start of the serverless
    function. Existing rows are left alone rather than overwritten.

    The registry is ~2,300 rows, so the insert goes through
    bulk_insert_mappings: building that many ORM instances individually adds
    seconds to a cold start that already pays for the sklearn/numpy import.
    After the first run the SELECT finds everything and nothing is written.
    """
    db = SessionLocal()
    try:
        known = {row[0] for row in db.query(LivestockModel.pashu_aadhaar).all()}
        pending = [e for e in LIVESTOCK_REGISTRY if e["pashu_aadhaar"] not in known]
        if pending:
            db.bulk_insert_mappings(LivestockModel, pending)
            db.commit()
            logger.info("Seeded %d livestock registry entries", len(pending))
    except Exception:
        db.rollback()
        logger.exception("Could not seed livestock registry")
    finally:
        db.close()


_ensure_columns()
seed_livestock_registry()


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
        # Same value under the registry's own name, so the frontend can talk
        # about Pashu Aadhaar without every caller having to know the legacy
        # `tag_id` field name.
        "pashu_aadhaar": r.tag_id,
        "species": r.species,
        "symptoms": r.symptoms,
        "mortality_count": r.mortality_count,
        "latitude": r.latitude,
        "longitude": r.longitude,
        "village": r.village,
        "district": r.district,
        "state": r.state,
        "reported_by": r.reported_by,
        "owner_id": r.owner_id,
        "owner_name": r.owner_name,
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


def serialize_livestock(a: LivestockModel) -> dict:
    return {
        "pashu_aadhaar": a.pashu_aadhaar,
        "owner_id": a.owner_id,
        "owner_name": a.owner_name,
        "species": a.species,
        "breed": a.breed,
        "sex": a.sex,
        "age_years": a.age_years,
        "village": a.village,
        "district": a.district,
        "state": a.state,
        "latitude": a.latitude,
        "longitude": a.longitude,
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


def advisory_for(disease: Optional[str]) -> Optional[str]:
    for rule in TRIAGE_RULES:
        if rule["disease"] == disease:
            return rule["advisory"]
    return None


# --- FASTAPI APP ---
app = FastAPI(
    title="PashuRaksha Surveillance Backend",
    version="1.1.0",
    description="Livestock Early Warning & Syndromic Surveillance Engine with RBAC and Pashu Aadhaar registry",
)

# Origins allowed to call the API. Vite serves `npm run dev` on 5173 and
# `npm run preview` on 4173 -- the preview port matters because that is the only
# way to exercise the installed-PWA build locally, and leaving it out makes the
# service worker look broken when the real fault is a blocked preflight.
# CORS_ALLOW_ORIGINS (comma-separated) adds deploy-preview URLs without a code change.
_DEFAULT_ORIGINS = [
    "https://pashuraksha-app.vercel.app",
    "http://localhost:5173",
    "http://localhost:4173",
]
_EXTRA_ORIGINS = [
    o.strip() for o in os.environ.get("CORS_ALLOW_ORIGINS", "").split(",") if o.strip()
]
ALLOWED_ORIGINS = _DEFAULT_ORIGINS + _EXTRA_ORIGINS

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
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
    # Accepts either `tag_id` or `pashu_aadhaar` on the wire -- same field.
    # AliasChoices is what actually makes both names work; the previous
    # alias="tag_id" + validation_alias=None combination silently accepted
    # only `tag_id`, so any client following the newer name got a 422.
    tag_id: str = Field(
        ...,
        pattern=r'^\d{12}$',
        validation_alias=AliasChoices("tag_id", "pashu_aadhaar"),
        serialization_alias="tag_id",
        example="900412780031",
        description="12-digit Pashu Aadhaar number",
    )
    species: Optional[str] = Field(None, example="Cattle")
    symptoms: List[str] = Field(..., example=["skin_nodules", "high_fever", "enlarged_lymph_nodes"])
    mortality_count: int = 0
    # Location fields are optional: for an animal in the Pashu Aadhaar registry
    # the server fills them from the registry and ignores whatever the client
    # sent, so the form doesn't have to supply them at all.
    latitude: Optional[float] = Field(None, example=12.8231)
    longitude: Optional[float] = Field(None, example=80.0442)
    village: Optional[str] = Field(None, example="Maraimalai Nagar")
    district: Optional[str] = Field(None, example="Chengalpattu")
    state: Optional[str] = Field(None, example="Tamil Nadu")
    offline_created_at: Optional[datetime] = None

    model_config = {"populate_by_name": True}

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


# --- PASHU AADHAAR OWNERSHIP + AUTO-FILL ---
def resolve_animal_context(db, tag_id: str, user: UserPayload, payload: ReportCreate) -> dict:
    """Work out the location/ownership fields to store for a report.

    Registered animal -> the registry is authoritative for owner and location,
    and a FARMER may only file against an animal they own.
    Unregistered tag -> fall back to whatever the client supplied.
    """
    animal = db.query(LivestockModel).filter(LivestockModel.pashu_aadhaar == tag_id).first()

    if animal is None:
        if payload.latitude is None or payload.longitude is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Pashu Aadhaar {tag_id} is not in the registry, so location "
                    "cannot be auto-filled. Provide latitude and longitude."
                ),
            )
        return {
            "species": payload.species or "Cattle",
            "latitude": payload.latitude,
            "longitude": payload.longitude,
            "village": payload.village or "Unknown",
            "district": payload.district or "Unknown",
            "state": payload.state,
            "owner_id": user.user_id if user.role == "FARMER" else None,
            "owner_name": None,
            "registered": False,
        }

    if user.role == "FARMER" and animal.owner_id != user.user_id:
        raise HTTPException(
            status_code=403,
            detail=(
                f"Pashu Aadhaar {tag_id} is registered to a different owner. "
                "You can only report animals registered in your own name."
            ),
        )

    return {
        "species": animal.species,
        "latitude": animal.latitude,
        "longitude": animal.longitude,
        "village": animal.village,
        "district": animal.district,
        "state": animal.state,
        "owner_id": animal.owner_id,
        "owner_name": animal.owner_name,
        "registered": True,
    }


# --- ENDPOINTS ---

@app.get("/api/v1/livestock/mine", summary="Animals registered to the logged-in owner")
def my_livestock(db=Depends(get_db), user: UserPayload = Depends(get_current_user)):
    animals = (
        db.query(LivestockModel)
        .filter(LivestockModel.owner_id == user.user_id)
        .order_by(LivestockModel.pashu_aadhaar)
        .all()
    )
    return [serialize_livestock(a) for a in animals]


@app.get("/api/v1/livestock", summary="Full Pashu Aadhaar registry (Vet/Admin)")
def list_livestock(
    owner_id: Optional[str] = Query(None, description="Filter by owner"),
    db=Depends(get_db),
    user: UserPayload = Depends(require_vet_or_admin),
):
    query = db.query(LivestockModel)
    if owner_id:
        query = query.filter(LivestockModel.owner_id == owner_id)
    animals = query.order_by(LivestockModel.pashu_aadhaar).all()
    return [serialize_livestock(a) for a in animals]


@app.get(
    "/api/v1/livestock/{pashu_aadhaar}",
    summary="Look up one animal by Pashu Aadhaar (drives form auto-fill)",
)
def lookup_livestock(
    pashu_aadhaar: str, db=Depends(get_db), user: UserPayload = Depends(get_current_user)
):
    if not (pashu_aadhaar.isdigit() and len(pashu_aadhaar) == 12):
        raise HTTPException(status_code=400, detail="Pashu Aadhaar must be exactly 12 digits.")

    animal = (
        db.query(LivestockModel)
        .filter(LivestockModel.pashu_aadhaar == pashu_aadhaar)
        .first()
    )
    if not animal:
        raise HTTPException(
            status_code=404,
            detail=f"Pashu Aadhaar {pashu_aadhaar} is not in the registry.",
        )

    owned_by_requester = animal.owner_id == user.user_id

    # A farmer may only see their own animals. Vets and admins need to look up
    # any animal to work a case, but the response flags that it isn't theirs.
    if user.role == "FARMER" and not owned_by_requester:
        raise HTTPException(
            status_code=403,
            detail=(
                f"Pashu Aadhaar {pashu_aadhaar} is registered to another owner. "
                "Location details are only shown to the registered owner."
            ),
        )

    return {**serialize_livestock(animal), "owned_by_requester": owned_by_requester}


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
            detail=f"An active report already exists for Pashu Aadhaar: {payload.tag_id}. Resolve it first."
        )

    ctx = resolve_animal_context(db, payload.tag_id, user, payload)

    disease, severity = run_syndromic_triage(
        ctx["species"], payload.symptoms, payload.mortality_count
    )

    db_report = ReportModel(
        tag_id=payload.tag_id,
        species=ctx["species"],
        symptoms=payload.symptoms,
        mortality_count=payload.mortality_count,
        latitude=ctx["latitude"],
        longitude=ctx["longitude"],
        village=ctx["village"],
        district=ctx["district"],
        state=ctx["state"],
        reported_by=user.user_id,
        owner_id=ctx["owner_id"],
        owner_name=ctx["owner_name"],
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
        "owner_id": db_report.owner_id,
        "owner_name": db_report.owner_name,
        "registered_animal": ctx["registered"],
        "location": {
            "village": db_report.village,
            "district": db_report.district,
            "state": db_report.state,
            "latitude": db_report.latitude,
            "longitude": db_report.longitude,
        },
        "triage": {
            "suspected_disease": disease,
            "severity_level": severity,
            "advisory": advisory_for(disease),
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
    rejected = []
    seen_in_batch = set()

    for rep in payload.reports:
        existing_active = db.query(ReportModel).filter(
            ReportModel.tag_id == rep.tag_id,
            ReportModel.severity_level != "RESOLVED"
        ).first()

        if existing_active or rep.tag_id in seen_in_batch:
            skipped_tags.append(rep.tag_id)
            continue

        # One bad tag in an offline queue shouldn't sink the whole sync -- a
        # queued report for someone else's animal is reported back separately
        # so the farmer can see which entries were dropped and why.
        try:
            ctx = resolve_animal_context(db, rep.tag_id, user, rep)
        except HTTPException as exc:
            rejected.append({"tag_id": rep.tag_id, "reason": exc.detail})
            continue

        disease, severity = run_syndromic_triage(
            ctx["species"], rep.symptoms, rep.mortality_count
        )
        db_report = ReportModel(
            tag_id=rep.tag_id,
            species=ctx["species"],
            symptoms=rep.symptoms,
            mortality_count=rep.mortality_count,
            latitude=ctx["latitude"],
            longitude=ctx["longitude"],
            village=ctx["village"],
            district=ctx["district"],
            state=ctx["state"],
            reported_by=user.user_id,
            owner_id=ctx["owner_id"],
            owner_name=ctx["owner_name"],
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
        "rejected": rejected,
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


@app.get("/api/v1/reports/mine", summary="Reports filed by, or about animals owned by, the current user")
def get_my_reports(db=Depends(get_db), user: UserPayload = Depends(get_current_user)):
    """Covers both sides of a farmer's interest in a case: reports they filed,
    and reports anyone (e.g. a visiting vet) filed against their animals."""
    reports = (
        db.query(ReportModel)
        .filter(
            (ReportModel.reported_by == user.user_id)
            | (ReportModel.owner_id == user.user_id)
        )
        .order_by(ReportModel.server_received_at.desc())
        .all()
    )
    return [serialize_report(r) for r in reports]


# --- DASHBOARD AGGREGATES ---
_METRICS = ("reported", "active", "critical", "resolved", "mortality")


def _blank_bucket() -> dict:
    return {m: 0 for m in _METRICS}


def _blank_geo() -> dict:
    """Running sum used to average a bucket's reports into one map point."""
    return {"lat_sum": 0.0, "lng_sum": 0.0, "n": 0}


def _add_geo(node: dict, report: ReportModel):
    if report.latitude is None or report.longitude is None:
        return
    geo = node["_geo"]
    geo["lat_sum"] += report.latitude
    geo["lng_sum"] += report.longitude
    geo["n"] += 1


def _shape_geo(node: dict) -> dict:
    """Replace the running sum with a centroid the frontend can plot.

    Bubble mode needs one coordinate per state/district. Averaging the member
    reports is better than a polygon centroid here: it puts the bubble where
    the cases actually are, which for a district with one affected corner is a
    visibly different -- and more honest -- place.
    """
    geo = node.pop("_geo")
    if geo["n"]:
        node["latitude"] = round(geo["lat_sum"] / geo["n"], 6)
        node["longitude"] = round(geo["lng_sum"] / geo["n"], 6)
    else:
        node["latitude"] = None
        node["longitude"] = None
    return node


def _classify(r: ReportModel) -> dict:
    severity = r.severity_level or "LOW"
    resolved = severity == "RESOLVED"
    return {
        "reported": 1,
        "active": 0 if resolved else 1,
        "critical": 1 if severity in ("HIGH", "CRITICAL") else 0,
        "resolved": 1 if resolved else 0,
        "mortality": r.mortality_count or 0,
    }


def _accumulate(bucket: dict, contrib: dict):
    for m in _METRICS:
        bucket[m] += contrib[m]


@app.get(
    "/api/v1/analytics/summary",
    summary="Aggregated counts powering the surveillance dashboard",
)
def analytics_summary(
    days: int = Query(30, ge=7, le=365, description="Length of the timeseries window"),
    db=Depends(get_db),
    user: UserPayload = Depends(get_current_user),
):
    """Aggregate-only, so it is readable by every role including FARMER -- it
    carries no tag ids, owner names or coordinates, just counts per area."""
    reports = db.query(ReportModel).all()
    now = datetime.now(timezone.utc)
    day_ago = now - timedelta(hours=24)
    window_start = (now - timedelta(days=days - 1)).date()

    totals = _blank_bucket()
    deltas = _blank_bucket()
    states: dict = {}
    diseases: dict = {}
    daily: dict = {}

    for r in reports:
        contrib = _classify(r)
        received = _ensure_utc(r.server_received_at) or now
        state_name = r.state or "Unassigned"
        district_name = r.district or "Unknown"
        village_name = r.village or "Unknown"

        _accumulate(totals, contrib)
        if received >= day_ago:
            _accumulate(deltas, contrib)

        state = states.setdefault(
            state_name,
            {"name": state_name, "districts": {}, "_geo": _blank_geo(),
             **_blank_bucket(), "delta": _blank_bucket()},
        )
        district = state["districts"].setdefault(
            district_name,
            {"name": district_name, "villages": {}, "_geo": _blank_geo(),
             **_blank_bucket(), "delta": _blank_bucket()},
        )
        village = district["villages"].setdefault(
            village_name,
            {"name": village_name, "_geo": _blank_geo(),
             **_blank_bucket(), "delta": _blank_bucket()},
        )
        for node in (state, district, village):
            _accumulate(node, contrib)
            _add_geo(node, r)
            if received >= day_ago:
                _accumulate(node["delta"], contrib)

        if r.suspected_disease:
            entry = diseases.setdefault(
                r.suspected_disease, {"disease": r.suspected_disease, "count": 0, "critical": 0}
            )
            entry["count"] += 1
            entry["critical"] += contrib["critical"]

        day = received.date()
        if day >= window_start:
            _accumulate(daily.setdefault(day.isoformat(), _blank_bucket()), contrib)

    # Dense date axis: charts need a bar slot for quiet days too, otherwise a
    # gap in reporting reads as a compressed timeline rather than zero cases.
    timeseries = []
    running = _blank_bucket()
    for offset in range(days):
        day = (window_start + timedelta(days=offset)).isoformat()
        point = daily.get(day, _blank_bucket())
        for m in _METRICS:
            running[m] += point[m]
        timeseries.append({"date": day, "daily": dict(point), "cumulative": dict(running)})

    sample_rows = db.query(SampleModel).all()
    samples = {
        "total": len(sample_rows),
        "confirmed": sum(1 for s in sample_rows if s.status == "CONFIRMED"),
        "positive": sum(1 for s in sample_rows if s.result == "POSITIVE"),
    }

    def shape_state(s):
        districts = [
            _shape_geo({
                **{k: d[k] for k in _METRICS},
                "name": d["name"],
                "delta": d["delta"],
                "_geo": d["_geo"],
                "villages": sorted(
                    [_shape_geo({**{k: v[k] for k in _METRICS}, "name": v["name"],
                                 "delta": v["delta"], "_geo": v["_geo"]})
                     for v in d["villages"].values()],
                    key=lambda v: -v["reported"],
                ),
            })
            for d in s["districts"].values()
        ]
        districts.sort(key=lambda d: -d["reported"])
        return _shape_geo({
            **{k: s[k] for k in _METRICS},
            "name": s["name"],
            "delta": s["delta"],
            "_geo": s["_geo"],
            "districts": districts,
        })

    state_rows = sorted((shape_state(s) for s in states.values()), key=lambda s: -s["reported"])

    return {
        "updated_at": now,
        "totals": totals,
        "deltas": deltas,
        "states": state_rows,
        "diseases": sorted(diseases.values(), key=lambda d: -d["count"]),
        "timeseries": timeseries,
        "samples": samples,
        "registry_size": db.query(LivestockModel).count(),
    }


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
        r for r in active_reports
        if _ensure_utc(r.server_received_at) >= time_threshold
        and r.latitude is not None and r.longitude is not None
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
                    "affected_villages": sorted(set(r.village for r in cluster_reports if r.village)),
                    "affected_districts": sorted(set(r.district for r in cluster_reports if r.district)),
                    "affected_states": sorted(set(r.state for r in cluster_reports if r.state)),
                    # Who to contact for containment: owners of the animals in
                    # the cluster, not the people who filed the reports.
                    "affected_owners": sorted(
                        set(r.owner_name or r.owner_id for r in cluster_reports if r.owner_id or r.owner_name)
                    ),
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
        # The animal's owner can withdraw a report about their animal even if a
        # vet filed it; anyone else is limited to reports they filed themselves.
        if report.reported_by != user.user_id and report.owner_id != user.user_id:
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


# --- DEMO DATA ---
_DEMO_SYMPTOM_SETS = [
    (["skin_nodules", "high_fever", "enlarged_lymph_nodes"], 0),
    (["mouth_vesicles", "excessive_salivation", "foot_lesions"], 0),
    (["mouth_vesicles", "lameness", "high_fever"], 0),
    (["nasal_discharge", "diarrhea", "high_fever"], 0),
    (["sudden_death", "bloody_discharge", "high_fever"], 1),
    (["high_fever", "nasal_discharge"], 0),
    (["diarrhea"], 0),
    (["lameness", "foot_lesions"], 0),
]


@app.post("/api/v1/admin/seed-demo", summary="Populate the dashboard with demo reports")
def seed_demo_reports(
    count: int = Query(700, ge=1, le=4000, description="How many reports to generate"),
    days: int = Query(30, ge=1, le=180, description="Spread reports over this many past days"),
    hotspots: int = Query(14, ge=0, le=40, description="How many districts become outbreak epicentres"),
    seed: int = Query(42, description="RNG seed, so a given seed always yields the same dataset"),
    db=Depends(get_db),
    user: UserPayload = Depends(require_admin),
):
    """Generate a spread of historical reports so the dashboard has data.

    Reports are *not* scattered uniformly. With ~2,300 animals across 239
    districts, a uniform draw puts one or two cases in each district and DBSCAN
    finds nothing -- the outbreak map comes up empty, which is the opposite of
    what a demo needs to show. So most of the volume is concentrated into a
    handful of randomly chosen epicentre districts, each running a single
    disease-consistent symptom set, with the remainder scattered nationally as
    background noise. That reproduces the real shape of an outbreak: dense
    correlated pockets against a thin diffuse baseline.

    Reports are backdated, so most end up RESOLVED; only the newest report per
    animal stays active, which keeps the 'one active report per tag' invariant
    the submit endpoint enforces.
    """
    rng = random.Random(seed)
    animals = db.query(LivestockModel).all()
    if not animals:
        raise HTTPException(status_code=400, detail="Livestock registry is empty; nothing to seed against.")

    now = datetime.now(timezone.utc)
    existing_active = {
        r.tag_id
        for r in db.query(ReportModel).filter(ReportModel.severity_level != "RESOLVED").all()
    }

    by_district: dict = {}
    for a in animals:
        by_district.setdefault((a.state, a.district), []).append(a)

    # Epicentres: districts big enough to actually form a cluster. min_samples
    # for DBSCAN defaults to 3, so a district with fewer animals than that can
    # never produce one however many reports it gets.
    eligible = [k for k, v in by_district.items() if len(v) >= 4]
    rng.shuffle(eligible)
    epicentres = eligible[:hotspots]

    # Each epicentre runs one disease, so its cases share a suspected_disease
    # and DBSCAN (which groups per disease) sees them as one outbreak.
    outbreak_sets = [s for s in _DEMO_SYMPTOM_SETS[:5]]
    epicentre_disease = {
        d: outbreak_sets[i % len(outbreak_sets)] for i, d in enumerate(epicentres)
    }

    hotspot_share = 0.7 if epicentres else 0.0
    hotspot_count = int(count * hotspot_share)

    generated = []
    newest_per_tag: dict = {}

    def emit(animal, symptoms, mortality):
        received = now - timedelta(
            days=rng.randint(0, days - 1), hours=rng.randint(0, 23), minutes=rng.randint(0, 59)
        )
        disease, severity = run_syndromic_triage(animal.species, symptoms, mortality)
        report = ReportModel(
            tag_id=animal.pashu_aadhaar,
            species=animal.species,
            symptoms=symptoms,
            mortality_count=mortality,
            # Jitter within roughly a few hundred metres of the registered
            # location so co-located cases form a cluster instead of stacking
            # into a single identical coordinate.
            latitude=round(animal.latitude + rng.uniform(-0.004, 0.004), 6),
            longitude=round(animal.longitude + rng.uniform(-0.004, 0.004), 6),
            village=animal.village,
            district=animal.district,
            state=animal.state,
            reported_by=rng.choice([animal.owner_id, "vet_01", "vet_02"]),
            owner_id=animal.owner_id,
            owner_name=animal.owner_name,
            offline_created_at=received,
            server_received_at=received,
            suspected_disease=disease,
            severity_level=severity,
        )
        generated.append(report)
        current = newest_per_tag.get(animal.pashu_aadhaar)
        if current is None or received > current[0]:
            newest_per_tag[animal.pashu_aadhaar] = (received, report)

    for _ in range(hotspot_count):
        district = rng.choice(epicentres)
        symptoms, mortality = epicentre_disease[district]
        emit(rng.choice(by_district[district]), list(symptoms), mortality)

    for _ in range(count - hotspot_count):
        symptoms, mortality = rng.choice(_DEMO_SYMPTOM_SETS)
        emit(rng.choice(animals), list(symptoms), mortality)

    # Collapse to one active case per animal: every report except the most
    # recent one for a given tag is written as already RESOLVED.
    for report in generated:
        newest = newest_per_tag.get(report.tag_id, (None, None))[1]
        if report is not newest or report.tag_id in existing_active:
            report.severity_level = "RESOLVED"
        db.add(report)

    db.commit()
    return {
        "status": "seeded",
        "reports_created": len(generated),
        "active_cases": sum(1 for r in generated if r.severity_level != "RESOLVED"),
        "epicentres": [{"state": st, "district": dt} for st, dt in epicentres],
        "window_days": days,
    }


@app.get("/api/v1/meta/demo-owners", summary="Demo owner directory (login hints)")
def demo_owners(
    q: Optional[str] = Query(None, description="Filter by owner id, name, district or state"),
    limit: int = Query(25, ge=1, le=300, description="Max owners to return"),
):
    """Public: the demo has no real auth, and the login screen needs to show
    which owner ids have animals in the seeded registry.

    The registry now holds ~250 owners, which is far too many to dump into a
    login hint, so this is searchable and capped. The original demo logins are
    pinned to the top regardless of the filter -- they are the ones the README
    and the walkthrough tell people to use.
    """
    counts = holdings()
    pinned_ids = [o[0] for o in LEGACY_OWNERS]

    def row(owner_id):
        info = DEMO_OWNERS[owner_id]
        return {
            "owner_id": owner_id,
            "name": info["name"],
            "village": info["village"],
            "district": info["district"],
            "state": info["state"],
            "animal_count": counts.get(owner_id, 0),
        }

    pinned = [row(o) for o in pinned_ids if o in DEMO_OWNERS]

    rest = [row(o) for o in DEMO_OWNERS if o not in set(pinned_ids)]
    if q:
        needle = q.strip().lower()
        rest = [
            r for r in rest
            if needle in r["owner_id"].lower()
            or needle in r["name"].lower()
            or needle in (r["district"] or "").lower()
            or needle in (r["state"] or "").lower()
        ]
    rest.sort(key=lambda r: (-r["animal_count"], r["name"]))

    return {
        "pinned": pinned,
        "owners": rest[:limit],
        "total_owners": len(DEMO_OWNERS),
        "matched": len(rest),
    }


@app.get("/api/v1/meta/registry-stats", summary="Registry coverage headline numbers")
def registry_stats(db=Depends(get_db)):
    """Public coverage counts for the dashboard header. No per-animal data, so
    it carries nothing a farmer shouldn't see about anyone else's herd."""
    counts = holdings()
    return {
        "animals": len(LIVESTOCK_REGISTRY),
        "owners": len(DEMO_OWNERS),
        "states": len(STATES_COVERED),
        "districts": len(DISTRICTS_COVERED),
        "largest_holding": max(counts.values()) if counts else 0,
        "max_smallholding": MAX_HOLDING,
        "states_covered": STATES_COVERED,
    }


@app.get("/api/v1/health", summary="Liveness probe")
def health():
    return {"status": "ok", "time": datetime.now(timezone.utc)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
