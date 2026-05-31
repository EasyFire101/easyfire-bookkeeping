// @ts-nocheck
import React from 'react';

import { ExpenseFormHeader as ExpenseFormHeaderFields } from './ExpenseFormHeaderFields';
import { PageForm, PageFormBigNumber } from '@/components';
import { useExpenseTotalFormatted } from './utils';
import intl from 'react-intl-universal';

// Expense form header.
export function ExpenseFormHeader() {
  const totalFormatted = useExpenseTotalFormatted();

  return (
    <PageForm.Header>
      <ExpenseFormHeaderFields />
      <PageFormBigNumber
        label={intl.get('expense_amount')}
        amount={totalFormatted}
      />
    </PageForm.Header>
  );
}
