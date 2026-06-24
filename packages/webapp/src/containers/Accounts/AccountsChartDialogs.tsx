import { AccountBulkDeleteDialog } from '@/containers/Dialogs/Accounts/AccountBulkDeleteDialog';
import { DialogsName } from '@/constants/dialogs';

export function AccountsChartDialogs() {
  return (
    <>
      <AccountBulkDeleteDialog dialogName={DialogsName.AccountBulkDelete} />
    </>
  );
}
