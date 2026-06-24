import { ItemBulkDeleteDialog } from '@/containers/Dialogs/Items/ItemBulkDeleteDialog';
import { DialogsName } from '@/constants/dialogs';

export function ItemsListDialogs() {
  return (
    <>
      <ItemBulkDeleteDialog dialogName={DialogsName.ItemBulkDelete} />
    </>
  );
}
