// Marketing mockup of the inventory drawer from the gated client share link
// (see src/components/shared-property-map.tsx). Same columns and chrome, but
// the rows below are INVENTORY DATA, not a real survey. Counts sum to 20,776,
// matching the "plants counted" badge on the sample map image.
import { Table2, Download, Maximize2, ChevronRight, Crosshair } from "lucide-react"

const ROWS = [
  { species: "Live Oak", size: 45, count: 1284, ready: "Mar 15, 2027" },
  { species: "Live Oak", size: 25, count: 2140, ready: "Sep 1, 2026" },
  { species: "Sabal Palm", size: 25, count: 1860, ready: "Nov 12, 2026" },
  { species: "Southern Magnolia", size: 45, count: 742, ready: "Apr 2, 2027" },
  { species: "Crape Myrtle", size: 15, count: 3410, ready: "Jun 18, 2026" },
  { species: "Podocarpus", size: 15, count: 4225, ready: "Aug 5, 2026" },
  { species: "Silver Buttonwood", size: 15, count: 1975, ready: "Oct 20, 2026" },
  { species: "Bald Cypress", size: 25, count: 968, ready: "Feb 9, 2027" },
  { species: "Simpson's Stopper", size: 7, count: 2530, ready: "Jul 7, 2026" },
  { species: "Green Buttonwood", size: 7, count: 1642, ready: "May 22, 2027" },
]

export default function InventoryMockup() {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Drawer header — mirrors the share link's inventory sheet */}
      <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2.5">
        <Table2 className="h-4 w-4 shrink-0 text-[#0f2e1d]" />
        <span className="text-sm font-semibold text-gray-900">Inventory</span>
        <span className="text-xs tabular-nums text-gray-400">{ROWS.length} lines</span>
        <div className="ml-auto flex items-center gap-1 text-gray-300">
          <Download className="h-4 w-4" />
          <Maximize2 className="h-4 w-4" />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Species</th>
              <th className="px-3 py-2 text-left font-medium">Size</th>
              <th className="px-3 py-2 text-right font-medium">Count</th>
              <th className="whitespace-nowrap px-3 py-2 text-left font-medium">Readiness Date</th>
              <th className="w-10 px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {ROWS.map((r) => (
              <tr key={`${r.species}-${r.size}`} className="hover:bg-gray-50">
                <td className="whitespace-nowrap px-3 py-2 text-gray-900">
                  <span className="inline-flex items-center gap-1.5">
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                    {r.species}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-700">{r.size}-Gallon</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900">
                  {r.count.toLocaleString()}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-700">{r.ready}</td>
                <td className="px-3 py-2 text-right">
                  <Crosshair className="ml-auto h-3.5 w-3.5 text-gray-300" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
