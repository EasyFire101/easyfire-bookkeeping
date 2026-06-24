import { index as ItemDetailDrawer } from '@/containers/Drawers/ItemDetailDrawer';
import { DRAWERS } from '@/constants/drawers';

export function ItemsListDrawers() {
  return (
    <>
      <ItemDetailDrawer name={DRAWERS.ITEM_DETAILS} />
    </>
  );
}
