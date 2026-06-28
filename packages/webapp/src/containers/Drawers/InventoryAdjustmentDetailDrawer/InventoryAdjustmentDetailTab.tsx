import { CommercialDocBox } from '@/components';
import { InventoryAdjustmentDetailHeader } from './InventoryAdjustmentDetailHeader';
import { InventoryAdjustmentDetailTable } from './InventoryAdjustmentDetailTable';

export function InventoryAdjustmentDetailTab() {
  return (
    <CommercialDocBox>
      <InventoryAdjustmentDetailHeader />
      <InventoryAdjustmentDetailTable />
    </CommercialDocBox>
  );
}
