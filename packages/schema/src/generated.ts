export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
      is_brand_owner: { Args: { target_brand: string }; Returns: boolean }
      is_brand_staff: { Args: { target_brand: string }; Returns: boolean }
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
      brand_users: {
        Row: {
          brand_id: string
          created_at: string
          id: string
          location_ids: string[]
          role: Database["app"]["Enums"]["brand_role"]
          user_id: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          id?: string
          location_ids?: string[]
          role: Database["app"]["Enums"]["brand_role"]
          user_id: string
        }
        Update: {
          brand_id?: string
          created_at?: string
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
