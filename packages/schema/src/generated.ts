export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
      prep_status: "pending" | "in_progress" | "done" | "abandoned"
      task_recurrence: "opening" | "closing" | "daily" | "weekly"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
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
          role: Database["app"]["Enums"]["brand_role"]
          user_id: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          display_name?: string
          id?: string
          location_ids?: string[]
          role: Database["app"]["Enums"]["brand_role"]
          user_id: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          display_name?: string
          id?: string
          location_ids?: string[]
          role?: Database["app"]["Enums"]["brand_role"]
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
          channel: Database["app"]["Enums"]["campaign_channel"]
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
          channel: Database["app"]["Enums"]["campaign_channel"]
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
          channel?: Database["app"]["Enums"]["campaign_channel"]
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
          recurrence: Database["app"]["Enums"]["task_recurrence"]
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
          recurrence?: Database["app"]["Enums"]["task_recurrence"]
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
          recurrence?: Database["app"]["Enums"]["task_recurrence"]
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
          role: Database["app"]["Enums"]["device_role"]
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
          role: Database["app"]["Enums"]["device_role"]
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
          role?: Database["app"]["Enums"]["device_role"]
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
          brand_id: string
          created_at: string
          id: string
          menu_id: string
          sort_order: number
          tagline: string
          title: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          id?: string
          menu_id: string
          sort_order?: number
          tagline?: string
          title: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          id?: string
          menu_id?: string
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
        ]
      }
      menu_items: {
        Row: {
          availability: Json
          base_price_cents: number
          brand_id: string
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
          rotation: Database["app"]["Enums"]["item_rotation"]
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
          rotation?: Database["app"]["Enums"]["item_rotation"]
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
          rotation?: Database["app"]["Enums"]["item_rotation"]
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
          type: Database["app"]["Enums"]["order_status"]
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
          type: Database["app"]["Enums"]["order_status"]
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
          type?: Database["app"]["Enums"]["order_status"]
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
          channel: Database["app"]["Enums"]["order_channel"]
          client_key: string | null
          created_at: string
          customer_id: string | null
          daily_number: number | null
          device_id: string | null
          fulfillment_type: Database["app"]["Enums"]["fulfillment_type"]
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
          status: Database["app"]["Enums"]["order_status"]
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
          channel?: Database["app"]["Enums"]["order_channel"]
          client_key?: string | null
          created_at?: string
          customer_id?: string | null
          daily_number?: number | null
          device_id?: string | null
          fulfillment_type?: Database["app"]["Enums"]["fulfillment_type"]
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
          status?: Database["app"]["Enums"]["order_status"]
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
          channel?: Database["app"]["Enums"]["order_channel"]
          client_key?: string | null
          created_at?: string
          customer_id?: string | null
          daily_number?: number | null
          device_id?: string | null
          fulfillment_type?: Database["app"]["Enums"]["fulfillment_type"]
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
          status?: Database["app"]["Enums"]["order_status"]
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
          status: Database["app"]["Enums"]["prep_status"]
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
          status?: Database["app"]["Enums"]["prep_status"]
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
          status?: Database["app"]["Enums"]["prep_status"]
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
            foreignKeyName: "shifts_brand_user_id_fkey"
            columns: ["brand_user_id"]
            isOneToOne: false
            referencedRelation: "brand_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
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
          channel: Database["app"]["Enums"]["order_channel"] | null
          daily_number: number | null
          fulfillment_type: Database["app"]["Enums"]["fulfillment_type"] | null
          guest_label: string | null
          id: string | null
          location_id: string | null
          loyalty_tier: string | null
          status: Database["app"]["Enums"]["order_status"] | null
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
          type: Database["app"]["Enums"]["order_status"]
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
          p_channel: Database["app"]["Enums"]["order_channel"]
          p_client_key: string
          p_customer_id: string
          p_device_id: string
          p_fulfillment_type: Database["app"]["Enums"]["fulfillment_type"]
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
      resolve_order_replay: {
        Args: {
          p_brand_id: string
          p_client_key: string
          p_request_fingerprint: string
        }
        Returns: Json
      }
      set_brand_settings_config: {
        Args: { config: Json; expected_updated_at?: string }
        Returns: string
      }
      store_training_profile: {
        Args: { target_brand: string; tenant_profile: Json }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
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
  app: {
    Enums: {
      brand_role: [
        "platform_admin",
        "brand_owner",
        "location_manager",
        "staff",
      ],
      campaign_channel: ["push", "sms", "email"],
      device_role: ["kiosk", "pos", "display", "prep"],
      fulfillment_type: ["pickup", "curbside", "catering", "delivery"],
      item_rotation: ["permanent", "rotating", "day_specific"],
      order_channel: ["app", "web", "kiosk", "pos"],
      order_status: [
        "created",
        "paid",
        "in_progress",
        "ready",
        "picked_up",
        "cancelled",
        "refunded",
      ],
      prep_status: ["pending", "in_progress", "done", "abandoned"],
      task_recurrence: ["opening", "closing", "daily", "weekly"],
    },
  },
  public: {
    Enums: {},
  },
} as const
