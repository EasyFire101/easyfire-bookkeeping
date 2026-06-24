import { index as InventoryAdjustmentDetailDrawer } from '@/containers/Drawers/InventoryAdjustmentDetailDrawer';
import { DRAWERS } from '@/constants/drawers';

export function InventoryAdjustmentListDrawers() {
  return (
    <>
      <InventoryAdjustmentDetailDrawer
        name={DRAWERS.INVENTORY_ADJUSTMENT_DETAILS}
      />
    </>
  );
}
