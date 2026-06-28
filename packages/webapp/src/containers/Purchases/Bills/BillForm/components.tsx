// @ts-nocheck
import React from 'react';
import intl from 'react-intl-universal';
import { Button } from '@blueprintjs/core';
import { useFormikContext } from 'formik';
import { ExchangeRateInputGroup } from '@/components';
import { useCurrentOrganizationBaseCurrency } from '@/hooks/query';
import { useBillIsForeignCustomer } from './utils';

/**
 * bill exchange rate input field.
 * @returns {JSX.Element}
 */
export function BillExchangeRateInputField({ ...props }) {
  const baseCurrency = useCurrentOrganizationBaseCurrency();
  const { values } = useFormikContext();

  const isForeignCustomer = useBillIsForeignCustomer();

  // Can't continue if the customer is not foreign.
  if (!isForeignCustomer) {
    return null;
  }
  return (
    <ExchangeRateInputGroup
      fromCurrency={values.currencyCode}
      toCurrency={baseCurrency}
      {...props}
    />
  );
}

/**
 * bill project select.
 * @returns {JSX.Element}
 */
export function BillProjectSelectButton({ label }) {
  return <Button text={label ?? intl.get('select_project')} />;
}
