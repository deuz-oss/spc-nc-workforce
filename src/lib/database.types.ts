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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          at: string
          details: Json
          id: number
          target_id: string | null
          target_type: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          at?: string
          details?: Json
          id?: never
          target_id?: string | null
          target_type: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          at?: string
          details?: Json
          id?: never
          target_id?: string | null
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      attendances: {
        Row: {
          auto_closed: boolean
          clock_in_at: string
          clock_in_lat: number
          clock_in_lng: number
          clock_out_at: string | null
          clock_out_lat: number | null
          clock_out_lng: number | null
          created_at: string
          geo_fence_ok: boolean
          id: string
          location_mocked: boolean
          non_market_ms: number | null
          user_id: string
        }
        Insert: {
          auto_closed?: boolean
          clock_in_at?: string
          clock_in_lat: number
          clock_in_lng: number
          clock_out_at?: string | null
          clock_out_lat?: number | null
          clock_out_lng?: number | null
          created_at?: string
          geo_fence_ok: boolean
          id: string
          location_mocked?: boolean
          non_market_ms?: number | null
          user_id: string
        }
        Update: {
          auto_closed?: boolean
          clock_in_at?: string
          clock_in_lat?: number
          clock_in_lng?: number
          clock_out_at?: string | null
          clock_out_lat?: number | null
          clock_out_lng?: number | null
          created_at?: string
          geo_fence_ok?: boolean
          id?: string
          location_mocked?: boolean
          non_market_ms?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendances_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      certifications: {
        Row: {
          cert_type: string
          date: string
          id: string
          passed: boolean
          user_id: string
        }
        Insert: {
          cert_type: string
          date: string
          id: string
          passed: boolean
          user_id: string
        }
        Update: {
          cert_type?: string
          date?: string
          id?: string
          passed?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "certifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      client_errors: {
        Row: {
          app_version: string | null
          at: string
          context: string | null
          id: number
          message: string
          platform: string | null
          stack: string | null
          user_id: string | null
        }
        Insert: {
          app_version?: string | null
          at?: string
          context?: string | null
          id?: never
          message: string
          platform?: string | null
          stack?: string | null
          user_id?: string | null
        }
        Update: {
          app_version?: string | null
          at?: string
          context?: string | null
          id?: never
          message?: string
          platform?: string | null
          stack?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_errors_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coaching_logs: {
        Row: {
          created_at: string
          date: string
          id: string
          nc_id: string
          note: string
          tl_id: string
        }
        Insert: {
          created_at?: string
          date: string
          id: string
          nc_id: string
          note: string
          tl_id: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          nc_id?: string
          note?: string
          tl_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coaching_logs_nc_id_fkey"
            columns: ["nc_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coaching_logs_tl_id_fkey"
            columns: ["tl_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      consumers: {
        Row: {
          child_age_bracket: string | null
          consent: boolean
          consent_at: string | null
          consent_by: string | null
          consent_version: string | null
          created_at: string
          created_by_nc_id: string | null
          current_brand: string | null
          current_stage: string | null
          current_stage_at: string | null
          erased_at: string | null
          id: string
          name: string
          quiz_result: string | null
          wa_contact: string
          wa_normalized: string | null
        }
        Insert: {
          child_age_bracket?: string | null
          consent?: boolean
          consent_at?: string | null
          consent_by?: string | null
          consent_version?: string | null
          created_at?: string
          created_by_nc_id?: string | null
          current_brand?: string | null
          current_stage?: string | null
          current_stage_at?: string | null
          erased_at?: string | null
          id: string
          name: string
          quiz_result?: string | null
          wa_contact?: string
          wa_normalized?: string | null
        }
        Update: {
          child_age_bracket?: string | null
          consent?: boolean
          consent_at?: string | null
          consent_by?: string | null
          consent_version?: string | null
          created_at?: string
          created_by_nc_id?: string | null
          current_brand?: string | null
          current_stage?: string | null
          current_stage_at?: string | null
          erased_at?: string | null
          id?: string
          name?: string
          quiz_result?: string | null
          wa_contact?: string
          wa_normalized?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consumers_consent_by_fkey"
            columns: ["consent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumers_created_by_nc_id_fkey"
            columns: ["created_by_nc_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          participant_a: string
          participant_b: string
          type: string
        }
        Insert: {
          created_at?: string
          id: string
          participant_a: string
          participant_b: string
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          participant_a?: string
          participant_b?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_participant_a_fkey"
            columns: ["participant_a"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_participant_b_fkey"
            columns: ["participant_b"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          id: string
          read_at: string | null
          sender_id: string
        }
        Insert: {
          body: string
          conversation_id: string
          created_at?: string
          id: string
          read_at?: string | null
          sender_id: string
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ntg_gwp: {
        Row: {
          consumer_id: string
          created_at: string
          gwp_item: string | null
          gwp_qty: number | null
          id: string
          offtake_id: string | null
          received_at: string
          stage: string
          visit_id: string
        }
        Insert: {
          consumer_id: string
          created_at?: string
          gwp_item?: string | null
          gwp_qty?: number | null
          id: string
          offtake_id?: string | null
          received_at?: string
          stage: string
          visit_id: string
        }
        Update: {
          consumer_id?: string
          created_at?: string
          gwp_item?: string | null
          gwp_qty?: number | null
          id?: string
          offtake_id?: string | null
          received_at?: string
          stage?: string
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ntg_gwp_consumer_id_fkey"
            columns: ["consumer_id"]
            isOneToOne: false
            referencedRelation: "consumers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ntg_gwp_offtake_id_fkey"
            columns: ["offtake_id"]
            isOneToOne: false
            referencedRelation: "offtake"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ntg_gwp_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      offtake: {
        Row: {
          created_at: string
          id: string
          is_outlier: boolean
          received_at: string
          revenue: number | null
          sku: string
          store_id: string
          units_sold: number
          visit_id: string
        }
        Insert: {
          created_at?: string
          id: string
          is_outlier?: boolean
          received_at?: string
          revenue?: number | null
          sku: string
          store_id: string
          units_sold: number
          visit_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_outlier?: boolean
          received_at?: string
          revenue?: number | null
          sku?: string
          store_id?: string
          units_sold?: number
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "offtake_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offtake_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      paid_visibility: {
        Row: {
          compliance_checklist: Json
          created_at: string
          id: string
          photo_url: string
          received_at: string
          store_id: string
          visibility_type: string
          visit_id: string
        }
        Insert: {
          compliance_checklist?: Json
          created_at?: string
          id: string
          photo_url: string
          received_at?: string
          store_id: string
          visibility_type?: string
          visit_id: string
        }
        Update: {
          compliance_checklist?: Json
          created_at?: string
          id?: string
          photo_url?: string
          received_at?: string
          store_id?: string
          visibility_type?: string
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "paid_visibility_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paid_visibility_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      price_monitoring: {
        Row: {
          competitor_prices: number[]
          created_at: string
          id: string
          own_price: number
          photo_url: string | null
          received_at: string
          sku: string
          store_id: string
          visit_id: string
        }
        Insert: {
          competitor_prices?: number[]
          created_at?: string
          id: string
          own_price: number
          photo_url?: string | null
          received_at?: string
          sku: string
          store_id: string
          visit_id: string
        }
        Update: {
          competitor_prices?: number[]
          created_at?: string
          id?: string
          own_price?: number
          photo_url?: string | null
          received_at?: string
          sku?: string
          store_id?: string
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_monitoring_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_monitoring_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          category: string | null
          created_at: string
          id: string
          name: string
          sku: string
        }
        Insert: {
          active?: boolean
          category?: string | null
          created_at?: string
          id: string
          name: string
          sku: string
        }
        Update: {
          active?: boolean
          category?: string | null
          created_at?: string
          id?: string
          name?: string
          sku?: string
        }
        Relationships: []
      }
      profile_contacts: {
        Row: {
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_contacts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          city: string | null
          created_at: string
          id: string
          name: string
          phone: string | null
          role: string
          team_id: string | null
          username: string
        }
        Insert: {
          active?: boolean
          city?: string | null
          created_at?: string
          id: string
          name: string
          phone?: string | null
          role: string
          team_id?: string | null
          username: string
        }
        Update: {
          active?: boolean
          city?: string | null
          created_at?: string
          id?: string
          name?: string
          phone?: string | null
          role?: string
          team_id?: string | null
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      push_tokens: {
        Row: {
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      report_reviews: {
        Row: {
          id: string
          note: string | null
          report_id: string
          report_type: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          id: string
          note?: string | null
          report_id: string
          report_type: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          id?: string
          note?: string | null
          report_id?: string
          report_type?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_reviews_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      route_points: {
        Row: {
          attendance_id: string
          id: number
          lat: number
          lng: number
          recorded_at: string
          user_id: string
        }
        Insert: {
          attendance_id: string
          id?: never
          lat: number
          lng: number
          recorded_at?: string
          user_id: string
        }
        Update: {
          attendance_id?: string
          id?: never
          lat?: number
          lng?: number
          recorded_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "route_points_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: false
            referencedRelation: "attendances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_points_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      schedules: {
        Row: {
          actual_visit_id: string | null
          id: string
          nc_id: string
          planned_date: string
          store_id: string
        }
        Insert: {
          actual_visit_id?: string | null
          id: string
          nc_id: string
          planned_date: string
          store_id: string
        }
        Update: {
          actual_visit_id?: string | null
          id?: string
          nc_id?: string
          planned_date?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedules_actual_visit_id_fkey"
            columns: ["actual_visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedules_nc_id_fkey"
            columns: ["nc_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedules_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      scorecard_weight_config: {
        Row: {
          kpi_key: string
          role: string
          weight_pct: number
        }
        Insert: {
          kpi_key: string
          role: string
          weight_pct: number
        }
        Update: {
          kpi_key?: string
          role?: string
          weight_pct?: number
        }
        Relationships: []
      }
      scorecards: {
        Row: {
          breakdown: Json
          computed_at: string
          id: string
          period_key: string
          role: string
          score: number
          status: string
          subject_id: string
        }
        Insert: {
          breakdown?: Json
          computed_at?: string
          id: string
          period_key: string
          role: string
          score: number
          status: string
          subject_id: string
        }
        Update: {
          breakdown?: Json
          computed_at?: string
          id?: string
          period_key?: string
          role?: string
          score?: number
          status?: string
          subject_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scorecards_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      share_of_shelf: {
        Row: {
          category: string
          channel: string
          created_at: string
          id: string
          own_facing_count: number
          photo_url: string
          received_at: string
          store_id: string
          total_facing_count: number
          visit_id: string
        }
        Insert: {
          category: string
          channel?: string
          created_at?: string
          id: string
          own_facing_count: number
          photo_url: string
          received_at?: string
          store_id: string
          total_facing_count: number
          visit_id: string
        }
        Update: {
          category?: string
          channel?: string
          created_at?: string
          id?: string
          own_facing_count?: number
          photo_url?: string
          received_at?: string
          store_id?: string
          total_facing_count?: number
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "share_of_shelf_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "share_of_shelf_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_taking: {
        Row: {
          created_at: string
          id: string
          out_of_stock: boolean
          photo_url: string | null
          qty_on_hand: number
          received_at: string
          sku: string
          store_id: string
          visit_id: string
        }
        Insert: {
          created_at?: string
          id: string
          out_of_stock?: boolean
          photo_url?: string | null
          qty_on_hand: number
          received_at?: string
          sku: string
          store_id: string
          visit_id: string
        }
        Update: {
          created_at?: string
          id?: string
          out_of_stock?: boolean
          photo_url?: string | null
          qty_on_hand?: number
          received_at?: string
          sku?: string
          store_id?: string
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_taking_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_taking_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          account: string | null
          address: string
          archived: boolean
          assigned_nc_id: string | null
          category: string
          channel: string
          city: string
          created_at: string
          id: string
          lat: number | null
          lng: number | null
          name: string
          source: string
          team_id: string | null
        }
        Insert: {
          account?: string | null
          address?: string
          archived?: boolean
          assigned_nc_id?: string | null
          category: string
          channel?: string
          city?: string
          created_at?: string
          id: string
          lat?: number | null
          lng?: number | null
          name: string
          source: string
          team_id?: string | null
        }
        Update: {
          account?: string | null
          address?: string
          archived?: boolean
          assigned_nc_id?: string | null
          category?: string
          channel?: string
          city?: string
          created_at?: string
          id?: string
          lat?: number | null
          lng?: number | null
          name?: string
          source?: string
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stores_assigned_nc_id_fkey"
            columns: ["assigned_nc_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stores_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_responses: {
        Row: {
          answers: Json
          consumer_id: string | null
          created_at: string
          id: string
          survey_id: string
          visit_id: string | null
        }
        Insert: {
          answers?: Json
          consumer_id?: string | null
          created_at?: string
          id: string
          survey_id: string
          visit_id?: string | null
        }
        Update: {
          answers?: Json
          consumer_id?: string | null
          created_at?: string
          id?: string
          survey_id?: string
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "survey_responses_consumer_id_fkey"
            columns: ["consumer_id"]
            isOneToOne: false
            referencedRelation: "consumers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_responses_survey_id_fkey"
            columns: ["survey_id"]
            isOneToOne: false
            referencedRelation: "surveys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_responses_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      surveys: {
        Row: {
          campaign_tag: string | null
          created_at: string
          created_by: string
          id: string
          questions: Json
          title: string
        }
        Insert: {
          campaign_tag?: string | null
          created_at?: string
          created_by: string
          id: string
          questions?: Json
          title: string
        }
        Update: {
          campaign_tag?: string | null
          created_at?: string
          created_by?: string
          id?: string
          questions?: Json
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "surveys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      targets: {
        Row: {
          gwp_allocation: number | null
          id: string
          nc_id: string | null
          offtake_target: number | null
          period_key: string
          set_by: string
          store_id: string | null
          updated_at: string
        }
        Insert: {
          gwp_allocation?: number | null
          id: string
          nc_id?: string | null
          offtake_target?: number | null
          period_key: string
          set_by: string
          store_id?: string | null
          updated_at?: string
        }
        Update: {
          gwp_allocation?: number | null
          id?: string
          nc_id?: string | null
          offtake_target?: number | null
          period_key?: string
          set_by?: string
          store_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "targets_nc_id_fkey"
            columns: ["nc_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "targets_set_by_fkey"
            columns: ["set_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "targets_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          arco_id: string | null
          base_lat: number | null
          base_lng: number | null
          base_radius_m: number
          city: string
          created_at: string
          id: string
          name: string
          tl_id: string | null
        }
        Insert: {
          arco_id?: string | null
          base_lat?: number | null
          base_lng?: number | null
          base_radius_m?: number
          city: string
          created_at?: string
          id: string
          name: string
          tl_id?: string | null
        }
        Update: {
          arco_id?: string | null
          base_lat?: number | null
          base_lng?: number | null
          base_radius_m?: number
          city?: string
          created_at?: string
          id?: string
          name?: string
          tl_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "teams_arco_id_fkey"
            columns: ["arco_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_tl_id_fkey"
            columns: ["tl_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      visits: {
        Row: {
          auto_closed: boolean
          check_in_at: string
          check_out_at: string | null
          created_at: string
          geo_valid: boolean
          id: string
          lat: number
          lng: number
          location_mocked: boolean
          nc_id: string
          store_distance_m: number | null
          store_id: string
        }
        Insert: {
          auto_closed?: boolean
          check_in_at?: string
          check_out_at?: string | null
          created_at?: string
          geo_valid: boolean
          id: string
          lat: number
          lng: number
          location_mocked?: boolean
          nc_id: string
          store_distance_m?: number | null
          store_id: string
        }
        Update: {
          auto_closed?: boolean
          check_in_at?: string
          check_out_at?: string | null
          created_at?: string
          geo_valid?: boolean
          id?: string
          lat?: number
          lng?: number
          location_mocked?: boolean
          nc_id?: string
          store_distance_m?: number | null
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visits_nc_id_fkey"
            columns: ["nc_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      audit_changes: {
        Args: { cols: string[]; p_new: Json; p_old: Json }
        Returns: Json
      }
      auto_close_attendance_after: { Args: never; Returns: string }
      auto_close_stale_sessions: { Args: never; Returns: undefined }
      auto_close_visit_after: { Args: never; Returns: string }
      can_converse: {
        Args: { p_a: string; p_b: string; p_type: string }
        Returns: boolean
      }
      can_manage_schedule: { Args: { p_nc_id: string }; Returns: boolean }
      clear_my_push_token: { Args: { p_token: string }; Returns: undefined }
      compute_scorecards: { Args: { p_period_key: string }; Returns: undefined }
      compute_scorecards_core: {
        Args: { p_period_key: string }
        Returns: undefined
      }
      current_arco_team_ids: { Args: never; Returns: string[] }
      current_role: { Args: never; Returns: string }
      current_team_id: { Args: never; Returns: string }
      erase_consumer: { Args: { p_consumer_id: string }; Returns: undefined }
      finish_visit: {
        Args: { p_check_out_at?: string; p_visit_id: string }
        Returns: undefined
      }
      haversine_m: {
        Args: { lat1: number; lat2: number; lng1: number; lng2: number }
        Returns: number
      }
      is_monitor_role: { Args: never; Returns: boolean }
      is_under1_bracket: { Args: { p: string }; Returns: boolean }
      is_valid_age_bracket: { Args: { p: string }; Returns: boolean }
      live_positions: {
        Args: never
        Returns: {
          attendance_id: string
          clock_in_at: string
          lat: number
          lng: number
          recorded_at: string
          user_id: string
        }[]
      }
      management_summary: {
        Args: { p_from: string; p_store_ids?: string[]; p_to: string }
        Returns: Json
      }
      mark_messages_read: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      max_offline_age: { Args: never; Returns: string }
      normalize_wa: { Args: { p: string }; Returns: string }
      ntg_stage_rank: { Args: { p: string }; Returns: number }
      report_created_at: {
        Args: { p_report_id: string; p_report_type: string }
        Returns: string
      }
      report_visit_id: {
        Args: { p_report_id: string; p_report_type: string }
        Returns: string
      }
      run_scheduled_scorecards: { Args: never; Returns: undefined }
      save_consumer_with_step: {
        Args: { p_consumer: Json; p_is_new: boolean; p_step: Json }
        Returns: undefined
      }
      schedule_visit: {
        Args: { p_day: string; p_nc_id: string; p_store_id: string }
        Returns: string
      }
      set_my_push_token: { Args: { p_token: string }; Returns: undefined }
      visit_is_own: { Args: { v_visit_id: string }; Returns: boolean }
      visit_is_own_for_store: {
        Args: { v_store_id: string; v_visit_id: string }
        Returns: boolean
      }
      visit_is_own_or_scoped: { Args: { v_visit_id: string }; Returns: boolean }
      visit_last_activity: { Args: { p_visit_id: string }; Returns: string }
      visit_valid_radius_m: { Args: never; Returns: number }
      wib_day_start: { Args: { p: string }; Returns: string }
      work_days_between: {
        Args: { p_from: string; p_to: string }
        Returns: number
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
