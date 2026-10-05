import { PieMenu } from './PieMenu';
import { NO_SELECTION } from './pieGeometry';
import type { PieItem } from './pieMenuConfig';

/** A picture of a menu's main ring with nothing highlighted, for the help panel and README (MENU_PREVIEWS). */
export function PieMenuPreview({ items }: { items: PieItem[] }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="-112 -112 224 224">
      <PieMenu items={items} origin={[0, 0]} pointer={[0, 0]} selection={NO_SELECTION} />
    </svg>
  );
}
