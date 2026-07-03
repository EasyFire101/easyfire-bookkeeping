import React from 'react';
import { DrawerBody } from '@/components';
import { ExpenseDrawerProvider } from './ExpenseDrawerProvider';
import { ExpenseDrawerDetails } from './ExpenseDrawerDetails';

interface ExpenseDrawerContentProps {
  expenseId: number | undefined;
}

/**
 * Expense drawer content.
 */
export function ExpenseDrawerContent({ expenseId }: ExpenseDrawerContentProps) {
  return (
    <ExpenseDrawerProvider expenseId={expenseId}>
      <DrawerBody>
        <ExpenseDrawerDetails />
      </DrawerBody>
    </ExpenseDrawerProvider>
  );
}
