// @ts-nocheck
import React from 'react';
import { useFormikContext } from 'formik';
import { Classes } from '@blueprintjs/core';

import { If } from '@/components';
import { MoneyInContentFields } from './MoneyInContentFields';
import { TransactionTypeFields } from './TransactionTypeFields';
import { useMoneyInDailogContext } from './MoneyInDialogProvider';

/**
 * Money in form fields.
 */
export function MoneyInFormFields() {
  // Money in dialog context.
  const { defaultAccountId } = useMoneyInDailogContext();

  return (
    <div className={Classes.DIALOG_BODY}>
      {!defaultAccountId && <TransactionTypeFields />}
      <MoneyInContentFields />
    </div>
  );
}
