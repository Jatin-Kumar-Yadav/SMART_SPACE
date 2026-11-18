import { useEffect, useState } from 'react'

export type Route = { kind: 'dashboard' } | { kind: 'editor'; id: string } | { kind: 'phone'; session: string }

const parse = (): Route => {
  const ph = /^#\/phone\/(.+)$/.exec(window.location.hash)
  if (ph) return { kind: 'phone', session: decodeURIComponent(ph[1]) }
  const m = /^#\/space\/(.+)$/.exec(window.location.hash)
  return m ? { kind: 'editor', id: decodeURIComponent(m[1]) } : { kind: 'dashboard' }
}

export const navigate = (route: Route) => {
  window.location.hash = route.kind === 'editor' ? `#/space/${encodeURIComponent(route.id)}` : route.kind === 'phone' ? `#/phone/${encodeURIComponent(route.session)}` : '#/'
}

/** Tiny hash router so a browser refresh reopens the same space. */
export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(parse)
  useEffect(() => {
    const h = () => setRoute(parse())
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [])
  return route
}
