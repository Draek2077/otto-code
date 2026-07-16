'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { TIMING } from '@/lib/agent-types'

interface GlassCardProps {
  children: ReactNode
  className?: string
  style?: React.CSSProperties
  visible: boolean
}

export function GlassCard({ children, className = '', style, visible }: GlassCardProps) {
  const [mounted, setMounted] = useState(false)
  const [animating, setAnimating] = useState(false)

  useEffect(() => {
    if (visible) {
      setMounted(true)
      requestAnimationFrame(() => setAnimating(true))
    } else {
      setAnimating(false)
      const timer = setTimeout(() => setMounted(false), TIMING.glassAnimMs)
      return () => clearTimeout(timer)
    }
  }, [visible])

  if (!mounted) return null

  return (
    <div
      className={`glass-card ${className}`}
      style={{
        ...style,
        opacity: animating ? 1 : 0,
        transform: animating ? 'scale(1)' : 'scale(0.95)',
        transition: 'opacity 0.2s ease-out, transform 0.2s ease-out',
      }}
    >
      {children}
    </div>
  )
}
