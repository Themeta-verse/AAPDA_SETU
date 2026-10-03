-- =====================================================================
-- Migration: 20261001190000_incident_workflow.sql
-- Description: Incident -> Response Operational Workflow
-- Extends incident_reports with verification, clustering, and resolution
-- Creates incident_audit_logs for complete operational provenance
-- =====================================================================

-- 1. Additive columns on incident_reports
ALTER TABLE public.incident_reports
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (status IN ('unverified', 'verified', 'dispatched', 'resolved', 'rejected')),
  ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_notes TEXT,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS cluster_id UUID,
  ADD COLUMN IF NOT EXISTS evidence_status TEXT
    CHECK (evidence_status IN ('SUFFICIENT', 'PARTIAL', 'INSUFFICIENT')),
  ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolution_notes TEXT;

-- Indexes for operational querying
CREATE INDEX IF NOT EXISTS idx_incident_reports_status ON public.incident_reports (status);
CREATE INDEX IF NOT EXISTS idx_incident_reports_cluster_id ON public.incident_reports (cluster_id);
CREATE INDEX IF NOT EXISTS idx_incident_reports_created_at ON public.incident_reports (created_at DESC);

-- 2. Operational UPDATE policy for responders & admins
-- Citizens remain append-only (cannot mutate status or evidence)
CREATE POLICY "Responders can update operational incident reports" ON public.incident_reports
  FOR UPDATE TO authenticated
  USING (public.is_responder())
  WITH CHECK (public.is_responder());

-- 3. Incident Audit Logs Table
CREATE TABLE IF NOT EXISTS public.incident_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID REFERENCES public.incident_reports(id) ON DELETE CASCADE NOT NULL,
  performed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.incident_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Responders can read incident audit logs" ON public.incident_audit_logs
  FOR SELECT TO authenticated
  USING (public.is_responder());

CREATE POLICY "Responders can insert incident audit logs" ON public.incident_audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (public.is_responder());

CREATE INDEX IF NOT EXISTS idx_incident_audit_logs_incident ON public.incident_audit_logs (incident_id);
CREATE INDEX IF NOT EXISTS idx_incident_audit_logs_created_at ON public.incident_audit_logs (created_at DESC);
