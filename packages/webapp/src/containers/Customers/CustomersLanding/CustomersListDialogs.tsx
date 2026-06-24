import { CustomerBulkDeleteDialog } from '@/containers/Dialogs/Customers/CustomerBulkDeleteDialog';
import { DialogsName } from '@/constants/dialogs';

export function CustomersListDialogs() {
  return (
    <>
      <CustomerBulkDeleteDialog dialogName={DialogsName.CustomerBulkDelete} />
    </>
  );
}
