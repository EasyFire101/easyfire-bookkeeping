// @ts-nocheck
import React from 'react';
import { useFormikContext } from 'formik';
import {
  Money,

  PageForm,
  PageFormBigNumber,
} from '@/components';

import { PaymentMadeFormHeaderFields } from './PaymentMadeFormHeaderFields';
import { usePaymentmadeTotalAmount } from './utils';
import intl from 'react-intl-universal';

/**
 * Payment made header form.
 */
export function PaymentMadeFormHeader() {
  // Formik form context.
  const {
    values: { currency_code },
  } = useFormikContext();

  const totalAmount = usePaymentmadeTotalAmount();

  return (
    <PageForm.Header>
      <PaymentMadeFormHeaderFields />
      <PageFormBigNumber
        label={intl.get('amount_received')}
        amount={<Money amount={totalAmount} currency={currency_code} />}
      />
    </PageForm.Header>
  );
}
