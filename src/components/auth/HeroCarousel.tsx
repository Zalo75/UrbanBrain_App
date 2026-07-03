'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'

const HERO_IMAGES = [
  '/images/Hero1.jpeg',
  '/images/Hero2.jpeg',
  '/images/Hero3.jpeg',
  '/images/Hero4.jpeg',
  '/images/Hero5.jpeg',
  '/images/Hero6.jpeg',
  '/images/Hero7.jpeg',
]

export function HeroCarousel() {
  const [currentIndex, setCurrentIndex] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % HERO_IMAGES.length)
    }, 8000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="relative z-10 w-full flex flex-col items-center">
      <div 
        className="relative aspect-video w-full overflow-hidden border border-zinc-700/50 shadow-2xl bg-zinc-900/50"
        style={{
          clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 60px), calc(100% - 60px) 100%, 0 100%)'
        }}
      >
        {HERO_IMAGES.map((src, index) => (
          <Image
            key={src}
            src={src}
            alt={`Arquitectura ${index + 1}`}
            fill
            priority={index === 0}
            loading={index === 0 ? undefined : 'lazy'}
            className={`object-cover transition-opacity duration-1000 ease-in-out ${
              index === currentIndex ? 'opacity-100' : 'opacity-0'
            }`}
          />
        ))}
      </div>
    </div>
  )
}
