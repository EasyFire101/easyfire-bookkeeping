import React from 'react';
import { ExchangeRateMutedField } from '@/components';
import { useForeignAccount } from './utils';
import { useFormikContext } from 'formik';
import type { Account } from '@bigcapital/sdk-ts';
import { useMoneyInFieldsContext } from './MoneyInFieldsProvider';
import type { MoneyInFormValues } from './types';

export function MoneyInExchangeRateField() {
  const { account } = useMoneyInFieldsContext();
  const { values } = useFormikContext<MoneyInFormValues>();

  const isForeigAccount = useForeignAccount();

  if (!isForeigAccount) return null;

  return (
    <ExchangeRateMutedField
      name={'exchangeRate'}
      fromCurrency={values.currencyCode}
      toCurrency={(account as Account | undefined)?.currencyCode}
      formGroupProps={{ label: '', inline: false }}
      date={values.date}
      exchangeRate={values.exchangeRate}
    />
  );
}
