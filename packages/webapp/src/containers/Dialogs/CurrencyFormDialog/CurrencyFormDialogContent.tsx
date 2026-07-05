// @ts-nocheck
import React from 'react';
import { CurrencyForm } from './CurrencyForm';
import { CurrencyFormProvider } from './CurrencyFormProvider';
import { withCurrencyDetail } from '@/containers/Currencies/withCurrencyDetail';
import { compose } from '@/utils';
import '@/style/pages/Currency/CurrencyFormDialog.scss';

function CurrencyFormDialogContentInner({
  // #ownProp
  action,
  currencyCode,
  dialogName,
}) {
  return (
    <CurrencyFormProvider
      isEditMode={action}
      currency={currencyCode}
      dialogName={dialogName}
    >
      <CurrencyForm />
    </CurrencyFormProvider>
  );
}

export const CurrencyFormDialogContent = compose(withCurrencyDetail)(
  CurrencyFormDialogContentInner,
);
