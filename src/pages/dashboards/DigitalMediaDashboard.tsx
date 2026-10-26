import { Images, Megaphone } from 'lucide-react'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { visibleMedia } from '../../lib/media'
import { workStatus } from '../../../supabase/media-rules.mjs'
import DigitalMedia from '../modules/DigitalMedia'
import { Tile, TileGrid } from './widgets'

/**
 * The Digital Media role's home: the Media Function itself, with the Flyers and Posts it feeds one click away
 * (published flyers / posters show under Flyers, the rest under Posts — the same records, never uploaded twice).
 */
export function DigitalMediaDashboard() {
  const db = useDb()
  const me = useMe()
  const items = visibleMedia(db, me)
  const flyers = items.filter((m) => m.mediaType === 'FLYER' || m.mediaType === 'POSTER').length
  const posts = items.filter((m) => m.mediaType === 'POST').length
  const late = items.filter((m) => workStatus(m) === 'LATE').length
  return (
    <div>
      <TileGrid>
        <Tile to="/media/posts" icon={Megaphone} label="Posts" desc="Every post created here" tone="violet" badge={posts} />
        <Tile to="/media/flyers" icon={Images} label="Flyers" desc="Every flyer and poster created here" tone="orange" badge={flyers} />
        {late > 0 && <Tile to="/digital-media" icon={Megaphone} label="Late media" desc="Past their assignment date" tone="red" badge={late} highlight />}
      </TileGrid>
      <div className="mt-6"><DigitalMedia /></div>
    </div>
  )
}
