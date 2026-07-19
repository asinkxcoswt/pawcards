/**
 * Update prompt policy: only a MINOR or MAJOR version bump asks the user to
 * reload — patch releases stay silent (they arrive on the next natural
 * reload anyway, since index.html is served no-cache).
 */
export function needsUpdate(current: string, latest: string): boolean {
  const parse = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0)
  const [curMajor, curMinor] = parse(current)
  const [latMajor, latMinor] = parse(latest)
  return latMajor > curMajor || (latMajor === curMajor && latMinor > curMinor)
}
