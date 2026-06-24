import { ExpenseBulkDeleteDialog } from '@/containers/Dialogs/Expenses/ExpenseBulkDeleteDialog';
import { DialogsName } from '@/constants/dialogs';

export function ExpensesListDialogs() {
  return (
    <>
      <ExpenseBulkDeleteDialog dialogName={DialogsName.ExpenseBulkDelete} />
    </>
  );
}
