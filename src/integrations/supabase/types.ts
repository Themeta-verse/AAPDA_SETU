export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

/**
 * Application roles, mirroring the `profiles.role` CHECK constraint in
 * supabase/migrations/20260308175355_9dfc122f-c459-43ed-8fb2-9d7d1e88a2cc.sql.
 *
 * NOTE: this column is for DISPLAY only. Authorization is decided in Postgres
 * by `public.current_app_role()`, which reads the `app_metadata` claim — a
 * column this client cannot write. Never gate security on a client-side read
 * of `profiles.role`; it can drift from the trusted claim.
 */
export type AppRole = 'citizen' | 'responder' | 'admin'

/**
 * `incident_reports.type` CHECK constraint. Anything outside this set is
 * rejected by the database, so the UI must never offer another value.
 */
export type IncidentType = 'flooding' | 'high_waves' | 'blocked_roads' | 'other'

export type ResourceType = 'ambulance' | 'fire_rescue' | 'rescue_team' | 'boat' | 'water_pump' | 'emergency_medical_team' | 'search_rescue_team' | 'emergency_vehicle' | 'shelter_capacity' | 'relief_supply' | 'generator' | 'lighting_tower' | 'communication_equipment' | 'dewatering_pump' | 'other'

export type ResourceStatus = 'available' | 'allocated' | 'deployed' | 'maintenance' | 'unavailable'

export type AllocationStatus = 'pending' | 'approved' | 'rejected' | 'deployed' | 'completed' | 'released'

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      alert_logs: {
        Row: {
          alert_type: string
          created_at: string
          id: string
          message: string
          risk_level: string
          triggered_by: string | null
        }
        Insert: {
          alert_type: string
          created_at?: string
          id?: string
          message?: string
          risk_level: string
          triggered_by?: string | null
        }
        Update: {
          alert_type?: string
          created_at?: string
          id?: string
          message?: string
          risk_level?: string
          triggered_by?: string | null
        }
        Relationships: []
      }
      incident_reports: {
        Row: {
          created_at: string
          description: string
          id: string
          latitude: number | null
          longitude: number | null
          photo_url: string | null
          type: IncidentType
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          photo_url?: string | null
          type: IncidentType
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          photo_url?: string | null
          type?: IncidentType
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          id: string
          latitude: number | null
          longitude: number | null
          name: string
          phone: string | null
          role: AppRole
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          latitude?: number | null
          longitude?: number | null
          name?: string
          phone?: string | null
          role?: AppRole
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          name?: string
          phone?: string | null
          role?: AppRole
          updated_at?: string
        }
        Relationships: []
      }
      emergency_contacts: {
        Row: {
          created_at: string
          id: string
          is_primary: boolean
          name: string
          phone: string
          relationship: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_primary?: boolean
          name: string
          phone: string
          relationship?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_primary?: boolean
          name?: string
          phone?: string
          relationship?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      risk_zones: {
        Row: {
          alert_threshold_km: number
          center_lat: number
          center_lon: number
          created_at: string
          event_types: string[]
          id: string
          is_active: boolean
          name: string
          radius_km: number
          severity_threshold: string
          updated_at: string
        }
        Insert: {
          alert_threshold_km?: number
          center_lat: number
          center_lon: number
          created_at?: string
          event_types?: string[]
          id?: string
          is_active?: boolean
          name: string
          radius_km?: number
          severity_threshold?: string
          updated_at?: string
        }
        Update: {
          alert_threshold_km?: number
          center_lat?: number
          center_lon?: number
          created_at?: string
          event_types?: string[]
          id?: string
          is_active?: boolean
          name?: string
          radius_km?: number
          severity_threshold?: string
          updated_at?: string
        }
        Relationships: []
      }
      sms_alert_log: {
        Row: {
          created_at: string
          event_type: string
          id: string
          message: string
          provider_response: Json | null
          recipients: Json
          severity: string
          sent_at: string
          status: string
          user_id: string
          zone_id: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          message?: string
          provider_response?: Json | null
          recipients?: Json
          severity: string
          sent_at?: string
          status?: string
          user_id: string
          zone_id: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          message?: string
          provider_response?: Json | null
          recipients?: Json
          severity?: string
          sent_at?: string
          status?: string
          user_id?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sms_alert_log_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "risk_zones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_alert_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      resources: {
        Row: {
          allocated_by: string | null
          available_quantity: number
          capacity: number | null
          created_at: string
          created_by: string | null
          id: string
          latitude: number | null
          longitude: number | null
          metadata: Json
          name: string
          quantity: number
          resource_type: string
          status: string
          updated_at: string
          zone_id: string | null
        }
        Insert: {
          allocated_by?: string | null
          available_quantity?: number
          capacity?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          metadata?: Json
          name: string
          quantity?: number
          resource_type: string
          status?: string
          updated_at?: string
          zone_id?: string | null
        }
        Update: {
          allocated_by?: string | null
          available_quantity?: number
          capacity?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          metadata?: Json
          name?: string
          quantity?: number
          resource_type?: string
          status?: string
          updated_at?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resources_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "risk_zones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resources_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      resource_allocations: {
        Row: {
          allocated_at: string
          allocated_by: string | null
          approved_at: string | null
          approved_by: string | null
          completed_at: string | null
          created_at: string
          deployed_at: string | null
          deployed_by: string | null
          id: string
          incident_id: string | null
          metadata: Json
          quantity: number
          released_at: string | null
          rejection_reason: string | null
          resource_id: string
          status: string
          updated_at: string
          zone_id: string | null
        }
        Insert: {
          allocated_at?: string
          allocated_by?: string | null
          approved_at?: string | null
          approved_by?: string | null
          completed_at?: string | null
          created_at?: string
          deployed_at?: string | null
          deployed_by?: string | null
          id?: string
          incident_id?: string | null
          metadata?: Json
          quantity?: number
          released_at?: string | null
          rejection_reason?: string | null
          resource_id: string
          status?: string
          updated_at?: string
          zone_id?: string | null
        }
        Update: {
          allocated_at?: string
          allocated_by?: string | null
          approved_at?: string | null
          approved_by?: string | null
          completed_at?: string | null
          created_at?: string
          deployed_at?: string | null
          deployed_by?: string | null
          id?: string
          incident_id?: string | null
          metadata?: Json
          quantity?: number
          released_at?: string | null
          rejection_reason?: string | null
          resource_id?: string
          status?: string
          updated_at?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resource_allocations_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_allocations_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incident_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_allocations_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "risk_zones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_allocations_allocated_by_fkey"
            columns: ["allocated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_allocations_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_allocations_deployed_by_fkey"
            columns: ["deployed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      resource_incident_compatibility: {
        Row: {
          created_at: string
          id: string
          incident_type: string
          notes: string | null
          priority: number
          resource_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          incident_type: string
          notes?: string | null
          priority?: number
          resource_type: string
        }
        Update: {
          created_at?: string
          id?: string
          incident_type?: string
          notes?: string | null
          priority?: number
          resource_type?: string
        }
        Relationships: []
      }
      resource_audit_logs: {
        Row: {
          action: string
          allocation_id: string | null
          created_at: string
          id: string
          new_status: string | null
          notes: string | null
          performed_by: string | null
          previous_status: string | null
          quantity: number
          resource_id: string
        }
        Insert: {
          action: string
          allocation_id?: string | null
          created_at?: string
          id?: string
          new_status?: string | null
          notes?: string | null
          performed_by?: string | null
          previous_status?: string | null
          quantity?: number
          resource_id: string
        }
        Update: {
          action?: string
          allocation_id?: string | null
          created_at?: string
          id?: string
          new_status?: string | null
          notes?: string | null
          performed_by?: string | null
          previous_status?: string | null
          quantity?: number
          resource_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_audit_logs_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_audit_logs_allocation_id_fkey"
            columns: ["allocation_id"]
            isOneToOne: false
            referencedRelation: "resource_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_audit_logs_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      should_send_alert: {
        Args: {
          p_cooldown_minutes?: number
          p_event_type: string
          p_severity: string
          p_user_id: string
          p_zone_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      resource_type: 'ambulance' | 'fire_rescue' | 'rescue_team' | 'boat' | 'water_pump' | 'emergency_medical_team' | 'search_rescue_team' | 'emergency_vehicle' | 'shelter_capacity' | 'relief_supply' | 'generator' | 'lighting_tower' | 'communication_equipment' | 'dewatering_pump' | 'other'
      resource_status: 'available' | 'allocated' | 'deployed' | 'maintenance' | 'unavailable'
      allocation_status: 'pending' | 'approved' | 'rejected' | 'deployed' | 'completed' | 'released'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
      DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const