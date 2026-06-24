import { index as WarehouseTransferDetailDrawer } from '@/containers/Drawers/WarehouseTransferDetailDrawer';
import { DRAWERS } from '@/constants/drawers';

export function WarehouseTransfersListDrawers() {
  return (
    <>
      <WarehouseTransferDetailDrawer
        name={DRAWERS.WAREHOUSE_TRANSFER_DETAILS}
      />
    </>
  );
}
