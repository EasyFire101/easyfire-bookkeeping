import React, { useMemo } from 'react';
import { useFormikContext } from 'formik';

import { OwnerContributionFormFields } from './OwnerContribution/OwnerContributionFormFields';
import { OtherIncomeFormFields } from './OtherIncome/OtherIncomeFormFields';
import { TransferFromAccountFormFields } from './TransferFromAccount/TransferFromAccountFormFields';
import { MoneyInFieldsProvider } from './MoneyInFieldsProvider';
import type { MoneyInFormValues } from './types';

/**
 * Money-in dialog content.
 * Switches between fields based on the given transaction type.
 */
export function MoneyInContentFields() {
  const { values } = useFormikContext<MoneyInFormValues>();

  const transactionFields = useMemo(() => {
    switch (values.transactionType) {
      case 'owner_contribution':
        return <OwnerContributionFormFields />;

      case 'other_income':
        return <OtherIncomeFormFields />;

      case 'transfer_from_account':
        return <TransferFromAccountFormFields />;
      default:
        break;
    }
  }, [values.transactionType]);

  // Cannot continue if transaction type or account is not selected.
  if (!values.transactionType || !values.cashflowAccountId) return null;

  return <MoneyInFieldsProvider>{transactionFields}</MoneyInFieldsProvider>;
}
