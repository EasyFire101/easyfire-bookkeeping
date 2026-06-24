import { VendorBulkDeleteDialog } from '@/containers/Dialogs/Vendors/VendorBulkDeleteDialog';
import { DialogsName } from '@/constants/dialogs';

export function VendorsListDialogs() {
  return (
    <>
      <VendorBulkDeleteDialog dialogName={DialogsName.VendorBulkDelete} />
    </>
  );
}
