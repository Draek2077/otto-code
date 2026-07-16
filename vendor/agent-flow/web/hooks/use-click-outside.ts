import { useEffect, type RefObject } from 'react'

/**
 * Hook that calls `onClose` when a mousedown event occurs outside the referenced element.
 * A short delay prevents the opening click from immediately triggering close.
 */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  delayMs = 50,
): void {
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick)
    }, delayMs)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [ref, onClose, delayMs])
}
