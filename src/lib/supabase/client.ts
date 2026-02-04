// lib/supabase/client.ts
import { createClient } from '@supabase/supabase-js'

// These should be in your .env.local file
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Database types (generate these from Supabase)
export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          email: string
          company_name?: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          email: string
          company_name?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          company_name?: string
          updated_at?: string
        }
      }
      plots: {
        Row: {
          id: string
          user_id: string
          name: string
          plant_type?: string
          species_id?: string
          location?: any // JSON
          boundaries?: any // JSON/GeoJSON
          area_acres: number
          status?: 'active' | 'archived' | 'planning'
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          plant_type?: string
          species_id?: string
          location?: any
          boundaries?: any
          area_acres: number
          status?: 'active' | 'archived' | 'planning'
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          plant_type?: string
          species_id?: string
          location?: any
          boundaries?: any
          area_acres?: number
          status?: 'active' | 'archived' | 'planning'
          updated_at?: string
        }
      }
      flight_plans: {
        Row: {
          id: string
          user_id: string
          plot_id: string
          name: string
          drone_model: string
          altitude_m: number
          speed_ms: number
          overlap_percent: number
          waypoints?: any // JSON
          scheduled_for?: string
          status: 'draft' | 'scheduled' | 'completed' | 'cancelled'
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          plot_id: string
          name: string
          drone_model: string
          altitude_m: number
          speed_ms: number
          overlap_percent: number
          waypoints?: any
          scheduled_for?: string
          status?: 'draft' | 'scheduled' | 'completed' | 'cancelled'
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          drone_model?: string
          altitude_m?: number
          speed_ms?: number
          overlap_percent?: number
          waypoints?: any
          scheduled_for?: string
          status?: 'draft' | 'scheduled' | 'completed' | 'cancelled'
          updated_at?: string
        }
      }
      flights: {
        Row: {
          id: string
          flight_plan_id: string
          started_at: string
          completed_at?: string
          status: 'in_progress' | 'completed' | 'failed'
          images_captured: number
          weather_conditions?: any // JSON
          created_at: string
        }
        Insert: {
          id?: string
          flight_plan_id: string
          started_at?: string
          completed_at?: string
          status?: 'in_progress' | 'completed' | 'failed'
          images_captured?: number
          weather_conditions?: any
          created_at?: string
        }
        Update: {
          completed_at?: string
          status?: 'in_progress' | 'completed' | 'failed'
          images_captured?: number
          weather_conditions?: any
        }
      }
      plant_counts: {
        Row: {
          id: string
          flight_id: string
          count: number
          confidence: number
          processing_time_s: number
          density_map_url?: string
          individual_plants?: any // JSON array
          created_at: string
        }
        Insert: {
          id?: string
          flight_id: string
          count: number
          confidence: number
          processing_time_s: number
          density_map_url?: string
          individual_plants?: any
          created_at?: string
        }
        Update: {
          count?: number
          confidence?: number
          density_map_url?: string
          individual_plants?: any
        }
      }
      contacts: {
        Row: {
          id: string
          first_name: string
          last_name: string
          email: string
          nursery_name?: string
          nursery_size?: string
          message?: string
          status: 'new' | 'contacted' | 'archived'
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          first_name: string
          last_name: string
          email: string
          nursery_name?: string
          nursery_size?: string
          message?: string
          status?: 'new' | 'contacted' | 'archived'
          created_at?: string
          updated_at?: string
        }
        Update: {
          first_name?: string
          last_name?: string
          email?: string
          nursery_name?: string
          nursery_size?: string
          message?: string
          status?: 'new' | 'contacted' | 'archived'
          updated_at?: string
        }
      }
      orthomosaics: {
        Row: {
          id: string
          flight_id: string
          user_id: string
          name: string
          webodm_task_id?: string
          webodm_project_id?: string
          orthomosaic_url?: string
          bounds?: {
            north: number
            south: number
            east: number
            west: number
          }
          resolution_cm?: number
          image_width?: number
          image_height?: number
          status: 'pending' | 'processing' | 'completed' | 'failed'
          error_message?: string
          aruco_detection_status?: 'pending' | 'processing' | 'completed' | 'failed'
          aruco_count?: number
          aruco_detected_at?: string
          aruco_error_message?: string
          created_at: string
          updated_at: string
          completed_at?: string
        }
        Insert: {
          id?: string
          flight_id: string
          user_id: string
          name: string
          webodm_task_id?: string
          webodm_project_id?: string
          orthomosaic_url?: string
          bounds?: any
          resolution_cm?: number
          image_width?: number
          image_height?: number
          status?: 'pending' | 'processing' | 'completed' | 'failed'
          error_message?: string
          aruco_detection_status?: 'pending' | 'processing' | 'completed' | 'failed'
          aruco_count?: number
          aruco_detected_at?: string
          aruco_error_message?: string
          created_at?: string
          updated_at?: string
          completed_at?: string
        }
        Update: {
          name?: string
          webodm_task_id?: string
          webodm_project_id?: string
          orthomosaic_url?: string
          bounds?: any
          resolution_cm?: number
          image_width?: number
          image_height?: number
          status?: 'pending' | 'processing' | 'completed' | 'failed'
          error_message?: string
          aruco_detection_status?: 'pending' | 'processing' | 'completed' | 'failed'
          aruco_count?: number
          aruco_detected_at?: string
          aruco_error_message?: string
          updated_at?: string
          completed_at?: string
        }
      }
      plant_labels: {
        Row: {
          id: string
          orthomosaic_id: string
          user_id?: string
          latitude: number
          longitude: number
          pixel_x?: number
          pixel_y?: number
          source: 'manual' | 'ai'
          confidence?: number
          label: string
          notes?: string
          verified: boolean
          verified_at?: string
          verified_by?: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          orthomosaic_id: string
          user_id?: string
          latitude: number
          longitude: number
          pixel_x?: number
          pixel_y?: number
          source?: 'manual' | 'ai'
          confidence?: number
          label?: string
          notes?: string
          verified?: boolean
          verified_at?: string
          verified_by?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          latitude?: number
          longitude?: number
          pixel_x?: number
          pixel_y?: number
          source?: 'manual' | 'ai'
          confidence?: number
          label?: string
          notes?: string
          verified?: boolean
          verified_at?: string
          verified_by?: string
          updated_at?: string
        }
      }
      aruco_markers: {
        Row: {
          id: string
          orthomosaic_id: string
          user_id?: string
          marker_id: number
          dictionary: string
          latitude: number
          longitude: number
          pixel_x?: number
          pixel_y?: number
          confidence?: number
          corner_pixels?: number[][]
          corner_coords?: number[][]
          rotation_deg?: number
          verified: boolean
          verified_at?: string
          verified_by?: string
          detected_at: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          orthomosaic_id: string
          user_id?: string
          marker_id: number
          dictionary?: string
          latitude: number
          longitude: number
          pixel_x?: number
          pixel_y?: number
          confidence?: number
          corner_pixels?: number[][]
          corner_coords?: number[][]
          rotation_deg?: number
          verified?: boolean
          verified_at?: string
          verified_by?: string
          detected_at?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          marker_id?: number
          dictionary?: string
          latitude?: number
          longitude?: number
          pixel_x?: number
          pixel_y?: number
          confidence?: number
          corner_pixels?: number[][]
          corner_coords?: number[][]
          rotation_deg?: number
          verified?: boolean
          verified_at?: string
          verified_by?: string
          updated_at?: string
        }
      }
      species: {
        Row: {
          id: string
          user_id?: string
          name: string
          scientific_name?: string
          barcode_value?: string
          category?: string
          container_size?: string
          notes?: string
          photo_url?: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id?: string
          name: string
          scientific_name?: string
          barcode_value?: string
          category?: string
          container_size?: string
          notes?: string
          photo_url?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          scientific_name?: string
          barcode_value?: string
          category?: string
          container_size?: string
          notes?: string
          photo_url?: string
          updated_at?: string
        }
      }
      marker_registrations: {
        Row: {
          id: string
          user_id?: string
          aruco_marker_id: number
          aruco_dictionary: string
          species_id?: string
          barcode_value?: string
          latitude: number
          longitude: number
          gps_accuracy_meters?: number
          plot_name?: string
          notes?: string
          is_active: boolean
          registered_at: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id?: string
          aruco_marker_id: number
          aruco_dictionary?: string
          species_id?: string
          barcode_value?: string
          latitude: number
          longitude: number
          gps_accuracy_meters?: number
          plot_name?: string
          notes?: string
          is_active?: boolean
          registered_at?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          aruco_marker_id?: number
          aruco_dictionary?: string
          species_id?: string
          barcode_value?: string
          latitude?: number
          longitude?: number
          gps_accuracy_meters?: number
          plot_name?: string
          notes?: string
          is_active?: boolean
          updated_at?: string
        }
      }
    }
  }
}

// Helper functions for common operations
export const dbHelpers = {
  // Get user's plots
  async getUserPlots(userId: string) {
    const { data, error } = await supabase
      .from('plots')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    
    if (error) throw error
    return data
  },

  // Get plot with latest flight info
  async getPlotWithFlights(plotId: string, userId: string) {
    const { data: plot, error: plotError } = await supabase
      .from('plots')
      .select(`
        *,
        flight_plans (
          id,
          name,
          scheduled_for,
          status,
          flights (
            id,
            started_at,
            completed_at,
            status,
            images_captured,
            plant_counts (
              count,
              confidence
            )
          )
        )
      `)
      .eq('id', plotId)
      .eq('user_id', userId)
      .single()
    
    if (plotError) throw plotError
    return plot
  },

  // Create a new plot
  async createPlot(plot: Database['public']['Tables']['plots']['Insert']) {
    const { data, error } = await supabase
      .from('plots')
      .insert(plot)
      .select()
      .single()
    
    if (error) throw error
    return data
  },

  // Create a flight plan
  async createFlightPlan(plan: Database['public']['Tables']['flight_plans']['Insert']) {
    const { data, error } = await supabase
      .from('flight_plans')
      .insert(plan)
      .select()
      .single()
    
    if (error) throw error
    return data
  },

  // Upload images to storage
  async uploadImage(file: File, path: string) {
    const { data, error } = await supabase.storage
      .from('flight-images')
      .upload(path, file)
    
    if (error) throw error
    return data
  },

  // Get signed URL for private images
  async getImageUrl(path: string) {
    const { data, error } = await supabase.storage
      .from('flight-images')
      .createSignedUrl(path, 3600) // 1 hour expiry

    if (error) throw error
    return data.signedUrl
  },

  // Get user's orthomosaics
  async getUserOrthomosaics(userId: string) {
    const { data, error } = await supabase
      .from('orthomosaics')
      .select(`
        *,
        flights (
          id,
          started_at,
          flight_plans (
            name,
            plots (
              name
            )
          )
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (error) throw error
    return data
  },

  // Get orthomosaic by ID with labels
  async getOrthomosaicWithLabels(orthomosaicId: string) {
    const { data: orthomosaic, error: orthoError } = await supabase
      .from('orthomosaics')
      .select('*')
      .eq('id', orthomosaicId)
      .single()

    if (orthoError) throw orthoError

    const { data: labels, error: labelsError } = await supabase
      .from('plant_labels')
      .select('*')
      .eq('orthomosaic_id', orthomosaicId)
      .order('created_at', { ascending: false })

    if (labelsError) throw labelsError

    return { orthomosaic, labels }
  },

  // Get labels for an orthomosaic
  async getPlantLabels(orthomosaicId: string, options?: { source?: 'manual' | 'ai', verified?: boolean }) {
    let query = supabase
      .from('plant_labels')
      .select('*')
      .eq('orthomosaic_id', orthomosaicId)
      .order('created_at', { ascending: false })

    if (options?.source) {
      query = query.eq('source', options.source)
    }
    if (options?.verified !== undefined) {
      query = query.eq('verified', options.verified)
    }

    const { data, error } = await query
    if (error) throw error
    return data
  },

  // Create a plant label
  async createPlantLabel(label: {
    orthomosaic_id: string
    user_id?: string
    latitude: number
    longitude: number
    pixel_x?: number
    pixel_y?: number
    source: 'manual' | 'ai'
    confidence?: number
    label?: string
    notes?: string
  }) {
    const { data, error } = await supabase
      .from('plant_labels')
      .insert({
        ...label,
        verified: label.source === 'manual',
      })
      .select()
      .single()

    if (error) throw error
    return data
  },

  // Update a plant label
  async updatePlantLabel(labelId: string, updates: {
    label?: string
    notes?: string
    verified?: boolean
    verified_by?: string
  }) {
    const { data, error } = await supabase
      .from('plant_labels')
      .update({
        ...updates,
        verified_at: updates.verified ? new Date().toISOString() : null,
      })
      .eq('id', labelId)
      .select()
      .single()

    if (error) throw error
    return data
  },

  // Delete a plant label
  async deletePlantLabel(labelId: string) {
    const { error } = await supabase
      .from('plant_labels')
      .delete()
      .eq('id', labelId)

    if (error) throw error
  },

  // Get label statistics for an orthomosaic
  async getLabelStats(orthomosaicId: string) {
    const { data, error } = await supabase
      .from('plant_labels')
      .select('source, label, verified')
      .eq('orthomosaic_id', orthomosaicId)

    if (error) throw error

    const stats = {
      total: data.length,
      manual: data.filter(l => l.source === 'manual').length,
      ai: data.filter(l => l.source === 'ai').length,
      verified: data.filter(l => l.verified).length,
      unverified: data.filter(l => !l.verified).length,
      byLabel: {} as Record<string, number>,
    }

    data.forEach(l => {
      stats.byLabel[l.label] = (stats.byLabel[l.label] || 0) + 1
    })

    return stats
  },
}