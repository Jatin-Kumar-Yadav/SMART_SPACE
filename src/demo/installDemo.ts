import { getRepository } from '@/database/repository'
import { DEMO_SPACE_ID, createSeminarHall } from '@/demo/seminarHall'
import { renderSpaceThumbnail } from '@/three/thumbnails'
import type { Space } from '@/types'

/** Create (or restore) the Seminar Hall demo project. */
export async function installDemo(): Promise<Space> {
  const demo = { ...createSeminarHall(), id: DEMO_SPACE_ID }
  try {
    demo.thumbnail = renderSpaceThumbnail(demo)
  } catch (e) {
    console.warn('demo thumbnail failed', e)
  }
  await getRepository().save(demo)
  return demo
}
