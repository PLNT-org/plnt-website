# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start development server (localhost:3000)
npm run build        # Production build
npm run lint         # ESLint check
npm run start        # Start production server
```

## Architecture Overview

PLNT is a Next.js 14 App Router application for AI-powered plant nursery management. It enables drone survey planning, image uploads, plant counting via AI, and analytics dashboards.

**Tech Stack:** Next.js 14, TypeScript, Supabase (auth + PostgreSQL), Tailwind CSS, shadcn/ui, Leaflet/React-Leaflet, Recharts

### Directory Structure

```
src/
├── app/                    # Next.js App Router
│   ├── api/               # API routes (contact, process-images)
│   ├── auth/              # Sign in/up/callback pages
│   ├── dashboard/         # Protected authenticated routes
│   │   ├── admin/         # Admin-only routes (role-gated)
│   │   ├── analytics/     # Data visualization pages
│   │   ├── flight-planner/# Drone flight planning
│   │   ├── plots/         # Survey plot management
│   │   └── upload/        # Image upload processing
│   └── demo/              # Demo mode entry (no auth required)
├── components/
│   ├── ui/                # shadcn/ui components (Button, Card, Input, etc.)
│   └── *.tsx              # Feature components (maps, forms)
└── lib/
    ├── auth/              # Auth context, roles, protected route wrapper
    ├── supabase/          # Supabase client and DB helpers
    └── utils.ts           # cn() utility for Tailwind class merging
```

### Key Patterns

**Authentication Flow:**
- `AuthProvider` context wraps the app (`src/lib/auth/auth-context.tsx`)
- Middleware (`middleware.ts`) protects `/dashboard/*` routes
- Admin routes require `role: 'admin'` in `profiles` table
- Demo mode bypasses auth via `?demo=true` or `/demo` route

**Supabase Integration:**
- Client: `src/lib/supabase/client.ts` (browser, anon key)
- Server: API routes use `SUPABASE_SERVICE_ROLE_KEY` for admin operations
- Tables: `users`, `profiles`, `plots`, `flight_plans`, `flights`, `plant_counts`, `contacts`

**Leaflet Maps:**
- All map components use dynamic imports with `ssr: false` (Leaflet requires browser APIs)
- `EnhancedSatelliteMap`: Drawing polygons for plot boundaries
- `FlightPathPreviewMap`: Read-only waypoint visualization
- Icon fix applied in map components for missing default markers

**Demo Mode:**
- First-class feature integrated into auth context
- Pages check `isDemo` flag to use mock data instead of Supabase calls
- Persisted in localStorage

**UI Components:**
- shadcn/ui with Radix primitives in `src/components/ui/`
- Use `cn()` from `src/lib/utils.ts` for conditional class merging

### Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL      # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY # Public browser key
SUPABASE_SERVICE_ROLE_KEY     # Private server-side key (API routes only)
```

### Notes

- Build config ignores TypeScript and ESLint errors (`next.config.js`)
- Image processing API (`/api/process-images`) is currently mocked
- GeoJSON boundaries stored in `plots.boundaries` column