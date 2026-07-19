import type { Settings } from './types'

/**
 * Prompt building. Hard-won lessons encoded here:
 * - SD/Flux-class models want a DESCRIPTION (subject + style), not instructions.
 * - Never mention text/letters/words in a positive prompt — small diffusion
 *   models can't process negation and will happily DRAW the word "text".
 * - Instruction-following models (Gemini/OpenAI) get a natural instruction.
 */

export function describePrompt(s: Settings, subject: string): string {
  return (subject ? subject + ', ' : '') + s.prompt
}

export function instructPrompt(s: Settings, subject: string): string {
  return (
    'Create an illustration of ' +
    (subject || 'the concept') +
    ' in this style: ' +
    s.prompt +
    '. Plain white background. Return only the image.'
  )
}
