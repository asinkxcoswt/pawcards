#!/usr/bin/env bun
/**
 * Generate PawCards app icons/favicon from the brand paw mark (accent square +
 * cream paw). Run:  bun scripts/gen-icons.ts
 * Writes public/pawcards-icon{,-192,-512}.png + favicon.png + icon.svg.
 */
import { Resvg } from '@resvg/resvg-js'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ACCENT = '#e8663c'
const CREAM = '#fbfaf7'

// full-bleed square (iOS rounds it) + centered paw
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${ACCENT}"/>
  <ellipse cx="256" cy="322" rx="120" ry="95" fill="${CREAM}"/>
  <circle cx="138" cy="212" r="43" fill="${CREAM}"/>
  <circle cx="212" cy="150" r="47" fill="${CREAM}"/>
  <circle cx="300" cy="150" r="47" fill="${CREAM}"/>
  <circle cx="374" cy="212" r="43" fill="${CREAM}"/>
</svg>`

const pub = join(import.meta.dir, '..', 'public')
const png = (size: number) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()

writeFileSync(join(pub, 'pawcards-icon-512.png'), png(512))
writeFileSync(join(pub, 'pawcards-icon-192.png'), png(192))
writeFileSync(join(pub, 'pawcards-icon.png'), png(180)) // apple-touch
writeFileSync(join(pub, 'favicon.png'), png(48))
writeFileSync(join(pub, 'pawcards-icon.svg'), svg) // crisp favicon for modern browsers
console.log('✓ icons written to public/')
