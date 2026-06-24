import { index as ExpenseDrawer } from '@/containers/Drawers/ExpenseDrawer';
import { DRAWERS } from '@/constants/drawers';

export function ExpensesListDrawers() {
  return (
    <>
      <ExpenseDrawer name={DRAWERS.EXPENSE_DETAILS} />
    </>
  );
}
