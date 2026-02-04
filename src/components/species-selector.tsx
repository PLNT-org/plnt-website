'use client'

import { useState, useRef, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Leaf, Search, ChevronDown, X, Check } from 'lucide-react'

interface Species {
  id: string
  name: string
  scientific_name?: string
  category?: string
}

interface SpeciesSelectorProps {
  species: Species[]
  selectedId: string
  onSelect: (id: string) => void
  placeholder?: string
  disabled?: boolean
}

export function SpeciesSelector({
  species,
  selectedId,
  onSelect,
  placeholder = 'Search or select a species...',
  disabled = false,
}: SpeciesSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selectedSpecies = species.find((s) => s.id === selectedId)

  // Filter species based on search
  const filteredSpecies = species.filter((s) => {
    if (!searchQuery) return true
    const query = searchQuery.toLowerCase()
    return (
      s.name.toLowerCase().includes(query) ||
      s.scientific_name?.toLowerCase().includes(query) ||
      s.category?.toLowerCase().includes(query)
    )
  })

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
        setSearchQuery('')
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false)
      setSearchQuery('')
    } else if (e.key === 'Enter' && filteredSpecies.length === 1) {
      onSelect(filteredSpecies[0].id)
      setIsOpen(false)
      setSearchQuery('')
    }
  }

  const handleSelect = (id: string) => {
    onSelect(id)
    setIsOpen(false)
    setSearchQuery('')
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onSelect('')
    setSearchQuery('')
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger / Selected Display */}
      <div
        className={`flex items-center border rounded-md bg-white ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-gray-400'
        } ${isOpen ? 'border-green-500 ring-1 ring-green-500' : 'border-gray-300'}`}
        onClick={() => !disabled && setIsOpen(true)}
      >
        {isOpen ? (
          <div className="flex-1 flex items-center">
            <Search className="h-4 w-4 text-gray-400 ml-3" />
            <Input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
              autoFocus
              disabled={disabled}
            />
          </div>
        ) : (
          <div className="flex-1 flex items-center px-3 py-2 min-h-[40px]">
            {selectedSpecies ? (
              <div className="flex items-center gap-2 flex-1">
                <Leaf className="h-4 w-4 text-green-600 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{selectedSpecies.name}</span>
                  {selectedSpecies.scientific_name && (
                    <span className="text-gray-500 text-sm ml-2 italic hidden sm:inline">
                      {selectedSpecies.scientific_name}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <span className="text-gray-500">{placeholder}</span>
            )}
          </div>
        )}

        <div className="flex items-center gap-1 pr-2">
          {selectedSpecies && !isOpen && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 hover:bg-gray-100"
              onClick={handleClear}
              disabled={disabled}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
          <ChevronDown
            className={`h-4 w-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </div>
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-auto">
          {filteredSpecies.length === 0 ? (
            <div className="px-3 py-6 text-center text-gray-500">
              <Leaf className="h-8 w-8 mx-auto mb-2 text-gray-300" />
              <p className="text-sm">No species found</p>
              {searchQuery && (
                <p className="text-xs mt-1">Try a different search term</p>
              )}
            </div>
          ) : (
            <ul className="py-1">
              {filteredSpecies.map((s) => (
                <li
                  key={s.id}
                  className={`px-3 py-2 cursor-pointer flex items-center gap-2 ${
                    s.id === selectedId
                      ? 'bg-green-50 text-green-700'
                      : 'hover:bg-gray-50'
                  }`}
                  onClick={() => handleSelect(s.id)}
                >
                  <Leaf className={`h-4 w-4 flex-shrink-0 ${
                    s.id === selectedId ? 'text-green-600' : 'text-gray-400'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{s.name}</div>
                    <div className="text-xs text-gray-500 flex items-center gap-2">
                      {s.scientific_name && (
                        <span className="italic truncate">{s.scientific_name}</span>
                      )}
                      {s.category && (
                        <span className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">
                          {s.category}
                        </span>
                      )}
                    </div>
                  </div>
                  {s.id === selectedId && (
                    <Check className="h-4 w-4 text-green-600 flex-shrink-0" />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
