from __future__ import annotations
from datetime import date, datetime, timezone
from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Firm(Base):
    __tablename__ = "firms"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class UserProfile(Base):
    __tablename__ = "profiles"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    auth_user_id: Mapped[str | None] = mapped_column(String(100), unique=True, nullable=True, index=True)
    firm_id: Mapped[str] = mapped_column(ForeignKey("firms.id"), index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    full_name: Mapped[str] = mapped_column(String(150), nullable=False)
    role: Mapped[str] = mapped_column(String(30), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    firm_id: Mapped[str] = mapped_column(ForeignKey("firms.id"), index=True)
    code: Mapped[str] = mapped_column(String(30), unique=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    client_name: Mapped[str] = mapped_column(String(200), nullable=False)
    client_email: Mapped[str] = mapped_column(String(255), nullable=False)
    project_manager: Mapped[str] = mapped_column(String(150), nullable=False)
    assigned_subcontractor_email: Mapped[str] = mapped_column(String(255), nullable=False)
    location: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="In progress")
    stage: Mapped[str] = mapped_column(String(60), default="Construction")
    budget: Mapped[float] = mapped_column(Float, nullable=False)
    actual_cost: Mapped[float] = mapped_column(Float, nullable=False)
    committed_costs: Mapped[float] = mapped_column(Float, default=0)
    progress_pct: Mapped[float] = mapped_column(Float, default=0)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    target_completion: Mapped[date] = mapped_column(Date, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    milestones: Mapped[list["Milestone"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    invoices: Mapped[list["Invoice"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    snapshots: Mapped[list["ProjectSnapshot"]] = relationship(back_populates="project", cascade="all, delete-orphan")


class Invoice(Base):
    __tablename__ = "invoices"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    firm_id: Mapped[str] = mapped_column(ForeignKey("firms.id"), index=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    invoice_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    invoice_type: Mapped[str] = mapped_column(String(40), default="client_invoice")
    recipient_name: Mapped[str] = mapped_column(String(200), nullable=False)
    recipient_email: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), default="CAD")
    issued_date: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="SENT")
    paypal_invoice_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    paypal_view_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    reminders_sent: Mapped[int] = mapped_column(Integer, default=0)
    last_reminded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    project: Mapped[Project] = relationship(back_populates="invoices")


class Milestone(Base):
    __tablename__ = "milestones"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    firm_id: Mapped[str] = mapped_column(ForeignKey("firms.id"), index=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    planned_date: Mapped[date] = mapped_column(Date, nullable=False)
    actual_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    progress_pct: Mapped[float] = mapped_column(Float, default=0)
    status: Mapped[str] = mapped_column(String(30), default="Upcoming")
    project: Mapped[Project] = relationship(back_populates="milestones")


class ProjectSnapshot(Base):
    __tablename__ = "project_snapshots"
    __table_args__ = (UniqueConstraint("project_id", "snapshot_date", name="uq_project_snapshot_date"),)
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    firm_id: Mapped[str] = mapped_column(ForeignKey("firms.id"), index=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    snapshot_date: Mapped[date] = mapped_column(Date, nullable=False)
    actual_cost: Mapped[float] = mapped_column(Float, nullable=False)
    progress_pct: Mapped[float] = mapped_column(Float, nullable=False)
    planned_progress_pct: Mapped[float] = mapped_column(Float, nullable=False)
    committed_costs: Mapped[float] = mapped_column(Float, default=0)
    project: Mapped[Project] = relationship(back_populates="snapshots")


class PaymentEvent(Base):
    __tablename__ = "payment_events"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    firm_id: Mapped[str] = mapped_column(ForeignKey("firms.id"), index=True)
    invoice_id: Mapped[str | None] = mapped_column(ForeignKey("invoices.id"), nullable=True, index=True)
    paypal_event_id: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    event_type: Mapped[str] = mapped_column(String(120), nullable=False)
    payload_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
