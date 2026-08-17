'use client'

import Image from "next/image"
import Link from "next/link"
import ContactForm from '@/components/contact-form'
import { Button } from "@/components/ui/button"
import { ArrowRight, Check } from "lucide-react"
import InventoryMockup from "@/components/inventory-mockup"

// Self-serve booking was removed on purpose: we schedule by hand so we never
// hand out a slot we can't cover. Leads arrive via the contact form, which
// writes to `contacts` and emails CONTACT_NOTIFY_TO (see /api/contact).
// If it ever comes back, the Google booking page is:
//   https://calendar.app.google/EzArjLjqpx3t2DHaA   (add ?gv=true to embed)

// ─────────────────────────────────────────────────────────────
// Brand — matches the gated client share link (src/app/share/[token])
// #0f2e1d = deep forest green · #16452b = hover · #f6f8f5 = light band
// ─────────────────────────────────────────────────────────────

// Each card leads with a picture, not a paragraph. All three are crops of
// real survey output (see the full-size sources in public/images).
const SERVICES = [
  {
    image: "/images/detail-counts.webp",
    title: "Counts",
    body: "Every plant, by species and plot.",
  },
  {
    image: "/images/detail-height.webp",
    title: "Plant height",
    body: "Canopy height for every plant.",
  },
  {
    image: "/images/detail-health.webp",
    title: "Plant health maps",
    body: "Stress visible before you can see it.",
  },
]

// What the demo call actually covers.
const DETAILS = [
  "Recurring flight frequency",
  "Which blocks and plots to fly",
  "Species and container sizes to track",
  "Plant height",
  "Plant health maps",
  "Readiness dates for your sales team",
]

// One step in the stacked "How it works" scroll: centered title, wide visual.
function Step({
  number,
  title,
  blurb,
  children,
}: {
  number: string
  title: string
  blurb?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mx-auto max-w-2xl text-center">
        <div className="text-xs font-bold uppercase tracking-widest text-[#0f2e1d]/50">Step {number}</div>
        <h3 className="mt-3 text-3xl font-semibold leading-tight tracking-tight text-[#0f2e1d] sm:text-4xl">
          {title}
        </h3>
        {blurb && <p className="mt-4 text-gray-600">{blurb}</p>}
      </div>
      <div className="mt-10">{children}</div>
    </div>
  )
}

export default function PLNTHomepage() {
  return (
    <div className="min-h-screen bg-white text-[#0f2e1d] antialiased">
      {/* ───────── Header ───────── */}
      <header className="sticky top-0 z-50 border-b border-gray-200/70 bg-white/85 backdrop-blur-md">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <Link href="#home" className="flex items-center">
            <Image src="/images/plnt-logo.svg" alt="PLNT" width={140} height={46} className="h-10 w-auto" priority />
          </Link>
          <Link href="#how">
            <Button className="rounded-lg bg-[#0f2e1d] px-5 text-white hover:bg-[#16452b]">Get your inventory</Button>
          </Link>
        </div>
      </header>

      {/* ───────── Hero — aerial photo background, product shot on top ───────── */}
      <section id="home" className="relative isolate scroll-mt-24 overflow-hidden">
        {/* background: the counted-nursery aerial */}
        <Image
          src="/images/nursery-count.png"
          alt=""
          aria-hidden="true"
          fill
          priority
          quality={85}
          className="-z-20 object-cover"
          sizes="100vw"
        />
        {/* overlay: keeps the headline legible over a busy photo */}
        <div
          className="absolute inset-0 -z-10 bg-gradient-to-r from-[#0a2116]/95 via-[#0a2116]/80 to-[#0a2116]/45"
          aria-hidden="true"
        />

        <div className="container mx-auto grid items-center gap-14 px-4 py-24 lg:grid-cols-2 lg:py-32">
          <div>
            <h1 className="max-w-xl text-5xl font-semibold leading-[1.05] tracking-tight text-white sm:text-6xl">
              Drone-Based Inventory Management
            </h1>
            <p className="mt-6 max-w-lg text-xl leading-relaxed text-green-50/80">
              Precision Plant Counting &amp; Analytics for Nurseries
            </p>
            <div className="mt-10">
              <Link href="#how">
                <Button
                  size="lg"
                  className="rounded-lg bg-white px-8 text-[#0f2e1d] shadow-lg hover:bg-green-50"
                >
                  Get your inventory
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>

          {/* Product shot — the real client map */}
          <div className="overflow-hidden rounded-2xl border border-white/15 shadow-2xl">
            <Image
              src="/images/nursery-dashboard.png"
              alt="The PLNT client map: an aerial nursery survey with 20,776 counted plants, layer controls, and an inventory table"
              width={1671}
              height={941}
              className="h-auto w-full"
              priority
              sizes="(max-width: 1024px) 100vw, 576px"
            />
          </div>
        </div>
      </section>

      {/* ───────── Stat strip ───────── */}
      <section className="bg-[#0f2e1d] py-16 text-white">
        <div className="container mx-auto grid max-w-2xl grid-cols-2 gap-8 px-4 text-center">
          <div>
            <p className="text-4xl font-semibold text-white sm:text-5xl">500,000+</p>
            <p className="mt-2 text-xs uppercase tracking-wider text-green-200/70">Plants counted</p>
          </div>
          <div>
            <p className="text-4xl font-semibold text-white sm:text-5xl">
              ±98%
              <span className="align-super text-2xl text-green-200/80">*</span>
            </p>
            <p className="mt-2 text-xs uppercase tracking-wider text-green-200/70">Accuracy</p>
          </div>
        </div>
        <p className="mt-10 text-center text-xs text-green-200/50">*Nursery layout dependent.</p>
      </section>

      {/* ───────── How it works ───────── */}
      <section id="how" className="scroll-mt-24 bg-white py-24 sm:py-28">
        <div className="container mx-auto px-4">
          <h2 className="text-center text-3xl font-semibold tracking-tight text-[#0f2e1d] sm:text-4xl">
            How it works
          </h2>
          <div className="mx-auto mt-16 max-w-6xl space-y-24 sm:space-y-32">
            <Step
              number="01"
              title="Schedule a demo"
              blurb="Tell us about your nursery and we'll follow up with times that work."
            >
              <div className="mx-auto max-w-xl rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
                <ContactForm />
              </div>
            </Step>

            <Step
              number="02"
              title="Work out the details"
              blurb="On the call we set your flight schedule and exactly what to track."
            >
              <div className="mx-auto max-w-3xl rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wider text-[#0f2e1d]/50">
                  What we cover
                </p>
                <ul className="mt-5 grid gap-4 sm:grid-cols-2 sm:gap-x-10">
                  {DETAILS.map((d) => (
                    <li key={d} className="flex items-start gap-3 text-sm text-gray-700">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#0f2e1d]" strokeWidth={2.5} />
                      {d}
                    </li>
                  ))}
                </ul>
              </div>
            </Step>

            <Step number="03" title="Updated aerial maps and inventory in your inbox">
              <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-lg">
                <Image
                  src="/images/detail-inbox.webp"
                  alt="Sample PLNT deliverable: an aerial nursery map with every plant counted"
                  width={1085}
                  height={842}
                  className="h-auto w-full"
                  sizes="(max-width: 1152px) 100vw, 1152px"
                />
                <div className="border-t border-gray-200 p-4 sm:p-5">
                  <InventoryMockup />
                </div>
              </div>
            </Step>
          </div>
        </div>
      </section>

      {/* ───────── Services ───────── */}
      <section id="services" className="scroll-mt-24 border-y border-gray-200 bg-[#f6f8f5] py-24 sm:py-28">
        <div className="container mx-auto px-4">
          <h2 className="text-center text-3xl font-semibold tracking-tight text-[#0f2e1d] sm:text-4xl">
            What you get
          </h2>
          <div className="mx-auto mt-14 grid max-w-5xl gap-6 md:grid-cols-3">
            {SERVICES.map((s) => (
              <div
                key={s.title}
                className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
              >
                <div className="relative aspect-[4/3] w-full bg-[#12261c]">
                  <Image
                    src={s.image}
                    alt={s.title}
                    fill
                    className="object-cover"
                    sizes="(max-width: 768px) 100vw, 384px"
                  />
                </div>
                <div className="p-6">
                  <h3 className="text-lg font-semibold text-[#0f2e1d]">{s.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-gray-600">{s.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───────── Closing CTA — sends people back up to step 01 ───────── */}
      <section id="contact" className="scroll-mt-24 bg-white py-24 sm:py-28">
        <div className="container mx-auto px-4">
          <h2 className="text-center text-3xl font-semibold tracking-tight text-[#0f2e1d] sm:text-4xl">
            Get your inventory
          </h2>
          <p className="mx-auto mt-4 max-w-sm text-center text-gray-600">
            Tell us about your nursery. We&rsquo;ll take it from there.
          </p>
          <div className="mt-9 flex flex-col items-center gap-5">
            <Link href="#how">
              <Button size="lg" className="rounded-lg bg-[#0f2e1d] px-8 text-white hover:bg-[#16452b]">
                Book a demo
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <p className="text-sm text-gray-600">
              Or email{" "}
              <a
                href="mailto:porter@plnt.net"
                className="font-semibold text-[#0f2e1d] transition-colors hover:text-[#16452b]"
              >
                porter@plnt.net
              </a>
            </p>
          </div>
        </div>
      </section>

      {/* ───────── Footer ───────── */}
      <footer className="bg-[#0f2e1d] py-12 text-white">
        <div className="container mx-auto flex flex-col items-center justify-between gap-6 px-4 sm:flex-row">
          <div className="flex flex-col items-center gap-3 sm:items-start">
            <Image src="/images/plnt-logo-darkbg.svg" alt="PLNT" width={120} height={40} className="h-9 w-auto" />
            <p className="text-sm text-white/70">Grow with certainty.</p>
          </div>
          <div className="flex items-center gap-6 text-sm text-white/60">
            <a href="mailto:porter@plnt.net" className="transition-colors hover:text-white">
              porter@plnt.net
            </a>
          </div>
        </div>
        <div className="container mx-auto mt-10 border-t border-white/15 px-4 pt-6 text-center text-xs text-white/40">
          <p>&copy; 2024&ndash;2026 PLNT Network LLC. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
