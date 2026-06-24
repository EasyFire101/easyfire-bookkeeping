import { index as BillDrawer } from '@/containers/Drawers/BillDrawer';
import { index as ExpenseDrawer } from '@/containers/Drawers/ExpenseDrawer';
import { DRAWERS } from '@/constants/drawers';

export function BillsListDrawers() {
  return (
    <>
      <BillDrawer name={DRAWERS.BILL_DETAILS} />
      <ExpenseDrawer name={DRAWERS.EXPENSE_DETAILS} />
    </>
  );
}
