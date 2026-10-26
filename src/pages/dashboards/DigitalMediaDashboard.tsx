import { Images, Megaphone } from 'lucide-react'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { visibleMedia } from '../../lib/media'
import { isLive, workStatus } from '../../../supabase/media-rules.mjs'
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
  const flyers = items.filter((m) => m.internal && isLive(m) && (m.mediaType === 'FLYER' || m.mediaType === 'POSTER')).length + db.posts.filter((p) => p.kind === 'FLYER').length
  const posts = items.filter((m) => m.internal && isLive(m) && m.mediaType !== 'FLYER' && m.mediaType !== 'POSTER').length + db.posts.filter((p) => p.kind === 'POST').length
  const late = items.filter((m) => workStatus(m) === 'LATE').length
  return (
    <div>
      <TileGrid>
        <Tile to="/content?tab=FLYER" icon={Images} label="Flyers" desc="Published flyers & posters, with the team's flyers" tone="orange" badge={flyers} />
        <Tile to="/content?tab=POST" icon={Megaphone} label="Posts" desc="Published posts, images and videos" tone="violet" badge={posts} />
        {late > 0 && <Tile to="/digital-media" icon={Megaphone} label="Late media" desc="Past their assignment date" tone="red" badge={late} highlight />}
      </TileGrid>
      <div className="mt-6"><DigitalMedia /></div>
    </div>
  )
}
