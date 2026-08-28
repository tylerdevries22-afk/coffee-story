export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
<<<<<<< ours
=======
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17"
  }
  app: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      annual_points_for: { Args: { target_account: string }; Returns: number }
      at_location: {
        Args: { target_brand: string; target_location: string }
        Returns: boolean
      }
      board_ticket_rows: {
        Args: never
        Returns: {
          arrived_at: string
          brand_id: string
          channel: Database["app"]["Enums"]["order_channel"]
          daily_number: number
          fulfillment_type: Database["app"]["Enums"]["fulfillment_type"]
          guest_label: string
          id: string
          location_id: string
          loyalty_tier: string
          status: Database["app"]["Enums"]["order_status"]
          updated_at: string
        }[]
      }
      brand_storefront_rows: {
        Args: never
        Returns: {
          brand_config: Json
          catering: boolean
          delivery: boolean
          drops: boolean
          id: string
          multi_location: boolean
          name: string
          operations: boolean
          referrals: boolean
          slug: string
          sms: boolean
          stored_value: boolean
        }[]
      }
      calendar_row_visible: {
        Args: { target_brand: string; target_location: string }
        Returns: boolean
      }
      can_read_board: {
        Args: { target_brand: string; target_location: string }
        Returns: boolean
      }
      custom_access_token: { Args: { event: Json }; Returns: Json }
      customer_ordered_at: {
        Args: { customer: string; locs: string[] }
        Returns: boolean
      }
      device_is_active: {
        Args: { wanted_role: Database["app"]["Enums"]["device_role"] }
        Returns: boolean
      }
      drop_visibility: {
        Args: {
          at_time?: string
          d: Database["public"]["Tables"]["drops"]["Row"]
        }
        Returns: string
      }
      is_brand_manager: { Args: { target_brand: string }; Returns: boolean }
      is_brand_owner: { Args: { target_brand: string }; Returns: boolean }
      is_brand_staff: { Args: { target_brand: string }; Returns: boolean }
      is_current_brand_user: {
        Args: { target_brand: string; target_brand_user: string }
        Returns: boolean
      }
      is_device_at: {
        Args: { target_brand: string; target_location: string }
        Returns: boolean
      }
      is_owned_channel: {
        Args: { channel: Database["app"]["Enums"]["order_channel"] }
        Returns: boolean
      }
      is_platform_admin: { Args: never; Returns: boolean }
      jwt_brand_id: { Args: never; Returns: string }
      jwt_claims: { Args: never; Returns: Json }
      jwt_device_id: { Args: never; Returns: string }
      jwt_device_location: { Args: never; Returns: string }
      jwt_device_role: { Args: never; Returns: string }
      jwt_location_ids: { Args: never; Returns: string[] }
      jwt_role: { Args: never; Returns: string }
      location_square_status_rows: {
        Args: never
        Returns: {
          brand_id: string
          expires_at: string
          location_id: string
          merchant_id: string
        }[]
      }
      loyalty_tier_for: {
        Args: { target_brand: string; target_customer: string }
        Returns: string
      }
      manages_location: {
        Args: { target_brand: string; target_location: string }
        Returns: boolean
      }
      mark_order_arrived: { Args: { target_order: string }; Returns: string }
      order_transition_allowed: {
        Args: {
          from_status: Database["app"]["Enums"]["order_status"]
          to_status: Database["app"]["Enums"]["order_status"]
        }
        Returns: boolean
      }
      pack_choices: {
        Args: {
          at_time?: string
          pack: Database["public"]["Tables"]["menu_items"]["Row"]
        }
        Returns: Database["public"]["Tables"]["menu_items"]["Row"][]
        SetofOptions: {
          from: "*"
          to: "menu_items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      pack_saving_bps: {
        Args: { item: Database["public"]["Tables"]["menu_items"]["Row"] }
        Returns: number
      }
      set_brand_kiosk_config: {
        Args: { config: Json; expected_updated_at?: string }
        Returns: string
      }
      valid_slug_set: { Args: { p_values: string[] }; Returns: boolean }
    }
    Enums: {
      brand_role:
        | "platform_admin"
        | "brand_owner"
        | "location_manager"
        | "staff"
      campaign_channel: "push" | "sms" | "email"
      device_role: "kiosk" | "pos" | "display" | "prep"
      fulfillment_type: "pickup" | "curbside" | "catering" | "delivery"
      item_rotation: "permanent" | "rotating" | "day_specific"
      order_channel: "app" | "web" | "kiosk" | "pos"
      order_status:
        | "created"
        | "paid"
        | "in_progress"
        | "ready"
        | "picked_up"
        | "cancelled"
        | "refunded"
      operation_occurrence_status:
        | "upcoming"
        | "due"
        | "claimed"
        | "completed"
        | "overdue"
        | "waived"
        | "cancelled"
      prep_status: "pending" | "in_progress" | "done" | "abandoned"
      task_recurrence: "opening" | "closing" | "daily" | "weekly"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
>>>>>>> theirs
  public: {
    Tables: {
      analytics_consent_records: {
        Row: {
          actor_hash: string
          brand_id: string
          consent_state: string
          created_at: string
          effective_at: string
          expires_at: string | null
          id: string
          policy_version: string
          source: string
          surface: string
        }
        Insert: {
          actor_hash: string
          brand_id: string
          consent_state: string
          created_at?: string
          effective_at: string
          expires_at?: string | null
          id?: string
          policy_version: string
          source: string
          surface: string
        }
        Update: {
          actor_hash?: string
          brand_id?: string
          consent_state?: string
          created_at?: string
          effective_at?: string
          expires_at?: string | null
          id?: string
          policy_version?: string
          source?: string
          surface?: string
        }
        Relationships: [
          {
            foreignKeyName: "analytics_consent_records_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_daily_rollups: {
        Row: {
          brand_id: string
          computed_at: string
          day: string
          dimensions: Json
          dimensions_key: string
          duration_p50_ms: number | null
          duration_p95_ms: number | null
          event_count: number
          failure_count: number
          id: string
          location_id: string | null
          metric_key: string
          success_count: number
          surface: string
          total_value: number
          unique_actors: number
        }
        Insert: {
          brand_id: string
          computed_at?: string
          day: string
          dimensions?: Json
          dimensions_key?: string
          duration_p50_ms?: number | null
          duration_p95_ms?: number | null
          event_count?: number
          failure_count?: number
          id?: string
          location_id?: string | null
          metric_key: string
          success_count?: number
          surface: string
          total_value?: number
          unique_actors?: number
        }
        Update: {
          brand_id?: string
          computed_at?: string
          day?: string
          dimensions?: Json
          dimensions_key?: string
          duration_p50_ms?: number | null
          duration_p95_ms?: number | null
          event_count?: number
          failure_count?: number
          id?: string
          location_id?: string | null
          metric_key?: string
          success_count?: number
          surface?: string
          total_value?: number
          unique_actors?: number
        }
        Relationships: [
          {
            foreignKeyName: "analytics_daily_rollups_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_daily_rollups_location_id_brand_id_fkey"
            columns: ["location_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id", "brand_id"]
          },
        ]
      }
      analytics_event_catalog: {
        Row: {
          allowed_surfaces: string[]
          brand_id: string | null
          created_at: string
          data_classification: string
          description: string
          display_name: string
          event_key: string
          id: string
          is_active: boolean
          property_schema: Json
          purpose: string
          schema_version: number
          updated_at: string
        }
        Insert: {
          allowed_surfaces?: string[]
          brand_id?: string | null
          created_at?: string
          data_classification?: string
          description?: string
          display_name: string
          event_key: string
          id?: string
          is_active?: boolean
          property_schema?: Json
          purpose: string
          schema_version?: number
          updated_at?: string
        }
        Update: {
          allowed_surfaces?: string[]
          brand_id?: string | null
          created_at?: string
          data_classification?: string
          description?: string
          display_name?: string
          event_key?: string
          id?: string
          is_active?: boolean
          property_schema?: Json
          purpose?: string
          schema_version?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "analytics_event_catalog_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_events: {
        Row: {
          actor_hash: string | null
          app_version: string
          brand_id: string
          build_version: string
          client_event_id: string
          consent_basis: string
          duration_ms: number | null
          event_key: string
          event_version: number
          flow_key: string | null
          id: string
          location_id: string | null
          metric_key: string | null
          occurred_at: string
          outcome: string | null
          properties: Json
          received_at: string
          session_hash: string
          step_key: string | null
          surface: string
        }
        Insert: {
          actor_hash?: string | null
          app_version?: string
          brand_id: string
          build_version?: string
          client_event_id: string
          consent_basis: string
          duration_ms?: number | null
          event_key: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash: string
          step_key?: string | null
          surface: string
        }
        Update: {
          actor_hash?: string | null
          app_version?: string
          brand_id?: string
          build_version?: string
          client_event_id?: string
          consent_basis?: string
          duration_ms?: number | null
          event_key?: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at?: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash?: string
          step_key?: string | null
          surface?: string
        }
        Relationships: [
          {
            foreignKeyName: "analytics_events_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_events_location_id_brand_id_fkey"
            columns: ["location_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id", "brand_id"]
          },
        ]
      }
      analytics_events_202605: {
        Row: {
          actor_hash: string | null
          app_version: string
          brand_id: string
          build_version: string
          client_event_id: string
          consent_basis: string
          duration_ms: number | null
          event_key: string
          event_version: number
          flow_key: string | null
          id: string
<<<<<<< ours
          location_id: string | null
          metric_key: string | null
          occurred_at: string
          outcome: string | null
          properties: Json
          received_at: string
          session_hash: string
          step_key: string | null
          surface: string
=======
          multi_location: boolean
          name: string
          operations?: boolean
          referrals: boolean
          slug: string
          sms: boolean
          stored_value: boolean
          tier_threshold_cents: number
          updated_at: string
>>>>>>> theirs
        }
        Insert: {
          actor_hash?: string | null
          app_version?: string
          brand_id: string
          build_version?: string
          client_event_id: string
          consent_basis: string
          duration_ms?: number | null
          event_key: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash: string
          step_key?: string | null
          surface: string
        }
        Update: {
          actor_hash?: string | null
          app_version?: string
          brand_id?: string
          build_version?: string
          client_event_id?: string
          consent_basis?: string
          duration_ms?: number | null
          event_key?: string
          event_version?: number
          flow_key?: string | null
          id?: string
<<<<<<< ours
          location_id?: string | null
          metric_key?: string | null
          occurred_at?: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash?: string
          step_key?: string | null
          surface?: string
=======
          multi_location?: boolean
          name?: string
          operations?: boolean
          referrals?: boolean
          slug?: string
          sms?: boolean
          stored_value?: boolean
          tier_threshold_cents?: number
          updated_at?: string
>>>>>>> theirs
        }
        Relationships: []
      }
      analytics_events_202606: {
        Row: {
          actor_hash: string | null
          app_version: string
          brand_id: string
          build_version: string
          client_event_id: string
          consent_basis: string
          duration_ms: number | null
          event_key: string
          event_version: number
          flow_key: string | null
          id: string
          location_id: string | null
          metric_key: string | null
          occurred_at: string
          outcome: string | null
          properties: Json
          received_at: string
          session_hash: string
          step_key: string | null
          surface: string
        }
        Insert: {
          actor_hash?: string | null
          app_version?: string
          brand_id: string
          build_version?: string
          client_event_id: string
          consent_basis: string
          duration_ms?: number | null
          event_key: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash: string
          step_key?: string | null
          surface: string
        }
        Update: {
          actor_hash?: string | null
          app_version?: string
          brand_id?: string
          build_version?: string
          client_event_id?: string
          consent_basis?: string
          duration_ms?: number | null
          event_key?: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at?: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash?: string
          step_key?: string | null
          surface?: string
        }
        Relationships: []
      }
      analytics_events_202607: {
        Row: {
          actor_hash: string | null
          app_version: string
          brand_id: string
          build_version: string
          client_event_id: string
          consent_basis: string
          duration_ms: number | null
          event_key: string
          event_version: number
          flow_key: string | null
          id: string
          location_id: string | null
          metric_key: string | null
          occurred_at: string
          outcome: string | null
          properties: Json
          received_at: string
          session_hash: string
          step_key: string | null
          surface: string
        }
        Insert: {
          actor_hash?: string | null
          app_version?: string
          brand_id: string
          build_version?: string
          client_event_id: string
          consent_basis: string
          duration_ms?: number | null
          event_key: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash: string
          step_key?: string | null
          surface: string
        }
        Update: {
          actor_hash?: string | null
          app_version?: string
          brand_id?: string
          build_version?: string
          client_event_id?: string
          consent_basis?: string
          duration_ms?: number | null
          event_key?: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at?: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash?: string
          step_key?: string | null
          surface?: string
        }
        Relationships: []
      }
      analytics_events_202608: {
        Row: {
          actor_hash: string | null
          app_version: string
          brand_id: string
          build_version: string
          client_event_id: string
          consent_basis: string
          duration_ms: number | null
          event_key: string
          event_version: number
          flow_key: string | null
          id: string
          location_id: string | null
          metric_key: string | null
          occurred_at: string
          outcome: string | null
          properties: Json
          received_at: string
          session_hash: string
          step_key: string | null
          surface: string
        }
        Insert: {
          actor_hash?: string | null
          app_version?: string
          brand_id: string
          build_version?: string
          client_event_id: string
          consent_basis: string
          duration_ms?: number | null
          event_key: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash: string
          step_key?: string | null
          surface: string
        }
        Update: {
          actor_hash?: string | null
          app_version?: string
          brand_id?: string
          build_version?: string
          client_event_id?: string
          consent_basis?: string
          duration_ms?: number | null
          event_key?: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at?: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash?: string
          step_key?: string | null
          surface?: string
        }
        Relationships: []
      }
      analytics_events_202609: {
        Row: {
          actor_hash: string | null
          app_version: string
          brand_id: string
          build_version: string
          client_event_id: string
          consent_basis: string
          duration_ms: number | null
          event_key: string
          event_version: number
          flow_key: string | null
          id: string
          location_id: string | null
          metric_key: string | null
          occurred_at: string
          outcome: string | null
          properties: Json
          received_at: string
          session_hash: string
          step_key: string | null
          surface: string
        }
        Insert: {
          actor_hash?: string | null
          app_version?: string
          brand_id: string
          build_version?: string
          client_event_id: string
          consent_basis: string
          duration_ms?: number | null
          event_key: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash: string
          step_key?: string | null
          surface: string
        }
        Update: {
          actor_hash?: string | null
          app_version?: string
          brand_id?: string
          build_version?: string
          client_event_id?: string
          consent_basis?: string
          duration_ms?: number | null
          event_key?: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at?: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash?: string
          step_key?: string | null
          surface?: string
        }
        Relationships: []
      }
      analytics_events_202610: {
        Row: {
          actor_hash: string | null
          app_version: string
          brand_id: string
          build_version: string
          client_event_id: string
          consent_basis: string
          duration_ms: number | null
          event_key: string
          event_version: number
          flow_key: string | null
          id: string
          location_id: string | null
          metric_key: string | null
          occurred_at: string
          outcome: string | null
          properties: Json
          received_at: string
          session_hash: string
          step_key: string | null
          surface: string
        }
        Insert: {
          actor_hash?: string | null
          app_version?: string
          brand_id: string
          build_version?: string
          client_event_id: string
          consent_basis: string
          duration_ms?: number | null
          event_key: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash: string
          step_key?: string | null
          surface: string
        }
        Update: {
          actor_hash?: string | null
          app_version?: string
          brand_id?: string
          build_version?: string
          client_event_id?: string
          consent_basis?: string
          duration_ms?: number | null
          event_key?: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at?: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash?: string
          step_key?: string | null
          surface?: string
        }
        Relationships: []
      }
      analytics_events_202611: {
        Row: {
          actor_hash: string | null
          app_version: string
          brand_id: string
          build_version: string
          client_event_id: string
          consent_basis: string
          duration_ms: number | null
          event_key: string
          event_version: number
          flow_key: string | null
          id: string
          location_id: string | null
          metric_key: string | null
          occurred_at: string
          outcome: string | null
          properties: Json
          received_at: string
          session_hash: string
          step_key: string | null
          surface: string
        }
        Insert: {
          actor_hash?: string | null
          app_version?: string
          brand_id: string
          build_version?: string
          client_event_id: string
          consent_basis: string
          duration_ms?: number | null
          event_key: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash: string
          step_key?: string | null
          surface: string
        }
        Update: {
          actor_hash?: string | null
          app_version?: string
          brand_id?: string
          build_version?: string
          client_event_id?: string
          consent_basis?: string
          duration_ms?: number | null
          event_key?: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at?: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash?: string
          step_key?: string | null
          surface?: string
        }
        Relationships: []
      }
      analytics_events_202612: {
        Row: {
          actor_hash: string | null
          app_version: string
          brand_id: string
          build_version: string
          client_event_id: string
          consent_basis: string
          duration_ms: number | null
          event_key: string
          event_version: number
          flow_key: string | null
          id: string
          location_id: string | null
          metric_key: string | null
          occurred_at: string
          outcome: string | null
          properties: Json
          received_at: string
          session_hash: string
          step_key: string | null
          surface: string
        }
        Insert: {
          actor_hash?: string | null
          app_version?: string
          brand_id: string
          build_version?: string
          client_event_id: string
          consent_basis: string
          duration_ms?: number | null
          event_key: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash: string
          step_key?: string | null
          surface: string
        }
        Update: {
          actor_hash?: string | null
          app_version?: string
          brand_id?: string
          build_version?: string
          client_event_id?: string
          consent_basis?: string
          duration_ms?: number | null
          event_key?: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at?: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash?: string
          step_key?: string | null
          surface?: string
        }
        Relationships: []
      }
      analytics_events_202701: {
        Row: {
          actor_hash: string | null
          app_version: string
          brand_id: string
          build_version: string
          client_event_id: string
          consent_basis: string
          duration_ms: number | null
          event_key: string
          event_version: number
          flow_key: string | null
          id: string
          location_id: string | null
          metric_key: string | null
          occurred_at: string
          outcome: string | null
          properties: Json
          received_at: string
          session_hash: string
          step_key: string | null
          surface: string
        }
        Insert: {
          actor_hash?: string | null
          app_version?: string
          brand_id: string
          build_version?: string
          client_event_id: string
          consent_basis: string
          duration_ms?: number | null
          event_key: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash: string
          step_key?: string | null
          surface: string
        }
        Update: {
          actor_hash?: string | null
          app_version?: string
          brand_id?: string
          build_version?: string
          client_event_id?: string
          consent_basis?: string
          duration_ms?: number | null
          event_key?: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at?: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash?: string
          step_key?: string | null
          surface?: string
        }
        Relationships: []
      }
      analytics_events_202702: {
        Row: {
          actor_hash: string | null
          app_version: string
          brand_id: string
          build_version: string
          client_event_id: string
          consent_basis: string
          duration_ms: number | null
          event_key: string
          event_version: number
          flow_key: string | null
          id: string
          location_id: string | null
          metric_key: string | null
          occurred_at: string
          outcome: string | null
          properties: Json
          received_at: string
          session_hash: string
          step_key: string | null
          surface: string
        }
        Insert: {
          actor_hash?: string | null
          app_version?: string
          brand_id: string
          build_version?: string
          client_event_id: string
          consent_basis: string
          duration_ms?: number | null
          event_key: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash: string
          step_key?: string | null
          surface: string
        }
        Update: {
          actor_hash?: string | null
          app_version?: string
          brand_id?: string
          build_version?: string
          client_event_id?: string
          consent_basis?: string
          duration_ms?: number | null
          event_key?: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at?: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash?: string
          step_key?: string | null
          surface?: string
        }
        Relationships: []
      }
      analytics_events_202703: {
        Row: {
          actor_hash: string | null
          app_version: string
          brand_id: string
          build_version: string
          client_event_id: string
          consent_basis: string
          duration_ms: number | null
          event_key: string
          event_version: number
          flow_key: string | null
          id: string
          location_id: string | null
          metric_key: string | null
          occurred_at: string
          outcome: string | null
          properties: Json
          received_at: string
          session_hash: string
          step_key: string | null
          surface: string
        }
        Insert: {
          actor_hash?: string | null
          app_version?: string
          brand_id: string
          build_version?: string
          client_event_id: string
          consent_basis: string
          duration_ms?: number | null
          event_key: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash: string
          step_key?: string | null
          surface: string
        }
        Update: {
          actor_hash?: string | null
          app_version?: string
          brand_id?: string
          build_version?: string
          client_event_id?: string
          consent_basis?: string
          duration_ms?: number | null
          event_key?: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at?: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash?: string
          step_key?: string | null
          surface?: string
        }
        Relationships: []
      }
      analytics_events_202704: {
        Row: {
          actor_hash: string | null
          app_version: string
          brand_id: string
          build_version: string
          client_event_id: string
          consent_basis: string
          duration_ms: number | null
          event_key: string
          event_version: number
          flow_key: string | null
          id: string
          location_id: string | null
          metric_key: string | null
          occurred_at: string
          outcome: string | null
          properties: Json
          received_at: string
          session_hash: string
          step_key: string | null
          surface: string
        }
        Insert: {
          actor_hash?: string | null
          app_version?: string
          brand_id: string
          build_version?: string
          client_event_id: string
          consent_basis: string
          duration_ms?: number | null
          event_key: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash: string
          step_key?: string | null
          surface: string
        }
        Update: {
          actor_hash?: string | null
          app_version?: string
          brand_id?: string
          build_version?: string
          client_event_id?: string
          consent_basis?: string
          duration_ms?: number | null
          event_key?: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at?: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash?: string
          step_key?: string | null
          surface?: string
        }
        Relationships: []
      }
      analytics_events_202705: {
        Row: {
          actor_hash: string | null
          app_version: string
          brand_id: string
          build_version: string
          client_event_id: string
          consent_basis: string
          duration_ms: number | null
          event_key: string
          event_version: number
          flow_key: string | null
          id: string
          location_id: string | null
          metric_key: string | null
          occurred_at: string
          outcome: string | null
          properties: Json
          received_at: string
          session_hash: string
          step_key: string | null
          surface: string
        }
        Insert: {
          actor_hash?: string | null
          app_version?: string
          brand_id: string
          build_version?: string
          client_event_id: string
          consent_basis: string
          duration_ms?: number | null
          event_key: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash: string
          step_key?: string | null
          surface: string
        }
        Update: {
          actor_hash?: string | null
          app_version?: string
          brand_id?: string
          build_version?: string
          client_event_id?: string
          consent_basis?: string
          duration_ms?: number | null
          event_key?: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at?: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash?: string
          step_key?: string | null
          surface?: string
        }
        Relationships: []
      }
      analytics_events_202706: {
        Row: {
          actor_hash: string | null
          app_version: string
          brand_id: string
          build_version: string
          client_event_id: string
          consent_basis: string
          duration_ms: number | null
          event_key: string
          event_version: number
          flow_key: string | null
          id: string
          location_id: string | null
          metric_key: string | null
          occurred_at: string
          outcome: string | null
          properties: Json
          received_at: string
          session_hash: string
          step_key: string | null
          surface: string
        }
        Insert: {
          actor_hash?: string | null
          app_version?: string
          brand_id: string
          build_version?: string
          client_event_id: string
          consent_basis: string
          duration_ms?: number | null
          event_key: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash: string
          step_key?: string | null
          surface: string
        }
        Update: {
          actor_hash?: string | null
          app_version?: string
          brand_id?: string
          build_version?: string
          client_event_id?: string
          consent_basis?: string
          duration_ms?: number | null
          event_key?: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at?: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash?: string
          step_key?: string | null
          surface?: string
        }
        Relationships: []
      }
      analytics_events_202707: {
        Row: {
          actor_hash: string | null
          app_version: string
          brand_id: string
          build_version: string
          client_event_id: string
          consent_basis: string
          duration_ms: number | null
          event_key: string
          event_version: number
          flow_key: string | null
          id: string
          location_id: string | null
          metric_key: string | null
          occurred_at: string
          outcome: string | null
          properties: Json
          received_at: string
          session_hash: string
          step_key: string | null
          surface: string
        }
        Insert: {
          actor_hash?: string | null
          app_version?: string
          brand_id: string
          build_version?: string
          client_event_id: string
          consent_basis: string
          duration_ms?: number | null
          event_key: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash: string
          step_key?: string | null
          surface: string
        }
        Update: {
          actor_hash?: string | null
          app_version?: string
          brand_id?: string
          build_version?: string
          client_event_id?: string
          consent_basis?: string
          duration_ms?: number | null
          event_key?: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at?: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash?: string
          step_key?: string | null
          surface?: string
        }
        Relationships: []
      }
      analytics_events_202708: {
        Row: {
          actor_hash: string | null
          app_version: string
          brand_id: string
          build_version: string
          client_event_id: string
          consent_basis: string
          duration_ms: number | null
          event_key: string
          event_version: number
          flow_key: string | null
          id: string
          location_id: string | null
          metric_key: string | null
          occurred_at: string
          outcome: string | null
          properties: Json
          received_at: string
          session_hash: string
          step_key: string | null
          surface: string
        }
        Insert: {
          actor_hash?: string | null
          app_version?: string
          brand_id: string
          build_version?: string
          client_event_id: string
          consent_basis: string
          duration_ms?: number | null
          event_key: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash: string
          step_key?: string | null
          surface: string
        }
        Update: {
          actor_hash?: string | null
          app_version?: string
          brand_id?: string
          build_version?: string
          client_event_id?: string
          consent_basis?: string
          duration_ms?: number | null
          event_key?: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at?: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash?: string
          step_key?: string | null
          surface?: string
        }
        Relationships: []
      }
      analytics_events_202709: {
        Row: {
          actor_hash: string | null
          app_version: string
          brand_id: string
          build_version: string
          client_event_id: string
          consent_basis: string
          duration_ms: number | null
          event_key: string
          event_version: number
          flow_key: string | null
          id: string
          location_id: string | null
          metric_key: string | null
          occurred_at: string
          outcome: string | null
          properties: Json
          received_at: string
          session_hash: string
          step_key: string | null
          surface: string
        }
        Insert: {
          actor_hash?: string | null
          app_version?: string
          brand_id: string
          build_version?: string
          client_event_id: string
          consent_basis: string
          duration_ms?: number | null
          event_key: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash: string
          step_key?: string | null
          surface: string
        }
        Update: {
          actor_hash?: string | null
          app_version?: string
          brand_id?: string
          build_version?: string
          client_event_id?: string
          consent_basis?: string
          duration_ms?: number | null
          event_key?: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at?: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash?: string
          step_key?: string | null
          surface?: string
        }
        Relationships: []
      }
      analytics_events_202710: {
        Row: {
          actor_hash: string | null
          app_version: string
          brand_id: string
          build_version: string
          client_event_id: string
          consent_basis: string
          duration_ms: number | null
          event_key: string
          event_version: number
          flow_key: string | null
          id: string
          location_id: string | null
          metric_key: string | null
          occurred_at: string
          outcome: string | null
          properties: Json
          received_at: string
          session_hash: string
          step_key: string | null
          surface: string
        }
        Insert: {
          actor_hash?: string | null
          app_version?: string
          brand_id: string
          build_version?: string
          client_event_id: string
          consent_basis: string
          duration_ms?: number | null
          event_key: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash: string
          step_key?: string | null
          surface: string
        }
        Update: {
          actor_hash?: string | null
          app_version?: string
          brand_id?: string
          build_version?: string
          client_event_id?: string
          consent_basis?: string
          duration_ms?: number | null
          event_key?: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at?: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash?: string
          step_key?: string | null
          surface?: string
        }
        Relationships: []
      }
      analytics_events_202711: {
        Row: {
          actor_hash: string | null
          app_version: string
          brand_id: string
          build_version: string
          client_event_id: string
          consent_basis: string
          duration_ms: number | null
          event_key: string
          event_version: number
          flow_key: string | null
          id: string
          location_id: string | null
          metric_key: string | null
          occurred_at: string
          outcome: string | null
          properties: Json
          received_at: string
          session_hash: string
          step_key: string | null
          surface: string
        }
        Insert: {
          actor_hash?: string | null
          app_version?: string
          brand_id: string
          build_version?: string
          client_event_id: string
          consent_basis: string
          duration_ms?: number | null
          event_key: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash: string
          step_key?: string | null
          surface: string
        }
        Update: {
          actor_hash?: string | null
          app_version?: string
          brand_id?: string
          build_version?: string
          client_event_id?: string
          consent_basis?: string
          duration_ms?: number | null
          event_key?: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at?: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash?: string
          step_key?: string | null
          surface?: string
        }
        Relationships: []
      }
      analytics_events_202712: {
        Row: {
          actor_hash: string | null
          app_version: string
          brand_id: string
          build_version: string
          client_event_id: string
          consent_basis: string
          duration_ms: number | null
          event_key: string
          event_version: number
          flow_key: string | null
          id: string
          location_id: string | null
          metric_key: string | null
          occurred_at: string
          outcome: string | null
          properties: Json
          received_at: string
          session_hash: string
          step_key: string | null
          surface: string
        }
        Insert: {
          actor_hash?: string | null
          app_version?: string
          brand_id: string
          build_version?: string
          client_event_id: string
          consent_basis: string
          duration_ms?: number | null
          event_key: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash: string
          step_key?: string | null
          surface: string
        }
        Update: {
          actor_hash?: string | null
          app_version?: string
          brand_id?: string
          build_version?: string
          client_event_id?: string
          consent_basis?: string
          duration_ms?: number | null
          event_key?: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at?: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash?: string
          step_key?: string | null
          surface?: string
        }
        Relationships: []
      }
      analytics_events_202801: {
        Row: {
          actor_hash: string | null
          app_version: string
          brand_id: string
          build_version: string
          client_event_id: string
          consent_basis: string
          duration_ms: number | null
          event_key: string
          event_version: number
          flow_key: string | null
          id: string
          location_id: string | null
          metric_key: string | null
          occurred_at: string
          outcome: string | null
          properties: Json
          received_at: string
          session_hash: string
          step_key: string | null
          surface: string
        }
        Insert: {
          actor_hash?: string | null
          app_version?: string
          brand_id: string
          build_version?: string
          client_event_id: string
          consent_basis: string
          duration_ms?: number | null
          event_key: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash: string
          step_key?: string | null
          surface: string
        }
        Update: {
          actor_hash?: string | null
          app_version?: string
          brand_id?: string
          build_version?: string
          client_event_id?: string
          consent_basis?: string
          duration_ms?: number | null
          event_key?: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at?: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash?: string
          step_key?: string | null
          surface?: string
        }
        Relationships: []
      }
      analytics_events_202802: {
        Row: {
          actor_hash: string | null
          app_version: string
          brand_id: string
          build_version: string
          client_event_id: string
          consent_basis: string
          duration_ms: number | null
          event_key: string
          event_version: number
          flow_key: string | null
          id: string
          location_id: string | null
          metric_key: string | null
          occurred_at: string
          outcome: string | null
          properties: Json
          received_at: string
          session_hash: string
          step_key: string | null
          surface: string
        }
        Insert: {
          actor_hash?: string | null
          app_version?: string
          brand_id: string
          build_version?: string
          client_event_id: string
          consent_basis: string
          duration_ms?: number | null
          event_key: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash: string
          step_key?: string | null
          surface: string
        }
        Update: {
          actor_hash?: string | null
          app_version?: string
          brand_id?: string
          build_version?: string
          client_event_id?: string
          consent_basis?: string
          duration_ms?: number | null
          event_key?: string
          event_version?: number
          flow_key?: string | null
          id?: string
          location_id?: string | null
          metric_key?: string | null
          occurred_at?: string
          outcome?: string | null
          properties?: Json
          received_at?: string
          session_hash?: string
          step_key?: string | null
          surface?: string
        }
        Relationships: []
      }
      analytics_funnel_definitions: {
        Row: {
          brand_id: string
          created_at: string
          created_by: string | null
          description: string
          funnel_key: string
          id: string
          is_active: boolean
          name: string
          steps: Json
          surfaces: string[]
          updated_at: string
          version: number
        }
        Insert: {
          brand_id: string
          created_at?: string
          created_by?: string | null
          description?: string
          funnel_key: string
          id?: string
          is_active?: boolean
          name: string
          steps: Json
          surfaces?: string[]
          updated_at?: string
          version?: number
        }
        Update: {
          brand_id?: string
          created_at?: string
          created_by?: string | null
          description?: string
          funnel_key?: string
          id?: string
          is_active?: boolean
          name?: string
          steps?: Json
          surfaces?: string[]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "analytics_funnel_definitions_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_hourly_rollups: {
        Row: {
          brand_id: string
          bucket_start: string
          computed_at: string
          dimensions: Json
          dimensions_key: string
          duration_p50_ms: number | null
          duration_p95_ms: number | null
          event_count: number
          failure_count: number
          id: string
          location_id: string | null
          metric_key: string
          success_count: number
          surface: string
          total_value: number
          unique_actors: number
        }
        Insert: {
          brand_id: string
          bucket_start: string
          computed_at?: string
          dimensions?: Json
          dimensions_key?: string
          duration_p50_ms?: number | null
          duration_p95_ms?: number | null
          event_count?: number
          failure_count?: number
          id?: string
          location_id?: string | null
          metric_key: string
          success_count?: number
          surface: string
          total_value?: number
          unique_actors?: number
        }
        Update: {
          brand_id?: string
          bucket_start?: string
          computed_at?: string
          dimensions?: Json
          dimensions_key?: string
          duration_p50_ms?: number | null
          duration_p95_ms?: number | null
          event_count?: number
          failure_count?: number
          id?: string
          location_id?: string | null
          metric_key?: string
          success_count?: number
          surface?: string
          total_value?: number
          unique_actors?: number
        }
        Relationships: [
          {
            foreignKeyName: "analytics_hourly_rollups_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_hourly_rollups_location_id_brand_id_fkey"
            columns: ["location_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id", "brand_id"]
          },
        ]
      }
      analytics_ingestion_batches: {
        Row: {
          accepted_count: number
          batch_key: string
          brand_id: string
          completed_at: string | null
          correlation_id: string
          error_code: string | null
          id: string
          received_at: string
          received_count: number
          rejected_count: number
          status: string
          surface: string
        }
        Insert: {
          accepted_count?: number
          batch_key: string
          brand_id: string
          completed_at?: string | null
          correlation_id: string
          error_code?: string | null
          id?: string
          received_at?: string
          received_count: number
          rejected_count?: number
          status?: string
          surface: string
        }
        Update: {
          accepted_count?: number
          batch_key?: string
          brand_id?: string
          completed_at?: string | null
          correlation_id?: string
          error_code?: string | null
          id?: string
          received_at?: string
          received_count?: number
          rejected_count?: number
          status?: string
          surface?: string
        }
        Relationships: [
          {
            foreignKeyName: "analytics_ingestion_batches_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_metric_definitions: {
        Row: {
          brand_id: string
          configuration: Json
          created_at: string
          created_by: string | null
          description: string
          formula_kind: string
          id: string
          is_active: boolean
          metric_key: string
          name: string
          source_event_keys: string[]
          updated_at: string
          version: number
        }
        Insert: {
          brand_id: string
          configuration?: Json
          created_at?: string
          created_by?: string | null
          description?: string
          formula_kind: string
          id?: string
          is_active?: boolean
          metric_key: string
          name: string
          source_event_keys?: string[]
          updated_at?: string
          version?: number
        }
        Update: {
          brand_id?: string
          configuration?: Json
          created_at?: string
          created_by?: string | null
          description?: string
          formula_kind?: string
          id?: string
          is_active?: boolean
          metric_key?: string
          name?: string
          source_event_keys?: string[]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "analytics_metric_definitions_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_saved_reports: {
        Row: {
          brand_id: string
          created_at: string
          created_by: string
          filters: Json
          id: string
          is_shared: boolean
          location_id: string | null
          name: string
          updated_at: string
          view_key: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          created_by: string
          filters?: Json
          id?: string
          is_shared?: boolean
          location_id?: string | null
          name: string
          updated_at?: string
          view_key: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          created_by?: string
          filters?: Json
          id?: string
          is_shared?: boolean
          location_id?: string | null
          name?: string
          updated_at?: string
          view_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "analytics_saved_reports_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_saved_reports_location_id_brand_id_fkey"
            columns: ["location_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id", "brand_id"]
          },
        ]
      }
      availability_blockouts: {
        Row: {
          brand_id: string
          brand_user_id: string | null
          created_at: string
          ends_at: string
          id: string
          location_id: string | null
          project_key: string | null
          reason: string
          requested_by: string
          review_note: string
          reviewed_at: string | null
          reviewed_by: string | null
          scope_kind: string
          starts_at: string
          status: string
          timezone: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          brand_user_id?: string | null
          created_at?: string
          ends_at: string
          id?: string
          location_id?: string | null
          project_key?: string | null
          reason: string
          requested_by: string
          review_note?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          scope_kind: string
          starts_at: string
          status?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          brand_user_id?: string | null
          created_at?: string
          ends_at?: string
          id?: string
          location_id?: string | null
          project_key?: string | null
          reason?: string
          requested_by?: string
          review_note?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          scope_kind?: string
          starts_at?: string
          status?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_blockouts_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_blockouts_brand_user_id_brand_id_fkey"
            columns: ["brand_user_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "brand_users"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "availability_blockouts_location_id_brand_id_fkey"
            columns: ["location_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "availability_blockouts_requested_by_brand_id_fkey"
            columns: ["requested_by", "brand_id"]
            isOneToOne: false
            referencedRelation: "brand_users"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "availability_blockouts_reviewed_by_brand_id_fkey"
            columns: ["reviewed_by", "brand_id"]
            isOneToOne: false
            referencedRelation: "brand_users"
            referencedColumns: ["id", "brand_id"]
          },
        ]
      }
      board_change_signals: {
        Row: {
          brand_id: string
          changed_at: string
          location_id: string
          revision: number
        }
        Insert: {
          brand_id: string
          changed_at?: string
          location_id: string
          revision?: number
        }
        Update: {
          brand_id?: string
          changed_at?: string
          location_id?: string
          revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "board_change_signals_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_change_signals_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: true
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_config_signals: {
        Row: {
          brand_id: string
          changed_at: string
          revision: number
        }
        Insert: {
          brand_id: string
          changed_at?: string
          revision?: number
        }
        Update: {
          brand_id?: string
          changed_at?: string
          revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "brand_config_signals_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: true
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_users: {
        Row: {
          brand_id: string
          created_at: string
          display_name: string
          id: string
          location_ids: string[]
          role: "platform_admin" | "brand_owner" | "location_manager" | "staff"
          user_id: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          display_name?: string
          id?: string
          location_ids?: string[]
          role: "platform_admin" | "brand_owner" | "location_manager" | "staff"
          user_id: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          display_name?: string
          id?: string
          location_ids?: string[]
          role?: "platform_admin" | "brand_owner" | "location_manager" | "staff"
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_users_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          brand_config: Json
          catering: boolean
          created_at: string
          delivery: boolean
          drops: boolean
          fee_bps: number
          fee_bps_tier2: number
          id: string
          multi_location: boolean
          name: string
          operations: boolean
          referrals: boolean
          slug: string
          sms: boolean
          stored_value: boolean
          tier_threshold_cents: number
          updated_at: string
        }
        Insert: {
          brand_config?: Json
          catering?: boolean
          created_at?: string
          delivery?: boolean
          drops?: boolean
          fee_bps?: number
          fee_bps_tier2?: number
          id?: string
          multi_location?: boolean
          name: string
          operations?: boolean
          referrals?: boolean
          slug: string
          sms?: boolean
          stored_value?: boolean
          tier_threshold_cents?: number
          updated_at?: string
        }
        Update: {
          brand_config?: Json
          catering?: boolean
          created_at?: string
          delivery?: boolean
          drops?: boolean
          fee_bps?: number
          fee_bps_tier2?: number
          id?: string
          multi_location?: boolean
          name?: string
          operations?: boolean
          referrals?: boolean
          slug?: string
          sms?: boolean
          stored_value?: boolean
          tier_threshold_cents?: number
          updated_at?: string
        }
        Relationships: []
      }
      calendar_categories: {
        Row: {
          accent_color: string
          brand_id: string
          core_kind: string
          created_at: string
          detail_template: string
          icon_key: string
          id: string
          is_active: boolean
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          accent_color: string
          brand_id: string
          core_kind: string
          created_at?: string
          detail_template?: string
          icon_key: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          accent_color?: string
          brand_id?: string
          core_kind?: string
          created_at?: string
          detail_template?: string
          icon_key?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_categories_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_entries: {
        Row: {
          brand_id: string
          category_id: string
          created_at: string
          created_by: string | null
          detail: Json
          ends_at: string
          id: string
          is_all_day: boolean
          location_id: string | null
          project_key: string | null
          recurrence_rule: string | null
          starts_at: string
          status: string
          summary: string
          timezone: string
          title: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          category_id: string
          created_at?: string
          created_by?: string | null
          detail?: Json
          ends_at: string
          id?: string
          is_all_day?: boolean
          location_id?: string | null
          project_key?: string | null
          recurrence_rule?: string | null
          starts_at: string
          status?: string
          summary?: string
          timezone?: string
          title: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          category_id?: string
          created_at?: string
          created_by?: string | null
          detail?: Json
          ends_at?: string
          id?: string
          is_all_day?: boolean
          location_id?: string | null
          project_key?: string | null
          recurrence_rule?: string | null
          starts_at?: string
          status?: string
          summary?: string
          timezone?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_entries_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_entries_category_id_brand_id_fkey"
            columns: ["category_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "calendar_categories"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "calendar_entries_created_by_brand_id_fkey"
            columns: ["created_by", "brand_id"]
            isOneToOne: false
            referencedRelation: "brand_users"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "calendar_entries_location_id_brand_id_fkey"
            columns: ["location_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id", "brand_id"]
          },
        ]
      }
      calendar_entry_assignments: {
        Row: {
          assignment_status: string
          brand_id: string
          brand_user_id: string
          calendar_entry_id: string
          created_at: string
          id: string
          workforce_role_id: string | null
        }
        Insert: {
          assignment_status?: string
          brand_id: string
          brand_user_id: string
          calendar_entry_id: string
          created_at?: string
          id?: string
          workforce_role_id?: string | null
        }
        Update: {
          assignment_status?: string
          brand_id?: string
          brand_user_id?: string
          calendar_entry_id?: string
          created_at?: string
          id?: string
          workforce_role_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_entry_assignments_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_entry_assignments_brand_user_id_brand_id_fkey"
            columns: ["brand_user_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "brand_users"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "calendar_entry_assignments_calendar_entry_id_brand_id_fkey"
            columns: ["calendar_entry_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "calendar_entries"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "calendar_entry_assignments_workforce_role_id_brand_id_fkey"
            columns: ["workforce_role_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "workforce_roles"
            referencedColumns: ["id", "brand_id"]
          },
        ]
      }
      campaigns: {
        Row: {
          audience: Json
          body: string
          brand_id: string
          channel: "push" | "sms" | "email"
          created_at: string
          drop_id: string | null
          id: string
          name: string
          scheduled_at: string | null
          stats: Json
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          audience?: Json
          body?: string
          brand_id: string
          channel: "push" | "sms" | "email"
          created_at?: string
          drop_id?: string | null
          id?: string
          name: string
          scheduled_at?: string | null
          stats?: Json
          status?: string
          subject?: string
          updated_at?: string
        }
        Update: {
          audience?: Json
          body?: string
          brand_id?: string
          channel?: "push" | "sms" | "email"
          created_at?: string
          drop_id?: string | null
          id?: string
          name?: string
          scheduled_at?: string | null
          stats?: Json
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_drop_id_fkey"
            columns: ["drop_id"]
            isOneToOne: false
            referencedRelation: "drop_performance"
            referencedColumns: ["drop_id"]
          },
          {
            foreignKeyName: "campaigns_drop_id_fkey"
            columns: ["drop_id"]
            isOneToOne: false
            referencedRelation: "drops"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_audit_events: {
        Row: {
          action: string
          actor_id: string | null
          brand_id: string
          catalog_id: string
          created_at: string
          id: string
          metadata: Json
          release_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          brand_id: string
          catalog_id: string
          created_at?: string
          id?: string
          metadata?: Json
          release_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          brand_id?: string
          catalog_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          release_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_audit_events_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_audit_events_catalog_id_brand_id_fkey"
            columns: ["catalog_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "catalogs"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "catalog_audit_events_release_id_fkey"
            columns: ["release_id"]
            isOneToOne: false
            referencedRelation: "catalog_releases"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_nodes: {
        Row: {
          archived_at: string | null
          audience: string
          brand_id: string
          catalog_id: string
          commerce_item_id: string | null
          description: string
          id: string
          image_url: string | null
          kind: string
          slug: string
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          audience?: string
          brand_id: string
          catalog_id: string
          commerce_item_id?: string | null
          description?: string
          id: string
          image_url?: string | null
          kind: string
          slug: string
          title: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          audience?: string
          brand_id?: string
          catalog_id?: string
          commerce_item_id?: string | null
          description?: string
          id?: string
          image_url?: string | null
          kind?: string
          slug?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_nodes_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_nodes_catalog_id_brand_id_fkey"
            columns: ["catalog_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "catalogs"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "catalog_nodes_commerce_item_id_catalog_id_brand_id_fkey"
            columns: ["commerce_item_id", "catalog_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id", "menu_id", "brand_id"]
          },
        ]
      }
      catalog_placements: {
        Row: {
          brand_id: string
          catalog_id: string
          created_at: string
          id: string
          is_primary: boolean
          node_id: string
          parent_id: string | null
          sort_order: number
        }
        Insert: {
          brand_id: string
          catalog_id: string
          created_at?: string
          id?: string
          is_primary?: boolean
          node_id: string
          parent_id?: string | null
          sort_order?: number
        }
        Update: {
          brand_id?: string
          catalog_id?: string
          created_at?: string
          id?: string
          is_primary?: boolean
          node_id?: string
          parent_id?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "catalog_placements_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_placements_catalog_id_brand_id_fkey"
            columns: ["catalog_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "catalogs"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "catalog_placements_node_id_catalog_id_brand_id_fkey"
            columns: ["node_id", "catalog_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "catalog_nodes"
            referencedColumns: ["id", "catalog_id", "brand_id"]
          },
          {
            foreignKeyName: "catalog_placements_parent_id_catalog_id_brand_id_fkey"
            columns: ["parent_id", "catalog_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "catalog_nodes"
            referencedColumns: ["id", "catalog_id", "brand_id"]
          },
        ]
      }
      catalog_publications: {
        Row: {
          brand_id: string
          catalog_id: string
          published_at: string
          release_id: string
          version: number
        }
        Insert: {
          brand_id: string
          catalog_id: string
          published_at?: string
          release_id: string
          version: number
        }
        Update: {
          brand_id?: string
          catalog_id?: string
          published_at?: string
          release_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "catalog_publications_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: true
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_publications_catalog_id_brand_id_fkey"
            columns: ["catalog_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "catalogs"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "catalog_publications_release_id_catalog_id_brand_id_fkey"
            columns: ["release_id", "catalog_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "catalog_releases"
            referencedColumns: ["id", "catalog_id", "brand_id"]
          },
        ]
      }
      catalog_relations: {
        Row: {
          brand_id: string
          catalog_id: string
          created_at: string
          id: string
          kind: string
          sort_order: number
          source_key: string
          target_key: string
        }
        Insert: {
          brand_id: string
          catalog_id: string
          created_at?: string
          id?: string
          kind: string
          sort_order?: number
          source_key: string
          target_key: string
        }
        Update: {
          brand_id?: string
          catalog_id?: string
          created_at?: string
          id?: string
          kind?: string
          sort_order?: number
          source_key?: string
          target_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_relations_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_relations_catalog_id_brand_id_fkey"
            columns: ["catalog_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "catalogs"
            referencedColumns: ["id", "brand_id"]
          },
        ]
      }
      catalog_release_private: {
        Row: {
          brand_id: string
          manifest: Json
          release_id: string
        }
        Insert: {
          brand_id: string
          manifest: Json
          release_id: string
        }
        Update: {
          brand_id?: string
          manifest?: Json
          release_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_release_private_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_release_private_release_id_brand_id_fkey"
            columns: ["release_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "catalog_releases"
            referencedColumns: ["id", "brand_id"]
          },
        ]
      }
      catalog_releases: {
        Row: {
          brand_id: string
          catalog_id: string
          created_at: string
          created_by: string | null
          id: string
          manifest: Json
          published_at: string | null
          status: string
          version: number
        }
        Insert: {
          brand_id: string
          catalog_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          manifest: Json
          published_at?: string | null
          status: string
          version: number
        }
        Update: {
          brand_id?: string
          catalog_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          manifest?: Json
          published_at?: string | null
          status?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "catalog_releases_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_releases_catalog_id_brand_id_fkey"
            columns: ["catalog_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "catalogs"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "catalog_releases_created_by_brand_id_fkey"
            columns: ["created_by", "brand_id"]
            isOneToOne: false
            referencedRelation: "brand_users"
            referencedColumns: ["id", "brand_id"]
          },
        ]
      }
      catalog_resources: {
        Row: {
          archived_at: string | null
          audience: string
          brand_id: string
          catalog_id: string
          external_ref: string | null
          id: string
          image_url: string | null
          kind: string
          metadata: Json
          slug: string
          summary: string
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          audience?: string
          brand_id: string
          catalog_id: string
          external_ref?: string | null
          id?: string
          image_url?: string | null
          kind: string
          metadata?: Json
          slug: string
          summary?: string
          title: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          audience?: string
          brand_id?: string
          catalog_id?: string
          external_ref?: string | null
          id?: string
          image_url?: string | null
          kind?: string
          metadata?: Json
          slug?: string
          summary?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_resources_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_resources_catalog_id_brand_id_fkey"
            columns: ["catalog_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "catalogs"
            referencedColumns: ["id", "brand_id"]
          },
        ]
      }
      catalog_templates: {
        Row: {
          created_at: string
          id: string
          industry: string
          locale: string
          manifest: Json
          template_key: string
          version: number
          vocabulary: Json
        }
        Insert: {
          created_at?: string
          id?: string
          industry: string
          locale?: string
          manifest?: Json
          template_key: string
          version: number
          vocabulary?: Json
        }
        Update: {
          created_at?: string
          id?: string
          industry?: string
          locale?: string
          manifest?: Json
          template_key?: string
          version?: number
          vocabulary?: Json
        }
        Relationships: []
      }
      catalogs: {
        Row: {
          brand_id: string
          draft_version: number
          id: string
          name: string
          template_id: string | null
          updated_at: string
          vocabulary: Json
        }
        Insert: {
          brand_id: string
          draft_version?: number
          id: string
          name?: string
          template_id?: string | null
          updated_at?: string
          vocabulary?: Json
        }
        Update: {
          brand_id?: string
          draft_version?: number
          id?: string
          name?: string
          template_id?: string | null
          updated_at?: string
          vocabulary?: Json
        }
        Relationships: [
          {
            foreignKeyName: "catalogs_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: true
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalogs_id_brand_id_fkey"
            columns: ["id", "brand_id"]
            isOneToOne: true
            referencedRelation: "menus"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "catalogs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "catalog_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      connector_audit_events: {
        Row: {
          action: string
          actor_user_id: string | null
          brand_id: string
          correlation_id: string
          created_at: string
          detail: Json
          id: string
          installation_id: string | null
          location_id: string | null
          outcome: string
          source: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          brand_id: string
          correlation_id: string
          created_at?: string
          detail?: Json
          id?: string
          installation_id?: string | null
          location_id?: string | null
          outcome: string
          source: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          brand_id?: string
          correlation_id?: string
          created_at?: string
          detail?: Json
          id?: string
          installation_id?: string | null
          location_id?: string | null
          outcome?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "connector_audit_events_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connector_audit_events_installation_id_brand_id_fkey"
            columns: ["installation_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "connector_installations"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "connector_audit_events_location_id_brand_id_fkey"
            columns: ["location_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id", "brand_id"]
          },
        ]
      }
      connector_capabilities: {
        Row: {
          access_mode: string
          capability_key: string
          created_at: string
          description: string
          display_name: string
          id: string
          is_active: boolean
          oauth_scopes: string[]
          provider_id: string
          updated_at: string
        }
        Insert: {
          access_mode: string
          capability_key: string
          created_at?: string
          description?: string
          display_name: string
          id?: string
          is_active?: boolean
          oauth_scopes?: string[]
          provider_id: string
          updated_at?: string
        }
        Update: {
          access_mode?: string
          capability_key?: string
          created_at?: string
          description?: string
          display_name?: string
          id?: string
          is_active?: boolean
          oauth_scopes?: string[]
          provider_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "connector_capabilities_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "connector_registry"
            referencedColumns: ["id"]
          },
        ]
      }
      connector_certifications: {
        Row: {
          capability_id: string
          certified_at: string | null
          certified_by: string | null
          contract_version: string
          created_at: string
          environment: string
          evidence_url: string | null
          id: string
          notes: string
          status: string
          updated_at: string
          valid_until: string | null
        }
        Insert: {
          capability_id: string
          certified_at?: string | null
          certified_by?: string | null
          contract_version: string
          created_at?: string
          environment?: string
          evidence_url?: string | null
          id?: string
          notes?: string
          status?: string
          updated_at?: string
          valid_until?: string | null
        }
        Update: {
          capability_id?: string
          certified_at?: string | null
          certified_by?: string | null
          contract_version?: string
          created_at?: string
          environment?: string
          evidence_url?: string | null
          id?: string
          notes?: string
          status?: string
          updated_at?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "connector_certifications_capability_id_fkey"
            columns: ["capability_id"]
            isOneToOne: false
            referencedRelation: "connector_capabilities"
            referencedColumns: ["id"]
          },
        ]
      }
      connector_health_snapshots: {
        Row: {
          brand_id: string
          circuit_state: string
          consecutive_failures: number
          detail: Json
          id: string
          installation_id: string
          latency_ms: number | null
          location_id: string | null
          observed_at: string
          status: string
        }
        Insert: {
          brand_id: string
          circuit_state?: string
          consecutive_failures?: number
          detail?: Json
          id?: string
          installation_id: string
          latency_ms?: number | null
          location_id?: string | null
          observed_at?: string
          status: string
        }
        Update: {
          brand_id?: string
          circuit_state?: string
          consecutive_failures?: number
          detail?: Json
          id?: string
          installation_id?: string
          latency_ms?: number | null
          location_id?: string | null
          observed_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "connector_health_snapshots_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connector_health_snapshots_installation_id_brand_id_fkey"
            columns: ["installation_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "connector_installations"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "connector_health_snapshots_location_id_brand_id_fkey"
            columns: ["location_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id", "brand_id"]
          },
        ]
      }
      connector_installations: {
        Row: {
          brand_id: string
          connected_at: string | null
          connected_by: string | null
          created_at: string
          credential_reference_id: string | null
          disabled_at: string | null
          enabled_capabilities: string[]
          environment: string
          external_account_label: string
          id: string
          last_synced_at: string | null
          provider_id: string
          settings: Json
          status: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          connected_at?: string | null
          connected_by?: string | null
          created_at?: string
          credential_reference_id?: string | null
          disabled_at?: string | null
          enabled_capabilities?: string[]
          environment?: string
          external_account_label?: string
          id?: string
          last_synced_at?: string | null
          provider_id: string
          settings?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          connected_at?: string | null
          connected_by?: string | null
          created_at?: string
          credential_reference_id?: string | null
          disabled_at?: string | null
          enabled_capabilities?: string[]
          environment?: string
          external_account_label?: string
          id?: string
          last_synced_at?: string | null
          provider_id?: string
          settings?: Json
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "connector_installations_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connector_installations_credential_reference_id_brand_id_fkey"
            columns: ["credential_reference_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "credential_references"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "connector_installations_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "connector_registry"
            referencedColumns: ["id"]
          },
        ]
      }
      connector_location_mappings: {
        Row: {
          brand_id: string
          created_at: string
          external_location_id: string
          external_location_label: string
          id: string
          installation_id: string
          is_active: boolean
          location_id: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          external_location_id: string
          external_location_label?: string
          id?: string
          installation_id: string
          is_active?: boolean
          location_id: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          external_location_id?: string
          external_location_label?: string
          id?: string
          installation_id?: string
          is_active?: boolean
          location_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "connector_location_mappings_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connector_location_mappings_installation_id_brand_id_fkey"
            columns: ["installation_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "connector_installations"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "connector_location_mappings_location_id_brand_id_fkey"
            columns: ["location_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id", "brand_id"]
          },
        ]
      }
      connector_registry: {
        Row: {
          adapter_contract_version: string
          availability: string
          brand_color: string | null
          category: string
          created_at: string
          description: string
          display_name: string
          documentation_url: string | null
          id: string
          is_active: boolean
          logo_license: string
          logo_path: string
          logo_source_url: string
          provider_key: string
          updated_at: string
        }
        Insert: {
          adapter_contract_version?: string
          availability?: string
          brand_color?: string | null
          category: string
          created_at?: string
          description?: string
          display_name: string
          documentation_url?: string | null
          id?: string
          is_active?: boolean
          logo_license: string
          logo_path: string
          logo_source_url: string
          provider_key: string
          updated_at?: string
        }
        Update: {
          adapter_contract_version?: string
          availability?: string
          brand_color?: string | null
          category?: string
          created_at?: string
          description?: string
          display_name?: string
          documentation_url?: string | null
          id?: string
          is_active?: boolean
          logo_license?: string
          logo_path?: string
          logo_source_url?: string
          provider_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      connector_sync_runs: {
        Row: {
          attempt_count: number
          brand_id: string
          capability_key: string
          correlation_id: string
          created_at: string
          direction: string
          error_code: string | null
          finished_at: string | null
          id: string
          idempotency_key: string
          installation_id: string
          location_id: string | null
          records_read: number
          records_rejected: number
          records_written: number
          retryable: boolean
          started_at: string | null
          status: string
          trigger_kind: string
        }
        Insert: {
          attempt_count?: number
          brand_id: string
          capability_key: string
          correlation_id: string
          created_at?: string
          direction: string
          error_code?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key: string
          installation_id: string
          location_id?: string | null
          records_read?: number
          records_rejected?: number
          records_written?: number
          retryable?: boolean
          started_at?: string | null
          status?: string
          trigger_kind: string
        }
        Update: {
          attempt_count?: number
          brand_id?: string
          capability_key?: string
          correlation_id?: string
          created_at?: string
          direction?: string
          error_code?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string
          installation_id?: string
          location_id?: string | null
          records_read?: number
          records_rejected?: number
          records_written?: number
          retryable?: boolean
          started_at?: string | null
          status?: string
          trigger_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "connector_sync_runs_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connector_sync_runs_installation_id_brand_id_fkey"
            columns: ["installation_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "connector_installations"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "connector_sync_runs_location_id_brand_id_fkey"
            columns: ["location_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id", "brand_id"]
          },
        ]
      }
      content_media_versions: {
        Row: {
          brand_id: string
          byte_size: number | null
          checksum_sha256: string | null
          created_at: string
          created_by: string | null
          entity_key: string
          entity_type: string
          family: string
          id: string
          metadata: Json
          mime_type: string | null
          object_path: string | null
          public_url: string
          slot: string
          storage_bucket: string | null
        }
        Insert: {
          brand_id: string
          byte_size?: number | null
          checksum_sha256?: string | null
          created_at?: string
          created_by?: string | null
          entity_key: string
          entity_type: string
          family: string
          id?: string
          metadata?: Json
          mime_type?: string | null
          object_path?: string | null
          public_url: string
          slot: string
          storage_bucket?: string | null
        }
        Update: {
          brand_id?: string
          byte_size?: number | null
          checksum_sha256?: string | null
          created_at?: string
          created_by?: string | null
          entity_key?: string
          entity_type?: string
          family?: string
          id?: string
          metadata?: Json
          mime_type?: string | null
          object_path?: string | null
          public_url?: string
          slot?: string
          storage_bucket?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_media_versions_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_media_versions_created_by_brand_id_fkey"
            columns: ["created_by", "brand_id"]
            isOneToOne: false
            referencedRelation: "brand_users"
            referencedColumns: ["id", "brand_id"]
          },
        ]
      }
      credential_references: {
        Row: {
          account_label: string
          brand_id: string
          created_at: string
          expires_at: string | null
          granted_scopes: string[]
          id: string
          last_rotated_at: string | null
          provider_id: string
          revoked_at: string | null
          updated_at: string
          vault_secret_id: string
        }
        Insert: {
          account_label?: string
          brand_id: string
          created_at?: string
          expires_at?: string | null
          granted_scopes?: string[]
          id?: string
          last_rotated_at?: string | null
          provider_id: string
          revoked_at?: string | null
          updated_at?: string
          vault_secret_id: string
        }
        Update: {
          account_label?: string
          brand_id?: string
          created_at?: string
          expires_at?: string | null
          granted_scopes?: string[]
          id?: string
          last_rotated_at?: string | null
          provider_id?: string
          revoked_at?: string | null
          updated_at?: string
          vault_secret_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credential_references_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credential_references_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "connector_registry"
            referencedColumns: ["id"]
          },
        ]
      }
      crew_task_completions: {
        Row: {
          brand_id: string
          completed_at: string
          completed_by: string | null
          id: string
          location_id: string
          service_date: string
          task_id: string
        }
        Insert: {
          brand_id: string
          completed_at?: string
          completed_by?: string | null
          id?: string
          location_id: string
          service_date: string
          task_id: string
        }
        Update: {
          brand_id?: string
          completed_at?: string
          completed_by?: string | null
          id?: string
          location_id?: string
          service_date?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crew_task_completions_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_task_completions_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_task_completions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "crew_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      crew_tasks: {
        Row: {
          brand_id: string
          created_at: string
          detail: string
          id: string
          is_active: boolean
          location_id: string | null
          recurrence: "opening" | "closing" | "daily" | "weekly"
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          detail?: string
          id?: string
          is_active?: boolean
          location_id?: string | null
          recurrence?: "opening" | "closing" | "daily" | "weekly"
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          detail?: string
          id?: string
          is_active?: boolean
          location_id?: string | null
          recurrence?: "opening" | "closing" | "daily" | "weekly"
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crew_tasks_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_tasks_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          brand_id: string
          created_at: string
          email: string | null
          full_name: string
          id: string
          phone: string | null
          push_token: string | null
          sms_opt_in: boolean
          updated_at: string
          user_id: string | null
        }
        Insert: {
          brand_id: string
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          phone?: string | null
          push_token?: string | null
          sms_opt_in?: boolean
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          brand_id?: string
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          phone?: string | null
          push_token?: string | null
          sms_opt_in?: boolean
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          brand_id: string
          created_at: string
          id: string
          label: string
          last_seen_at: string | null
          location_id: string
          paired_at: string | null
          pairing_code_hash: string | null
          pairing_expires_at: string | null
          revoked_at: string | null
          role: "kiosk" | "pos" | "display" | "prep"
          token_version: number
          updated_at: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          id?: string
          label?: string
          last_seen_at?: string | null
          location_id: string
          paired_at?: string | null
          pairing_code_hash?: string | null
          pairing_expires_at?: string | null
          revoked_at?: string | null
          role: "kiosk" | "pos" | "display" | "prep"
          token_version?: number
          updated_at?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          id?: string
          label?: string
          last_seen_at?: string | null
          location_id?: string
          paired_at?: string | null
          pairing_code_hash?: string | null
          pairing_expires_at?: string | null
          revoked_at?: string | null
          role?: "kiosk" | "pos" | "display" | "prep"
          token_version?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "devices_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devices_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      drops: {
        Row: {
          brand_id: string
          created_at: string
          ends_at: string
          hero_asset_url: string | null
          id: string
          item_id: string
          reveal_at: string | null
          starts_at: string
          status: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          ends_at: string
          hero_asset_url?: string | null
          id?: string
          item_id: string
          reveal_at?: string | null
          starts_at: string
          status?: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          ends_at?: string
          hero_asset_url?: string | null
          id?: string
          item_id?: string
          reveal_at?: string | null
          starts_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "drops_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drops_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      industry_blueprints: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          industry_key: string
          locale: string
          manifest: Json
          name: string
          status: string
          supabase_region: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          industry_key: string
          locale?: string
          manifest: Json
          name: string
          status?: string
          supabase_region?: string
          updated_at?: string
          version: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          industry_key?: string
          locale?: string
          manifest?: Json
          name?: string
          status?: string
          supabase_region?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      location_setting_signals: {
        Row: {
          brand_id: string
          changed_at: string
          location_id: string
          revision: number
        }
        Insert: {
          brand_id: string
          changed_at?: string
          location_id: string
          revision?: number
        }
        Update: {
          brand_id?: string
          changed_at?: string
          location_id?: string
          revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "location_setting_signals_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_setting_signals_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: true
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          address: Json
          brand_id: string
          created_at: string
          fee_bps: number | null
          fee_bps_tier2: number | null
          hours: Json
          id: string
          name: string
          ordering_paused: boolean
          square_connection_id: string | null
          tier_threshold_cents: number | null
          timezone: string
          updated_at: string
        }
        Insert: {
          address?: Json
          brand_id: string
          created_at?: string
          fee_bps?: number | null
          fee_bps_tier2?: number | null
          hours?: Json
          id?: string
          name: string
          ordering_paused?: boolean
          square_connection_id?: string | null
          tier_threshold_cents?: number | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          address?: Json
          brand_id?: string
          created_at?: string
          fee_bps?: number | null
          fee_bps_tier2?: number | null
          hours?: Json
          id?: string
          name?: string
          ordering_paused?: boolean
          square_connection_id?: string | null
          tier_threshold_cents?: number | null
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "locations_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locations_square_connection_id_fkey"
            columns: ["square_connection_id"]
            isOneToOne: false
            referencedRelation: "square_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_accounts: {
        Row: {
          brand_id: string
          created_at: string
          customer_id: string
          id: string
          lifetime_points: number
          points_balance: number
          updated_at: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          customer_id: string
          id?: string
          lifetime_points?: number
          points_balance?: number
          updated_at?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          customer_id?: string
          id?: string
          lifetime_points?: number
          points_balance?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_accounts_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_accounts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_events: {
        Row: {
          account_id: string
          brand_id: string
          created_at: string
          id: string
          note: string
          order_id: string | null
          points: number
          type: string
        }
        Insert: {
          account_id: string
          brand_id: string
          created_at?: string
          id?: string
          note?: string
          order_id?: string | null
          points: number
          type: string
        }
        Update: {
          account_id?: string
          brand_id?: string
          created_at?: string
          id?: string
          note?: string
          order_id?: string | null
          points?: number
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "loyalty_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_events_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_events_order_fk"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_categories: {
        Row: {
          archived_at: string | null
          audience: string
          brand_id: string
          created_at: string
          id: string
          image_url: string | null
          menu_id: string
          parent_id: string | null
          slug: string
          sort_order: number
          tagline: string
          title: string
        }
        Insert: {
          archived_at?: string | null
          audience?: string
          brand_id: string
          created_at?: string
          id?: string
          image_url?: string | null
          menu_id: string
          parent_id?: string | null
          slug: string
          sort_order?: number
          tagline?: string
          title: string
        }
        Update: {
          archived_at?: string | null
          audience?: string
          brand_id?: string
          created_at?: string
          id?: string
          image_url?: string | null
          menu_id?: string
          parent_id?: string | null
          slug?: string
          sort_order?: number
          tagline?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_categories_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_categories_menu_id_fkey"
            columns: ["menu_id"]
            isOneToOne: false
            referencedRelation: "menus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_categories_parent_tenant_fkey"
            columns: ["parent_id", "menu_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id", "menu_id", "brand_id"]
          },
        ]
      }
      menu_items: {
        Row: {
          availability: Json
          base_price_cents: number
          brand_id: string
          catalog_audience: string
          category_id: string
          choice_source: string | null
          created_at: string
          description: string
          id: string
          image_url: string | null
          is_86d: boolean
          is_listed: boolean
          menu_id: string
          modifiers: Json
          name: string
          pack_choice_slugs: string[]
          pack_size: number | null
          rotation: "permanent" | "rotating" | "day_specific"
          single_item_id: string | null
          sizes: Json
          slug: string
          sort_order: number
          updated_at: string
          weekday: number | null
        }
        Insert: {
          availability?: Json
          base_price_cents: number
          brand_id: string
          catalog_audience?: string
          category_id: string
          choice_source?: string | null
          created_at?: string
          description?: string
          id?: string
          image_url?: string | null
          is_86d?: boolean
          is_listed?: boolean
          menu_id: string
          modifiers?: Json
          name: string
          pack_choice_slugs?: string[]
          pack_size?: number | null
          rotation?: "permanent" | "rotating" | "day_specific"
          single_item_id?: string | null
          sizes?: Json
          slug: string
          sort_order?: number
          updated_at?: string
          weekday?: number | null
        }
        Update: {
          availability?: Json
          base_price_cents?: number
          brand_id?: string
          catalog_audience?: string
          category_id?: string
          choice_source?: string | null
          created_at?: string
          description?: string
          id?: string
          image_url?: string | null
          is_86d?: boolean
          is_listed?: boolean
          menu_id?: string
          modifiers?: Json
          name?: string
          pack_choice_slugs?: string[]
          pack_size?: number | null
          rotation?: "permanent" | "rotating" | "day_specific"
          single_item_id?: string | null
          sizes?: Json
          slug?: string
          sort_order?: number
          updated_at?: string
          weekday?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_menu_id_fkey"
            columns: ["menu_id"]
            isOneToOne: false
            referencedRelation: "menus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_single_item_id_fkey"
            columns: ["single_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      menus: {
        Row: {
          brand_id: string
          created_at: string
          id: string
          is_published: boolean
          name: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          id?: string
          is_published?: boolean
          name?: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          id?: string
          is_published?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menus_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      operation_action_receipts: {
        Row: {
          action_id: string
          action_type: string
          actor_id: string | null
          brand_id: string
          created_at: string
          id: string
          location_id: string
          occurrence_id: string
          result_id: string
        }
        Insert: {
          action_id: string
          action_type: string
          actor_id?: string | null
          brand_id: string
          created_at?: string
          id?: string
          location_id: string
          occurrence_id: string
          result_id: string
        }
        Update: {
          action_id?: string
          action_type?: string
          actor_id?: string | null
          brand_id?: string
          created_at?: string
          id?: string
          location_id?: string
          occurrence_id?: string
          result_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "operation_action_receipts_actor_id_brand_id_fkey"
            columns: ["actor_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "brand_users"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "operation_action_receipts_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operation_action_receipts_location_id_brand_id_fkey"
            columns: ["location_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "operation_action_receipts_occurrence_id_brand_id_location__fkey"
            columns: ["occurrence_id", "brand_id", "location_id"]
            isOneToOne: false
            referencedRelation: "operation_occurrences"
            referencedColumns: ["id", "brand_id", "location_id"]
          },
        ]
      }
      operation_escalation_rules: {
        Row: {
          brand_id: string
          channels: string[]
          escalation_order: number
          id: string
          is_active: boolean
          managed_by_config: boolean
          offset_minutes: number
          recipient_role: string
          schedule_id: string | null
        }
        Insert: {
          brand_id: string
          channels?: string[]
          escalation_order: number
          id?: string
          is_active?: boolean
          managed_by_config?: boolean
          offset_minutes: number
          recipient_role: string
          schedule_id?: string | null
        }
        Update: {
          brand_id?: string
          channels?: string[]
          escalation_order?: number
          id?: string
          is_active?: boolean
          managed_by_config?: boolean
          offset_minutes?: number
          recipient_role?: string
          schedule_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operation_escalation_rules_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operation_escalation_rules_schedule_id_brand_id_fkey"
            columns: ["schedule_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "operation_schedules"
            referencedColumns: ["id", "brand_id"]
          },
        ]
      }
      operation_issues: {
        Row: {
          brand_id: string
          category: string
          created_at: string
          description: string
          id: string
          location_id: string
          occurrence_id: string
          reported_by: string | null
          resolution: string
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          status: string
          step_key: string | null
          updated_at: string
        }
        Insert: {
          brand_id: string
          category: string
          created_at?: string
          description?: string
          id?: string
          location_id: string
          occurrence_id: string
          reported_by?: string | null
          resolution?: string
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
          step_key?: string | null
          updated_at?: string
        }
        Update: {
          brand_id?: string
          category?: string
          created_at?: string
          description?: string
          id?: string
          location_id?: string
          occurrence_id?: string
          reported_by?: string | null
          resolution?: string
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
          step_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "operation_issues_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operation_issues_location_id_brand_id_fkey"
            columns: ["location_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "operation_issues_occurrence_brand_location_fkey"
            columns: ["occurrence_id", "brand_id", "location_id"]
            isOneToOne: false
            referencedRelation: "operation_occurrences"
            referencedColumns: ["id", "brand_id", "location_id"]
          },
          {
            foreignKeyName: "operation_issues_reported_by_brand_fkey"
            columns: ["reported_by", "brand_id"]
            isOneToOne: false
            referencedRelation: "brand_users"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "operation_issues_resolved_by_brand_id_fkey"
            columns: ["resolved_by", "brand_id"]
            isOneToOne: false
            referencedRelation: "brand_users"
            referencedColumns: ["id", "brand_id"]
          },
        ]
      }
      operation_notification_outbox: {
        Row: {
          attempt_count: number
          available_at: string
          brand_id: string
          channel: string
          created_at: string
          escalation_rule_id: string
          id: string
          last_error: string | null
          location_id: string
          occurrence_id: string
          recipient_id: string
          sent_at: string | null
          status: string
        }
        Insert: {
          attempt_count?: number
          available_at: string
          brand_id: string
          channel: string
          created_at?: string
          escalation_rule_id: string
          id?: string
          last_error?: string | null
          location_id: string
          occurrence_id: string
          recipient_id: string
          sent_at?: string | null
          status?: string
        }
        Update: {
          attempt_count?: number
          available_at?: string
          brand_id?: string
          channel?: string
          created_at?: string
          escalation_rule_id?: string
          id?: string
          last_error?: string | null
          location_id?: string
          occurrence_id?: string
          recipient_id?: string
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "operation_notification_outbox_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operation_notification_outbox_location_id_brand_id_fkey"
            columns: ["location_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "operation_notification_outbox_recipient_id_brand_id_fkey"
            columns: ["recipient_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "brand_users"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "operation_outbox_escalation_brand_fkey"
            columns: ["escalation_rule_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "operation_escalation_rules"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "operation_outbox_occurrence_brand_location_fkey"
            columns: ["occurrence_id", "brand_id", "location_id"]
            isOneToOne: false
            referencedRelation: "operation_occurrences"
            referencedColumns: ["id", "brand_id", "location_id"]
          },
        ]
      }
      operation_occurrence_events: {
        Row: {
          actor_id: string | null
          brand_id: string
          created_at: string
          detail: Json
          event_type: string
          id: string
          occurrence_id: string
          reason: string
        }
        Insert: {
          actor_id?: string | null
          brand_id: string
          created_at?: string
          detail?: Json
          event_type: string
          id?: string
          occurrence_id: string
          reason?: string
        }
        Update: {
          actor_id?: string | null
          brand_id?: string
          created_at?: string
          detail?: Json
          event_type?: string
          id?: string
          occurrence_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "operation_occurrence_events_actor_id_brand_id_fkey"
            columns: ["actor_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "brand_users"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "operation_occurrence_events_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operation_occurrence_events_occurrence_id_brand_id_fkey"
            columns: ["occurrence_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "operation_occurrences"
            referencedColumns: ["id", "brand_id"]
          },
        ]
      }
      operation_occurrences: {
        Row: {
          brand_id: string
          claim_expires_at: string | null
          claimed_at: string | null
          claimed_by: string | null
          completed_at: string | null
          completion_note: string
          created_at: string
          due_at: string
          grace_minutes: number
          id: string
          location_id: string
          materialization_key: string
          schedule_id: string | null
          scheduled_for: string
          source: string
          status:
            | "upcoming"
            | "due"
            | "claimed"
            | "completed"
            | "overdue"
            | "waived"
            | "cancelled"
          template_id: string
          template_snapshot: Json
          updated_at: string
        }
        Insert: {
          brand_id: string
          claim_expires_at?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          completed_at?: string | null
          completion_note?: string
          created_at?: string
          due_at: string
          grace_minutes?: number
          id?: string
          location_id: string
          materialization_key: string
          schedule_id?: string | null
          scheduled_for: string
          source?: string
          status?:
            | "upcoming"
            | "due"
            | "claimed"
            | "completed"
            | "overdue"
            | "waived"
            | "cancelled"
          template_id: string
          template_snapshot: Json
          updated_at?: string
        }
        Update: {
          brand_id?: string
          claim_expires_at?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          completed_at?: string | null
          completion_note?: string
          created_at?: string
          due_at?: string
          grace_minutes?: number
          id?: string
          location_id?: string
          materialization_key?: string
          schedule_id?: string | null
          scheduled_for?: string
          source?: string
          status?:
            | "upcoming"
            | "due"
            | "claimed"
            | "completed"
            | "overdue"
            | "waived"
            | "cancelled"
          template_id?: string
          template_snapshot?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "operation_occurrences_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operation_occurrences_claimed_by_brand_id_fkey"
            columns: ["claimed_by", "brand_id"]
            isOneToOne: false
            referencedRelation: "brand_users"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "operation_occurrences_location_id_brand_id_fkey"
            columns: ["location_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "operation_occurrences_schedule_id_brand_id_fkey"
            columns: ["schedule_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "operation_schedules"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "operation_occurrences_template_id_brand_id_fkey"
            columns: ["template_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "operation_task_templates"
            referencedColumns: ["id", "brand_id"]
          },
        ]
      }
      operation_retention_policies: {
        Row: {
          actor_identity_days: number
          brand_id: string
          evidence_days: number
          issue_days: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          actor_identity_days?: number
          brand_id: string
          evidence_days?: number
          issue_days?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          actor_identity_days?: number
          brand_id?: string
          evidence_days?: number
          issue_days?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operation_retention_policies_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: true
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operation_retention_policies_updated_by_brand_id_fkey"
            columns: ["updated_by", "brand_id"]
            isOneToOne: false
            referencedRelation: "brand_users"
            referencedColumns: ["id", "brand_id"]
          },
        ]
      }
      operation_schedules: {
        Row: {
          active_from: string
          active_until: string | null
          anchor_offset_minutes: number | null
          brand_id: string
          created_at: string
          created_by: string | null
          due_window_minutes: number
          grace_minutes: number
          id: string
          interval_end_offset_minutes: number | null
          interval_minutes: number | null
          is_enabled: boolean
          local_start_time: string | null
          location_id: string
          managed_by_config: boolean
          recurrence_rule: string
          schedule_key: string
          schedule_kind: string
          template_id: string
          timezone: string
          updated_at: string
          weekdays: number[]
        }
        Insert: {
          active_from?: string
          active_until?: string | null
          anchor_offset_minutes?: number | null
          brand_id: string
          created_at?: string
          created_by?: string | null
          due_window_minutes?: number
          grace_minutes?: number
          id?: string
          interval_end_offset_minutes?: number | null
          interval_minutes?: number | null
          is_enabled?: boolean
          local_start_time?: string | null
          location_id: string
          managed_by_config?: boolean
          recurrence_rule: string
          schedule_key: string
          schedule_kind?: string
          template_id: string
          timezone: string
          updated_at?: string
          weekdays?: number[]
        }
        Update: {
          active_from?: string
          active_until?: string | null
          anchor_offset_minutes?: number | null
          brand_id?: string
          created_at?: string
          created_by?: string | null
          due_window_minutes?: number
          grace_minutes?: number
          id?: string
          interval_end_offset_minutes?: number | null
          interval_minutes?: number | null
          is_enabled?: boolean
          local_start_time?: string | null
          location_id?: string
          managed_by_config?: boolean
          recurrence_rule?: string
          schedule_key?: string
          schedule_kind?: string
          template_id?: string
          timezone?: string
          updated_at?: string
          weekdays?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "operation_schedules_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operation_schedules_created_by_brand_id_fkey"
            columns: ["created_by", "brand_id"]
            isOneToOne: false
            referencedRelation: "brand_users"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "operation_schedules_location_id_brand_id_fkey"
            columns: ["location_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "operation_schedules_template_id_brand_id_fkey"
            columns: ["template_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "operation_task_templates"
            referencedColumns: ["id", "brand_id"]
          },
        ]
      }
      operation_step_responses: {
        Row: {
          brand_id: string
          id: string
          occurrence_id: string
          responded_at: string
          responded_by: string | null
          response: Json
          step_key: string
        }
        Insert: {
          brand_id: string
          id?: string
          occurrence_id: string
          responded_at?: string
          responded_by?: string | null
          response: Json
          step_key: string
        }
        Update: {
          brand_id?: string
          id?: string
          occurrence_id?: string
          responded_at?: string
          responded_by?: string | null
          response?: Json
          step_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "operation_responses_responded_by_brand_fkey"
            columns: ["responded_by", "brand_id"]
            isOneToOne: false
            referencedRelation: "brand_users"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "operation_step_responses_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operation_step_responses_occurrence_id_brand_id_fkey"
            columns: ["occurrence_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "operation_occurrences"
            referencedColumns: ["id", "brand_id"]
          },
        ]
      }
      operation_task_steps: {
        Row: {
          allow_not_applicable: boolean
          brand_id: string
          constraints: Json
          id: string
          instructions: string
          is_required: boolean
          issue_on_failure: boolean
          response_kind: string
          sort_order: number
          step_key: string
          template_id: string
          title: string
        }
        Insert: {
          allow_not_applicable?: boolean
          brand_id: string
          constraints?: Json
          id?: string
          instructions?: string
          is_required?: boolean
          issue_on_failure?: boolean
          response_kind?: string
          sort_order?: number
          step_key: string
          template_id: string
          title: string
        }
        Update: {
          allow_not_applicable?: boolean
          brand_id?: string
          constraints?: Json
          id?: string
          instructions?: string
          is_required?: boolean
          issue_on_failure?: boolean
          response_kind?: string
          sort_order?: number
          step_key?: string
          template_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "operation_task_steps_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operation_task_steps_template_id_brand_id_fkey"
            columns: ["template_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "operation_task_templates"
            referencedColumns: ["id", "brand_id"]
          },
        ]
      }
      operation_task_templates: {
        Row: {
          brand_id: string
          brand_template_id: string | null
          created_at: string
          created_by: string | null
          estimated_minutes: number
          evidence_policy: Json
          id: string
          instructions: string
          is_active: boolean
          location_id: string | null
          managed_by_config: boolean
          program_key: string
          required_competency_keys: string[]
          required_role_ids: string[]
          revision: number
          routine_kind: string
          template_key: string
          title: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          brand_template_id?: string | null
          created_at?: string
          created_by?: string | null
          estimated_minutes?: number
          evidence_policy?: Json
          id?: string
          instructions?: string
          is_active?: boolean
          location_id?: string | null
          managed_by_config?: boolean
          program_key?: string
          required_competency_keys?: string[]
          required_role_ids?: string[]
          revision?: number
          routine_kind?: string
          template_key: string
          title: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          brand_template_id?: string | null
          created_at?: string
          created_by?: string | null
          estimated_minutes?: number
          evidence_policy?: Json
          id?: string
          instructions?: string
          is_active?: boolean
          location_id?: string | null
          managed_by_config?: boolean
          program_key?: string
          required_competency_keys?: string[]
          required_role_ids?: string[]
          revision?: number
          routine_kind?: string
          template_key?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "operation_task_templates_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operation_task_templates_brand_template_id_brand_id_fkey"
            columns: ["brand_template_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "operation_task_templates"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "operation_task_templates_created_by_brand_id_fkey"
            columns: ["created_by", "brand_id"]
            isOneToOne: false
            referencedRelation: "brand_users"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "operation_task_templates_location_id_brand_id_fkey"
            columns: ["location_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id", "brand_id"]
          },
        ]
      }
      operations_change_signals: {
        Row: {
          brand_id: string
          changed_at: string
          location_id: string
          revision: number
        }
        Insert: {
          brand_id: string
          changed_at?: string
          location_id: string
          revision?: number
        }
        Update: {
          brand_id?: string
          changed_at?: string
          location_id?: string
          revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "operations_change_signals_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operations_change_signals_location_id_brand_id_fkey"
            columns: ["location_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id", "brand_id"]
          },
        ]
      }
      order_events: {
        Row: {
          actor_user_id: string | null
          brand_id: string
          created_at: string
          id: string
          order_id: string
          refund_cents: number | null
          refund_request_key: string | null
          snapshot: Json
          source: string
          square_event_id: string | null
          square_refund_id: string | null
          type:
            | "created"
            | "paid"
            | "in_progress"
            | "ready"
            | "picked_up"
            | "cancelled"
            | "refunded"
        }
        Insert: {
          actor_user_id?: string | null
          brand_id: string
          created_at?: string
          id?: string
          order_id: string
          refund_cents?: number | null
          refund_request_key?: string | null
          snapshot?: Json
          source?: string
          square_event_id?: string | null
          square_refund_id?: string | null
          type:
            | "created"
            | "paid"
            | "in_progress"
            | "ready"
            | "picked_up"
            | "cancelled"
            | "refunded"
        }
        Update: {
          actor_user_id?: string | null
          brand_id?: string
          created_at?: string
          id?: string
          order_id?: string
          refund_cents?: number | null
          refund_request_key?: string | null
          snapshot?: Json
          source?: string
          square_event_id?: string | null
          square_refund_id?: string | null
          type?:
            | "created"
            | "paid"
            | "in_progress"
            | "ready"
            | "picked_up"
            | "cancelled"
            | "refunded"
        }
        Relationships: [
          {
            foreignKeyName: "order_events_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          arrived_at: string | null
          brand_id: string
          channel: "app" | "web" | "kiosk" | "pos"
          client_key: string | null
          created_at: string
          customer_id: string | null
          daily_number: number | null
          device_id: string | null
          fulfillment_type: "pickup" | "curbside" | "catering" | "delivery"
          guest_label: string | null
          id: string
          location_id: string
          loyalty_redeemed_points: number
          note: string
          scheduled_for: string | null
          service_date: string | null
          square_checkout_url: string | null
          square_order_id: string | null
          square_payment_id: string | null
          status:
            | "created"
            | "paid"
            | "in_progress"
            | "ready"
            | "picked_up"
            | "cancelled"
            | "refunded"
          stored_value_applied_cents: number
          subtotal_cents: number
          tax_cents: number
          tender_type: string
          tip_cents: number
          total_cents: number
          totals: Json
          updated_at: string
        }
        Insert: {
          arrived_at?: string | null
          brand_id: string
          channel?: "app" | "web" | "kiosk" | "pos"
          client_key?: string | null
          created_at?: string
          customer_id?: string | null
          daily_number?: number | null
          device_id?: string | null
          fulfillment_type?: "pickup" | "curbside" | "catering" | "delivery"
          guest_label?: string | null
          id?: string
          location_id: string
          loyalty_redeemed_points?: number
          note?: string
          scheduled_for?: string | null
          service_date?: string | null
          square_checkout_url?: string | null
          square_order_id?: string | null
          square_payment_id?: string | null
          status?:
            | "created"
            | "paid"
            | "in_progress"
            | "ready"
            | "picked_up"
            | "cancelled"
            | "refunded"
          stored_value_applied_cents?: number
          subtotal_cents?: number
          tax_cents?: number
          tender_type?: string
          tip_cents?: number
          total_cents?: number
          totals?: Json
          updated_at?: string
        }
        Update: {
          arrived_at?: string | null
          brand_id?: string
          channel?: "app" | "web" | "kiosk" | "pos"
          client_key?: string | null
          created_at?: string
          customer_id?: string | null
          daily_number?: number | null
          device_id?: string | null
          fulfillment_type?: "pickup" | "curbside" | "catering" | "delivery"
          guest_label?: string | null
          id?: string
          location_id?: string
          loyalty_redeemed_points?: number
          note?: string
          scheduled_for?: string | null
          service_date?: string | null
          square_checkout_url?: string | null
          square_order_id?: string | null
          square_payment_id?: string | null
          status?:
            | "created"
            | "paid"
            | "in_progress"
            | "ready"
            | "picked_up"
            | "cancelled"
            | "refunded"
          stored_value_applied_cents?: number
          subtotal_cents?: number
          tax_cents?: number
          tender_type?: string
          tip_cents?: number
          total_cents?: number
          totals?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_artifact_manifests: {
        Row: {
          artifact_kind: string
          created_at: string
          id: string
          manifest: Json
          published_at: string | null
          run_id: string
          source_fingerprint: string
          validation_state: string
          version: number
        }
        Insert: {
          artifact_kind: string
          created_at?: string
          id?: string
          manifest: Json
          published_at?: string | null
          run_id: string
          source_fingerprint: string
          validation_state: string
          version: number
        }
        Update: {
          artifact_kind?: string
          created_at?: string
          id?: string
          manifest?: Json
          published_at?: string | null
          run_id?: string
          source_fingerprint?: string
          validation_state?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "platform_artifact_manifests_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "platform_onboarding_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_automation_policies: {
        Row: {
          authorized_at: string
          authorized_by: string
          created_at: string
          id: string
          policy: Json
          run_id: string
          status: string
          version: number
        }
        Insert: {
          authorized_at?: string
          authorized_by: string
          created_at?: string
          id?: string
          policy: Json
          run_id: string
          status?: string
          version: number
        }
        Update: {
          authorized_at?: string
          authorized_by?: string
          created_at?: string
          id?: string
          policy?: Json
          run_id?: string
          status?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "platform_automation_policies_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "platform_onboarding_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_billing_accounts: {
        Row: {
          created_at: string
          elevate_client_id: string | null
          id: string
          rate_plan_id: string | null
          run_id: string
          state: string
          stripe_customer_reference: string | null
          trial_ends_at: string | null
          trial_started_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          elevate_client_id?: string | null
          id?: string
          rate_plan_id?: string | null
          run_id: string
          state?: string
          stripe_customer_reference?: string | null
          trial_ends_at?: string | null
          trial_started_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          elevate_client_id?: string | null
          id?: string
          rate_plan_id?: string | null
          run_id?: string
          state?: string
          stripe_customer_reference?: string | null
          trial_ends_at?: string | null
          trial_started_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_billing_accounts_rate_plan_id_fkey"
            columns: ["rate_plan_id"]
            isOneToOne: false
            referencedRelation: "platform_rate_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_billing_accounts_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "platform_onboarding_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_billing_entitlement_snapshots: {
        Row: {
          billing_account_id: string
          created_at: string
          effective_at: string
          entitlements: Json
          event_type: string
          external_event_id: string
          id: string
          signature_fingerprint: string
        }
        Insert: {
          billing_account_id: string
          created_at?: string
          effective_at: string
          entitlements: Json
          event_type: string
          external_event_id: string
          id?: string
          signature_fingerprint: string
        }
        Update: {
          billing_account_id?: string
          created_at?: string
          effective_at?: string
          entitlements?: Json
          event_type?: string
          external_event_id?: string
          id?: string
          signature_fingerprint?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_billing_entitlement_snapshots_billing_account_id_fkey"
            columns: ["billing_account_id"]
            isOneToOne: false
            referencedRelation: "platform_billing_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_billing_webhook_events: {
        Row: {
          event_type: string
          id: string
          payload: Json
          processed_at: string | null
          provider_event_id: string
          received_at: string
          signature_fingerprint: string
          state: string
        }
        Insert: {
          event_type: string
          id?: string
          payload: Json
          processed_at?: string | null
          provider_event_id: string
          received_at?: string
          signature_fingerprint: string
          state?: string
        }
        Update: {
          event_type?: string
          id?: string
          payload?: Json
          processed_at?: string | null
          provider_event_id?: string
          received_at?: string
          signature_fingerprint?: string
          state?: string
        }
        Relationships: []
      }
      platform_credential_requirements: {
        Row: {
          created_at: string
          credential_key: string
          fingerprint: string | null
          id: string
          owner_role: string
          provider: string
          run_id: string
          scopes: string[]
          secret_reference: string | null
          state: string
          storage_system: string
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          credential_key: string
          fingerprint?: string | null
          id?: string
          owner_role: string
          provider: string
          run_id: string
          scopes?: string[]
          secret_reference?: string | null
          state?: string
          storage_system: string
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          credential_key?: string
          fingerprint?: string | null
          id?: string
          owner_role?: string
          provider?: string
          run_id?: string
          scopes?: string[]
          secret_reference?: string | null
          state?: string
          storage_system?: string
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_credential_requirements_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "platform_onboarding_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_factory_audit_events: {
        Row: {
          actor_id: string | null
          correlation_id: string
          created_at: string
          event_type: string
          id: string
          metadata: Json
          run_id: string | null
        }
        Insert: {
          actor_id?: string | null
          correlation_id: string
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          run_id?: string | null
        }
        Update: {
          actor_id?: string | null
          correlation_id?: string
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_factory_audit_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "platform_onboarding_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_fees: {
        Row: {
          brand_id: string
          created_at: string
          fee_bps_applied: number
          fee_cents: number
          gross_cents: number
          id: string
          location_id: string
          order_id: string | null
          square_payment_id: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          fee_bps_applied: number
          fee_cents: number
          gross_cents: number
          id?: string
          location_id: string
          order_id?: string | null
          square_payment_id: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          fee_bps_applied?: number
          fee_cents?: number
          gross_cents?: number
          id?: string
          location_id?: string
          order_id?: string | null
          square_payment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_fees_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_fees_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_fees_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_onboarding_runs: {
        Row: {
          automation_policy_version: number
          business_name: string
          completed_at: string | null
          created_at: string
          created_by: string
          id: string
          idempotency_key: string
          industry_blueprint_id: string
          last_error_code: string | null
          location_name: string
          schema_version: number
          stage: string
          started_at: string | null
          state: string
          tenant_slug: string
          timezone: string
          updated_at: string
          website_url: string | null
        }
        Insert: {
          automation_policy_version?: number
          business_name: string
          completed_at?: string | null
          created_at?: string
          created_by: string
          id?: string
          idempotency_key: string
          industry_blueprint_id: string
          last_error_code?: string | null
          location_name: string
          schema_version?: number
          stage?: string
          started_at?: string | null
          state?: string
          tenant_slug: string
          timezone: string
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          automation_policy_version?: number
          business_name?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string
          id?: string
          idempotency_key?: string
          industry_blueprint_id?: string
          last_error_code?: string | null
          location_name?: string
          schema_version?: number
          stage?: string
          started_at?: string | null
          state?: string
          tenant_slug?: string
          timezone?: string
          updated_at?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_onboarding_runs_industry_blueprint_id_fkey"
            columns: ["industry_blueprint_id"]
            isOneToOne: false
            referencedRelation: "industry_blueprints"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_onboarding_tasks: {
        Row: {
          attempt_count: number
          completed_at: string | null
          correlation_id: string | null
          created_at: string
          credential_keys: string[]
          dependency_keys: string[]
          id: string
          label: string
          last_error_code: string | null
          maximum_attempts: number
          provider: string
          run_id: string
          stage: string
          started_at: string | null
          state: string
          task_key: string
          timeout_ms: number
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          completed_at?: string | null
          correlation_id?: string | null
          created_at?: string
          credential_keys?: string[]
          dependency_keys?: string[]
          id?: string
          label: string
          last_error_code?: string | null
          maximum_attempts: number
          provider: string
          run_id: string
          stage: string
          started_at?: string | null
          state?: string
          task_key: string
          timeout_ms: number
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          completed_at?: string | null
          correlation_id?: string | null
          created_at?: string
          credential_keys?: string[]
          dependency_keys?: string[]
          id?: string
          label?: string
          last_error_code?: string | null
          maximum_attempts?: number
          provider?: string
          run_id?: string
          stage?: string
          started_at?: string | null
          state?: string
          task_key?: string
          timeout_ms?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_onboarding_tasks_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "platform_onboarding_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_provider_guides: {
        Row: {
          created_at: string
          guide_key: string
          id: string
          last_verified_at: string
          official_url: string
          owner_role: string
          provider: string
          status: string
          steps: Json
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          guide_key: string
          id?: string
          last_verified_at: string
          official_url: string
          owner_role: string
          provider: string
          status?: string
          steps: Json
          title: string
          updated_at?: string
          version: number
        }
        Update: {
          created_at?: string
          guide_key?: string
          id?: string
          last_verified_at?: string
          official_url?: string
          owner_role?: string
          provider?: string
          status?: string
          steps?: Json
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      platform_provisioned_resources: {
        Row: {
          created_at: string
          display_name: string
          environment: string
          external_id: string
          id: string
          last_verified_at: string | null
          metadata: Json
          provider: string
          resource_kind: string
          run_id: string
          state: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          environment: string
          external_id: string
          id?: string
          last_verified_at?: string | null
          metadata?: Json
          provider: string
          resource_kind: string
          run_id: string
          state?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          environment?: string
          external_id?: string
          id?: string
          last_verified_at?: string | null
          metadata?: Json
          provider?: string
          resource_kind?: string
          run_id?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_provisioned_resources_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "platform_onboarding_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_rate_plans: {
        Row: {
          created_at: string
          effective_at: string
          id: string
          plan_key: string
          status: string
          terms: Json
          version: string
        }
        Insert: {
          created_at?: string
          effective_at: string
          id?: string
          plan_key: string
          status?: string
          terms: Json
          version: string
        }
        Update: {
          created_at?: string
          effective_at?: string
          id?: string
          plan_key?: string
          status?: string
          terms?: Json
          version?: string
        }
        Relationships: []
      }
      prep_batches: {
        Row: {
          assigned_to: string | null
          brand_id: string
          completed_at: string | null
          created_at: string
          id: string
          location_id: string
          produced_qty: number
          recipe_id: string
          service_date: string
          started_at: string | null
          status: "pending" | "in_progress" | "done" | "abandoned"
          target_qty: number
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          brand_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          location_id: string
          produced_qty?: number
          recipe_id: string
          service_date: string
          started_at?: string | null
          status?: "pending" | "in_progress" | "done" | "abandoned"
          target_qty: number
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          brand_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          location_id?: string
          produced_qty?: number
          recipe_id?: string
          service_date?: string
          started_at?: string | null
          status?: "pending" | "in_progress" | "done" | "abandoned"
          target_qty?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prep_batches_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prep_batches_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prep_batches_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      push_tokens: {
        Row: {
          brand_id: string
          created_at: string
          customer_id: string
          id: string
          platform: string
          token: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          customer_id: string
          id?: string
          platform?: string
          token: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          customer_id?: string
          id?: string
          platform?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_tokens_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_tokens_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      recipes: {
        Row: {
          active_from: string
          allergens: string[]
          brand_id: string
          created_at: string
          id: string
          menu_item_id: string
          notes: string
          steps: Json
          updated_at: string
          version: number
          yield_qty: number
          yield_unit: string
        }
        Insert: {
          active_from?: string
          allergens?: string[]
          brand_id: string
          created_at?: string
          id?: string
          menu_item_id: string
          notes?: string
          steps?: Json
          updated_at?: string
          version?: number
          yield_qty?: number
          yield_unit?: string
        }
        Update: {
          active_from?: string
          allergens?: string[]
          brand_id?: string
          created_at?: string
          id?: string
          menu_item_id?: string
          notes?: string
          steps?: Json
          updated_at?: string
          version?: number
          yield_qty?: number
          yield_unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipes_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          brand_id: string
          claimed_at: string | null
          code: string
          created_at: string
          id: string
          referred_customer_id: string | null
          referrer_customer_id: string
          status: string
        }
        Insert: {
          brand_id: string
          claimed_at?: string | null
          code: string
          created_at?: string
          id?: string
          referred_customer_id?: string | null
          referrer_customer_id: string
          status?: string
        }
        Update: {
          brand_id?: string
          claimed_at?: string | null
          code?: string
          created_at?: string
          id?: string
          referred_customer_id?: string | null
          referrer_customer_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "referrals_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referred_customer_id_fkey"
            columns: ["referred_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referrer_customer_id_fkey"
            columns: ["referrer_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          brand_id: string
          brand_user_id: string
          created_at: string
          ends_at: string
          id: string
          location_id: string
          note: string
          starts_at: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          brand_user_id: string
          created_at?: string
          ends_at: string
          id?: string
          location_id: string
          note?: string
          starts_at: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          brand_user_id?: string
          created_at?: string
          ends_at?: string
          id?: string
          location_id?: string
          note?: string
          starts_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shifts_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_location_brand_fkey"
            columns: ["location_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "shifts_member_brand_fkey"
            columns: ["brand_user_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "brand_users"
            referencedColumns: ["id", "brand_id"]
          },
        ]
      }
      square_connections: {
        Row: {
          access_token_encrypted: string
          brand_id: string
          created_at: string
          expires_at: string
          id: string
          location_id: string
          merchant_id: string
          refresh_token_encrypted: string
          square_location_id: string | null
          updated_at: string
        }
        Insert: {
          access_token_encrypted: string
          brand_id: string
          created_at?: string
          expires_at: string
          id?: string
          location_id: string
          merchant_id: string
          refresh_token_encrypted: string
          square_location_id?: string | null
          updated_at?: string
        }
        Update: {
          access_token_encrypted?: string
          brand_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          location_id?: string
          merchant_id?: string
          refresh_token_encrypted?: string
          square_location_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "square_connections_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "square_connections_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: true
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      stored_value_ledger: {
        Row: {
          amount_cents: number
          balance_after_cents: number
          brand_id: string
          created_at: string
          customer_id: string
          id: string
          note: string
          order_id: string | null
          type: string
        }
        Insert: {
          amount_cents: number
          balance_after_cents: number
          brand_id: string
          created_at?: string
          customer_id: string
          id?: string
          note?: string
          order_id?: string | null
          type: string
        }
        Update: {
          amount_cents?: number
          balance_after_cents?: number
          brand_id?: string
          created_at?: string
          customer_id?: string
          id?: string
          note?: string
          order_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "stored_value_ledger_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stored_value_ledger_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stored_value_order_fk"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      training_bootstrap_runs: {
        Row: {
          brand_id: string
          created_at: string
          error_code: string | null
          error_detail: Json
          finished_at: string | null
          id: string
          next_attempt_at: string | null
          pipeline_version: string
          profile_fingerprint: string
          progress: number
          requested_by: string | null
          retry_count: number
          stage: string
          started_at: string | null
          status: string
          trigger_kind: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          error_code?: string | null
          error_detail?: Json
          finished_at?: string | null
          id?: string
          next_attempt_at?: string | null
          pipeline_version: string
          profile_fingerprint: string
          progress?: number
          requested_by?: string | null
          retry_count?: number
          stage?: string
          started_at?: string | null
          status?: string
          trigger_kind?: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          error_code?: string | null
          error_detail?: Json
          finished_at?: string | null
          id?: string
          next_attempt_at?: string | null
          pipeline_version?: string
          profile_fingerprint?: string
          progress?: number
          requested_by?: string | null
          retry_count?: number
          stage?: string
          started_at?: string | null
          status?: string
          trigger_kind?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_bootstrap_runs_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_bootstrap_runs_requested_by_brand_id_fkey"
            columns: ["requested_by", "brand_id"]
            isOneToOne: false
            referencedRelation: "brand_users"
            referencedColumns: ["id", "brand_id"]
          },
        ]
      }
      training_competencies: {
        Row: {
          brand_id: string
          competency_key: string
          id: string
          is_active: boolean
          managed_by_config: boolean
          renewal_days: number | null
          title: string
        }
        Insert: {
          brand_id: string
          competency_key: string
          id?: string
          is_active?: boolean
          managed_by_config?: boolean
          renewal_days?: number | null
          title: string
        }
        Update: {
          brand_id?: string
          competency_key?: string
          id?: string
          is_active?: boolean
          managed_by_config?: boolean
          renewal_days?: number | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_competencies_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      training_competency_awards: {
        Row: {
          action_id: string | null
          award_source: string
          awarded_at: string
          awarded_by: string | null
          brand_id: string
          brand_user_id: string
          competency_id: string
          expires_at: string | null
          id: string
          lesson_slug: string | null
          module_slug: string | null
          release_id: string | null
          revoked_at: string | null
          revoked_by: string | null
          verification_reason: string
        }
        Insert: {
          action_id?: string | null
          award_source?: string
          awarded_at?: string
          awarded_by?: string | null
          brand_id: string
          brand_user_id: string
          competency_id: string
          expires_at?: string | null
          id?: string
          lesson_slug?: string | null
          module_slug?: string | null
          release_id?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          verification_reason?: string
        }
        Update: {
          action_id?: string | null
          award_source?: string
          awarded_at?: string
          awarded_by?: string | null
          brand_id?: string
          brand_user_id?: string
          competency_id?: string
          expires_at?: string | null
          id?: string
          lesson_slug?: string | null
          module_slug?: string | null
          release_id?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          verification_reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_awards_competency_brand_fkey"
            columns: ["competency_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "training_competencies"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "training_awards_revoker_brand_fkey"
            columns: ["revoked_by", "brand_id"]
            isOneToOne: false
            referencedRelation: "brand_users"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "training_competency_awards_awarded_by_brand_id_fkey"
            columns: ["awarded_by", "brand_id"]
            isOneToOne: false
            referencedRelation: "brand_users"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "training_competency_awards_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_competency_awards_brand_user_id_brand_id_fkey"
            columns: ["brand_user_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "brand_users"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "training_competency_awards_release_id_brand_id_fkey"
            columns: ["release_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "training_releases"
            referencedColumns: ["id", "brand_id"]
          },
        ]
      }
      training_lesson_progress: {
        Row: {
          attempt_count: number
          brand_id: string
          brand_user_id: string
          completed_at: string | null
          created_at: string
          id: string
          lesson_slug: string
          module_slug: string
          release_id: string
          score: number | null
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          brand_id: string
          brand_user_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          lesson_slug: string
          module_slug: string
          release_id: string
          score?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          brand_id?: string
          brand_user_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          lesson_slug?: string
          module_slug?: string
          release_id?: string
          score?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_lesson_progress_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_lesson_progress_brand_user_id_brand_id_fkey"
            columns: ["brand_user_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "brand_users"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "training_lesson_progress_release_id_brand_id_fkey"
            columns: ["release_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "training_releases"
            referencedColumns: ["id", "brand_id"]
          },
        ]
      }
      training_quiz_attempts: {
        Row: {
          answers: Json
          brand_id: string
          brand_user_id: string
          created_at: string
          id: string
          lesson_slug: string
          module_slug: string
          passed: boolean
          release_id: string
          score: number
        }
        Insert: {
          answers: Json
          brand_id: string
          brand_user_id: string
          created_at?: string
          id: string
          lesson_slug: string
          module_slug: string
          passed: boolean
          release_id: string
          score: number
        }
        Update: {
          answers?: Json
          brand_id?: string
          brand_user_id?: string
          created_at?: string
          id?: string
          lesson_slug?: string
          module_slug?: string
          passed?: boolean
          release_id?: string
          score?: number
        }
        Relationships: [
          {
            foreignKeyName: "training_quiz_attempts_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_quiz_attempts_brand_user_id_brand_id_fkey"
            columns: ["brand_user_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "brand_users"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "training_quiz_attempts_release_id_brand_id_fkey"
            columns: ["release_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "training_releases"
            referencedColumns: ["id", "brand_id"]
          },
        ]
      }
      training_release_events: {
        Row: {
          brand_id: string
          created_at: string
          event_type: string
          id: string
          published_at: string
          release_id: string
          version: number
        }
        Insert: {
          brand_id: string
          created_at?: string
          event_type?: string
          id?: string
          published_at: string
          release_id: string
          version: number
        }
        Update: {
          brand_id?: string
          created_at?: string
          event_type?: string
          id?: string
          published_at?: string
          release_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "training_release_events_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_release_events_release_id_brand_id_fkey"
            columns: ["release_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "training_releases"
            referencedColumns: ["id", "brand_id"]
          },
        ]
      }
      training_releases: {
        Row: {
          answer_key: Json
          base_release_id: string | null
          bootstrap_run_id: string | null
          brand_id: string
          created_at: string
          created_by: string | null
          id: string
          manifest: Json
          published_at: string | null
          status: string
          template_key: string | null
          template_version: number | null
          updated_at: string
          updated_by: string | null
          validated_at: string | null
          version: number
        }
        Insert: {
          answer_key?: Json
          base_release_id?: string | null
          bootstrap_run_id?: string | null
          brand_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          manifest?: Json
          published_at?: string | null
          status?: string
          template_key?: string | null
          template_version?: number | null
          updated_at?: string
          updated_by?: string | null
          validated_at?: string | null
          version: number
        }
        Update: {
          answer_key?: Json
          base_release_id?: string | null
          bootstrap_run_id?: string | null
          brand_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          manifest?: Json
          published_at?: string | null
          status?: string
          template_key?: string | null
          template_version?: number | null
          updated_at?: string
          updated_by?: string | null
          validated_at?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "training_releases_bootstrap_run_id_brand_id_fkey"
            columns: ["bootstrap_run_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "training_bootstrap_runs"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "training_releases_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_releases_created_by_brand_id_fkey"
            columns: ["created_by", "brand_id"]
            isOneToOne: false
            referencedRelation: "brand_users"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "training_releases_updated_by_brand_id_fkey"
            columns: ["updated_by", "brand_id"]
            isOneToOne: false
            referencedRelation: "brand_users"
            referencedColumns: ["id", "brand_id"]
          },
        ]
      }
      training_templates: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          industry: string
          locale: string
          manifest: Json
          status: string
          template_key: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          industry: string
          locale?: string
          manifest: Json
          status?: string
          template_key: string
          updated_at?: string
          version: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          industry?: string
          locale?: string
          manifest?: Json
          status?: string
          template_key?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      webhook_events: {
        Row: {
          error: string | null
          event_id: string | null
          id: string
          payload: Json
          processed_at: string | null
          provider: string
          received_at: string
        }
        Insert: {
          error?: string | null
          event_id?: string | null
          id?: string
          payload?: Json
          processed_at?: string | null
          provider?: string
          received_at?: string
        }
        Update: {
          error?: string | null
          event_id?: string | null
          id?: string
          payload?: Json
          processed_at?: string | null
          provider?: string
          received_at?: string
        }
        Relationships: []
      }
      workforce_profiles: {
        Row: {
          brand_id: string
          brand_user_id: string
          created_at: string
          job_title: string
          updated_at: string
          worker_type: string
        }
        Insert: {
          brand_id: string
          brand_user_id: string
          created_at?: string
          job_title?: string
          updated_at?: string
          worker_type?: string
        }
        Update: {
          brand_id?: string
          brand_user_id?: string
          created_at?: string
          job_title?: string
          updated_at?: string
          worker_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "workforce_profiles_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workforce_profiles_brand_user_id_brand_id_fkey"
            columns: ["brand_user_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "brand_users"
            referencedColumns: ["id", "brand_id"]
          },
        ]
      }
      workforce_role_assignments: {
        Row: {
          brand_id: string
          brand_user_id: string
          created_at: string
          id: string
          location_id: string | null
          workforce_role_id: string
        }
        Insert: {
          brand_id: string
          brand_user_id: string
          created_at?: string
          id?: string
          location_id?: string | null
          workforce_role_id: string
        }
        Update: {
          brand_id?: string
          brand_user_id?: string
          created_at?: string
          id?: string
          location_id?: string | null
          workforce_role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workforce_role_assignments_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workforce_role_assignments_brand_user_id_brand_id_fkey"
            columns: ["brand_user_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "brand_users"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "workforce_role_assignments_location_id_brand_id_fkey"
            columns: ["location_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id", "brand_id"]
          },
          {
            foreignKeyName: "workforce_role_assignments_workforce_role_id_brand_id_fkey"
            columns: ["workforce_role_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "workforce_roles"
            referencedColumns: ["id", "brand_id"]
          },
        ]
      }
      workforce_roles: {
        Row: {
          brand_id: string
          created_at: string
          description: string
          id: string
          is_active: boolean
          managed_by_operations_config: boolean
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          description?: string
          id?: string
          is_active?: boolean
          managed_by_operations_config?: boolean
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          description?: string
          id?: string
          is_active?: boolean
          managed_by_operations_config?: boolean
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workforce_roles_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      board_tickets: {
        Row: {
          arrived_at: string | null
          brand_id: string | null
          channel: "app" | "web" | "kiosk" | "pos" | null
          daily_number: number | null
          fulfillment_type:
            | "pickup"
            | "curbside"
            | "catering"
            | "delivery"
            | null
          guest_label: string | null
          id: string | null
          location_id: string | null
          loyalty_tier: string | null
          status:
            | "created"
            | "paid"
            | "in_progress"
            | "ready"
            | "picked_up"
            | "cancelled"
            | "refunded"
            | null
          updated_at: string | null
        }
        Relationships: []
      }
      brand_daily_metrics: {
        Row: {
          aov_cents: number | null
          brand_id: string | null
          day: string | null
          in_app_share: number | null
          loyalty_redemption_rate: number | null
          orders_count: number | null
          revenue_cents: number | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_storefront: {
        Row: {
          brand_config: Json | null
          catering: boolean | null
          delivery: boolean | null
          drops: boolean | null
          id: string | null
          multi_location: boolean | null
          name: string | null
          referrals: boolean | null
          slug: string | null
          sms: boolean | null
          stored_value: boolean | null
        }
        Relationships: []
      }
      drop_performance: {
        Row: {
          brand_id: string | null
          drop_id: string | null
          ends_at: string | null
          item_id: string | null
          orders_count: number | null
          revenue_cents: number | null
          starts_at: string | null
          status: string | null
        }
        Relationships: [
          {
            foreignKeyName: "drops_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drops_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      location_daily_metrics: {
        Row: {
          aov_cents: number | null
          brand_id: string | null
          day: string | null
          in_app_share: number | null
          location_id: string | null
          loyalty_redemption_rate: number | null
          orders_count: number | null
          revenue_by_channel: Json | null
          revenue_cents: number | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      location_square_status: {
        Row: {
          brand_id: string | null
          expires_at: string | null
          location_id: string | null
          merchant_id: string | null
        }
        Relationships: []
      }
      loyalty_standing: {
        Row: {
          annual_points: number | null
          brand_id: string | null
          customer_id: string | null
          lifetime_points: number | null
          points_balance: number | null
        }
        Insert: {
          annual_points?: never
          brand_id?: string | null
          customer_id?: string | null
          lifetime_points?: number | null
          points_balance?: number | null
        }
        Update: {
          annual_points?: never
          brand_id?: string | null
          customer_id?: string | null
          lifetime_points?: number | null
          points_balance?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_accounts_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_accounts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      anonymize_customer_account: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      apply_operation_retention: {
        Args: { target_now?: string }
        Returns: Json
      }
      claim_operation_notification_batch: {
        Args: { target_limit?: number }
        Returns: {
          attempt_count: number
          available_at: string
          brand_id: string
          channel: string
          created_at: string
          escalation_rule_id: string
          id: string
          last_error: string | null
          location_id: string
          occurrence_id: string
          recipient_id: string
          sent_at: string | null
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "operation_notification_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_operation_occurrence: {
        Args: { target_action_id: string; target_occurrence: string }
        Returns: {
          brand_id: string
          claim_expires_at: string | null
          claimed_at: string | null
          claimed_by: string | null
          completed_at: string | null
          completion_note: string
          created_at: string
          due_at: string
          grace_minutes: number
          id: string
          location_id: string
          materialization_key: string
          schedule_id: string | null
          scheduled_for: string
          source: string
          status:
            | "upcoming"
            | "due"
            | "claimed"
            | "completed"
            | "overdue"
            | "waived"
            | "cancelled"
          template_id: string
          template_snapshot: Json
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "operation_occurrences"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_refund_request: {
        Args: {
          p_brand_id: string
          p_order_id: string
          p_refund_cents: number
          p_refund_request_key: string
          p_requested_amount: Json
          p_square_refund_id: string
        }
        Returns: {
          actor_user_id: string | null
          brand_id: string
          created_at: string
          id: string
          order_id: string
          refund_cents: number | null
          refund_request_key: string | null
          snapshot: Json
          source: string
          square_event_id: string | null
          square_refund_id: string | null
          type:
            | "created"
            | "paid"
            | "in_progress"
            | "ready"
            | "picked_up"
            | "cancelled"
            | "refunded"
        }
        SetofOptions: {
          from: "*"
          to: "order_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      commit_order: {
        Args: {
          p_actor_user_id: string
          p_brand_id: string
          p_channel: "app" | "web" | "kiosk" | "pos"
          p_client_key: string
          p_customer_id: string
          p_device_id: string
          p_fulfillment_type: "pickup" | "curbside" | "catering" | "delivery"
          p_guest_label: string
          p_location_id: string
          p_note: string
          p_request_fingerprint: string
          p_scheduled_for: string
          p_subtotal_cents: number
          p_tax_cents: number
          p_tender_type: string
          p_tip_cents: number
          p_total_cents: number
          p_totals: Json
        }
        Returns: Json
      }
      complete_operation_occurrence: {
        Args: {
          target_action_id: string
          target_issues?: Json
          target_note?: string
          target_occurrence: string
          target_responses: Json
        }
        Returns: {
          brand_id: string
          claim_expires_at: string | null
          claimed_at: string | null
          claimed_by: string | null
          completed_at: string | null
          completion_note: string
          created_at: string
          due_at: string
          grace_minutes: number
          id: string
          location_id: string
          materialization_key: string
          schedule_id: string | null
          scheduled_for: string
          source: string
          status:
            | "upcoming"
            | "due"
            | "claimed"
            | "completed"
            | "overdue"
            | "waived"
            | "cancelled"
          template_id: string
          template_snapshot: Json
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "operation_occurrences"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_manual_operation_occurrence: {
        Args: {
          target_action_id: string
          target_due_window_minutes?: number
          target_location: string
          target_scheduled_for?: string
          target_template: string
        }
        Returns: {
          brand_id: string
          claim_expires_at: string | null
          claimed_at: string | null
          claimed_by: string | null
          completed_at: string | null
          completion_note: string
          created_at: string
          due_at: string
          grace_minutes: number
          id: string
          location_id: string
          materialization_key: string
          schedule_id: string | null
          scheduled_for: string
          source: string
          status:
            | "upcoming"
            | "due"
            | "claimed"
            | "completed"
            | "overdue"
            | "waived"
            | "cancelled"
          template_id: string
          template_snapshot: Json
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "operation_occurrences"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_platform_onboarding_run: {
        Args: {
          input_blueprint_id: string
          input_business_name: string
          input_created_by: string
          input_idempotency_key: string
          input_location_name: string
          input_tasks: Json
          input_tenant_slug: string
          input_timezone: string
          input_website_url: string
        }
        Returns: string
      }
      ingest_analytics_batch: {
        Args: {
          batch_key: string
          brand: string
          correlation: string
          events: Json
          surface: string
        }
        Returns: Json
      }
      loyalty_adjust: {
        Args: { account: string; delta: number }
        Returns: number
      }
      loyalty_record_earn: {
        Args: {
          earned_points: number
          target_brand: string
          target_customer: string
          target_order: string
        }
        Returns: number
      }
      loyalty_reverse_earn: {
        Args: {
          cause_key: string
          order_total_cents: number
          refunded_cents: number
          target_brand: string
          target_customer: string
          target_order: string
        }
        Returns: number
      }
      loyalty_spend: {
        Args: { account: string; cost: number }
        Returns: number
      }
      mark_order_arrived: { Args: { target_order: string }; Returns: string }
      platform_release_readiness: { Args: never; Returns: string }
      process_square_refund: {
        Args: {
          refunded_cents: number
          square_event: string
          square_event_type: string
          square_refund: string
          target_order: string
        }
        Returns: boolean
      }
      prune_analytics_retention: {
        Args: {
          daily_before: string
          hourly_before: string
          raw_before: string
        }
        Returns: Json
      }
      publish_manual_training_release: {
        Args: {
          expected_updated_at: string
          target_brand: string
          target_editor: string
          target_release: string
        }
        Returns: string
      }
      publish_training_release: {
        Args: {
          release_answer_key: Json
          release_manifest: Json
          target_brand: string
          target_run: string
        }
        Returns: string
      }
      refresh_analytics_rollups: {
        Args: { rebuild_from?: string }
        Returns: Json
      }
      register_square_connector: {
        Args: {
          legacy_connection: string
          plaintext_secret: string
          target_actor: string
          target_brand: string
          target_expires_at: string
          target_location: string
          target_merchant: string
          target_square_location: string
        }
        Returns: string
      }
      release_operation_occurrence: {
        Args: { target_action_id: string; target_occurrence: string }
        Returns: {
          brand_id: string
          claim_expires_at: string | null
          claimed_at: string | null
          claimed_by: string | null
          completed_at: string | null
          completion_note: string
          created_at: string
          due_at: string
          grace_minutes: number
          id: string
          location_id: string
          materialization_key: string
          schedule_id: string | null
          scheduled_for: string
          source: string
          status:
            | "upcoming"
            | "due"
            | "claimed"
            | "completed"
            | "overdue"
            | "waived"
            | "cancelled"
          template_id: string
          template_snapshot: Json
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "operation_occurrences"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      report_operation_issue: {
        Args: {
          target_action_id: string
          target_category: string
          target_description: string
          target_occurrence: string
          target_severity: string
          target_step_key?: string
        }
        Returns: {
          brand_id: string
          category: string
          created_at: string
          description: string
          id: string
          location_id: string
          occurrence_id: string
          reported_by: string | null
          resolution: string
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          status: string
          step_key: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "operation_issues"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolve_connector_secret: {
        Args: { target_brand: string; target_reference: string }
        Returns: string
      }
      resolve_operation_issue: {
        Args: {
          target_action_id: string
          target_issue: string
          target_resolution: string
        }
        Returns: {
          brand_id: string
          category: string
          created_at: string
          description: string
          id: string
          location_id: string
          occurrence_id: string
          reported_by: string | null
          resolution: string
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          status: string
          step_key: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "operation_issues"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolve_order_replay: {
        Args: {
          p_brand_id: string
          p_client_key: string
          p_request_fingerprint: string
        }
        Returns: Json
      }
      revoke_connector_secret: {
        Args: { target_brand: string; target_reference: string }
        Returns: boolean
      }
      run_operation_maintenance: {
        Args: { target_horizon_hours?: number; target_now?: string }
        Returns: Json
      }
      set_brand_settings_config: {
        Args: { config: Json; expected_updated_at?: string }
        Returns: string
      }
      store_connector_secret: {
        Args: {
          plaintext_secret: string
          target_account_label?: string
          target_brand: string
          target_expires_at?: string
          target_provider_key: string
          target_scopes?: string[]
        }
        Returns: string
      }
      store_training_profile: {
        Args: { target_brand: string; tenant_profile: Json }
        Returns: undefined
      }
      update_operation_issue: {
        Args: {
          target_action_id: string
          target_issue: string
          target_resolution?: string
          target_status: string
        }
        Returns: {
          brand_id: string
          category: string
          created_at: string
          description: string
          id: string
          location_id: string
          occurrence_id: string
          reported_by: string | null
          resolution: string
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          status: string
          step_key: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "operation_issues"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      waive_operation_occurrence: {
        Args: {
          target_action_id: string
          target_occurrence: string
          target_reason: string
        }
        Returns: {
          brand_id: string
          claim_expires_at: string | null
          claimed_at: string | null
          claimed_by: string | null
          completed_at: string | null
          completion_note: string
          created_at: string
          due_at: string
          grace_minutes: number
          id: string
          location_id: string
          materialization_key: string
          schedule_id: string | null
          scheduled_for: string
          source: string
          status:
            | "upcoming"
            | "due"
            | "claimed"
            | "completed"
            | "overdue"
            | "waived"
            | "cancelled"
          template_id: string
          template_snapshot: Json
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "operation_occurrences"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  storage: {
    Tables: {
      buckets: {
        Row: {
          allowed_mime_types: string[] | null
          avif_autodetection: boolean | null
          created_at: string | null
          file_size_limit: number | null
          id: string
          name: string
          owner: string | null
          owner_id: string | null
          public: boolean | null
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string | null
          versioning_status: string
        }
        Insert: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id: string
          name: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
          versioning_status?: string
        }
        Update: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id?: string
          name?: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
          versioning_status?: string
        }
        Relationships: []
      }
      buckets_analytics: {
        Row: {
          created_at: string
          deleted_at: string | null
          format: string
          id: string
          name: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      buckets_vectors: {
        Row: {
          created_at: string
          id: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      iceberg_namespaces: {
        Row: {
          bucket_name: string
          catalog_id: string
          created_at: string
          id: string
          metadata: Json
          name: string
          updated_at: string
        }
        Insert: {
          bucket_name: string
          catalog_id: string
          created_at?: string
          id?: string
          metadata?: Json
          name: string
          updated_at?: string
        }
        Update: {
          bucket_name?: string
          catalog_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_namespaces_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
        ]
      }
      iceberg_tables: {
        Row: {
          bucket_name: string
          catalog_id: string
          created_at: string
          id: string
          location: string
          name: string
          namespace_id: string
          remote_table_id: string | null
          shard_id: string | null
          shard_key: string | null
          updated_at: string
        }
        Insert: {
          bucket_name: string
          catalog_id: string
          created_at?: string
          id?: string
          location: string
          name: string
          namespace_id: string
          remote_table_id?: string | null
          shard_id?: string | null
          shard_key?: string | null
          updated_at?: string
        }
        Update: {
          bucket_name?: string
          catalog_id?: string
          created_at?: string
          id?: string
          location?: string
          name?: string
          namespace_id?: string
          remote_table_id?: string | null
          shard_id?: string | null
          shard_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_tables_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "iceberg_tables_namespace_id_fkey"
            columns: ["namespace_id"]
            isOneToOne: false
            referencedRelation: "iceberg_namespaces"
            referencedColumns: ["id"]
          },
        ]
      }
      migrations: {
        Row: {
          executed_at: string | null
          hash: string
          id: number
          name: string
        }
        Insert: {
          executed_at?: string | null
          hash: string
          id: number
          name: string
        }
        Update: {
          executed_at?: string | null
          hash?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      objects: {
        Row: {
          archived_at: string | null
          bucket_id: string | null
          created_at: string | null
          id: string
          is_delete_marker: boolean
          is_versioned: boolean
          last_accessed_at: string | null
          metadata: Json | null
          name: string | null
          owner: string | null
          owner_id: string | null
          path_tokens: string[] | null
          updated_at: string | null
          user_metadata: Json | null
          version: string | null
        }
        Insert: {
          archived_at?: string | null
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          is_delete_marker?: boolean
          is_versioned?: boolean
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Update: {
          archived_at?: string | null
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          is_delete_marker?: boolean
          is_versioned?: boolean
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "objects_bucketId_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads: {
        Row: {
          bucket_id: string
          created_at: string
          id: string
          in_progress_size: number
          key: string
          metadata: Json | null
          owner_id: string | null
          upload_signature: string
          user_metadata: Json | null
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          id: string
          in_progress_size?: number
          key: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature: string
          user_metadata?: Json | null
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          id?: string
          in_progress_size?: number
          key?: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature?: string
          user_metadata?: Json | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads_parts: {
        Row: {
          bucket_id: string
          created_at: string
          etag: string
          id: string
          key: string
          owner_id: string | null
          part_number: number
          size: number
          upload_id: string
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          etag: string
          id?: string
          key: string
          owner_id?: string | null
          part_number: number
          size?: number
          upload_id: string
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          etag?: string
          id?: string
          key?: string
          owner_id?: string | null
          part_number?: number
          size?: number
          upload_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_parts_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "s3_multipart_uploads_parts_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "s3_multipart_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      vector_indexes: {
        Row: {
          bucket_id: string
          created_at: string
          data_type: string
          dimension: number
          distance_metric: string
          id: string
          metadata_configuration: Json | null
          name: string
          updated_at: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          data_type: string
          dimension: number
          distance_metric: string
          id?: string
          metadata_configuration?: Json | null
          name: string
          updated_at?: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          data_type?: string
          dimension?: number
          distance_metric?: string
          id?: string
          metadata_configuration?: Json | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vector_indexes_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets_vectors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      allow_any_operation: {
        Args: { expected_operations: string[] }
        Returns: boolean
      }
      allow_only_operation: {
        Args: { expected_operation: string }
        Returns: boolean
      }
      can_insert_object: {
        Args: { bucketid: string; metadata: Json; name: string; owner: string }
        Returns: undefined
      }
      extension: { Args: { name: string }; Returns: string }
      filename: { Args: { name: string }; Returns: string }
      foldername: { Args: { name: string }; Returns: string[] }
      get_common_prefix: {
        Args: { p_delimiter: string; p_key: string; p_prefix: string }
        Returns: string
      }
      get_size_by_bucket: {
        Args: never
        Returns: {
          bucket_id: string
          size: number
        }[]
      }
      list_multipart_uploads_with_delimiter: {
        Args: {
          bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_key_token?: string
          next_upload_token?: string
          prefix_param: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
        }[]
      }
      list_objects_with_delimiter: {
        Args: {
          _bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_token?: string
          prefix_param: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      operation: { Args: never; Returns: string }
      search: {
        Args: {
          bucketname: string
          levels?: number
          limits?: number
          offsets?: number
          prefix: string
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_by_timestamp: {
        Args: {
          p_bucket_id: string
          p_level: number
          p_limit: number
          p_prefix: string
          p_sort_column: string
          p_sort_column_after: string
          p_sort_order: string
          p_start_after: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_v2: {
        Args: {
          bucket_name: string
          levels?: number
          limits?: number
          prefix: string
          sort_column?: string
          sort_column_after?: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
    }
    Enums: {
      buckettype: "STANDARD" | "ANALYTICS" | "VECTOR"
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
  storage: {
    Enums: {
      buckettype: ["STANDARD", "ANALYTICS", "VECTOR"],
    },
  },
} as const

