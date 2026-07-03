import React from 'react';
import { useFormikContext } from 'formik';
import { Money, PageForm, PageFormBigNumber } from '@/components';

import { PaymentMadeFormHeaderFields } from './PaymentMadeFormHeaderFields';
import { usePaymentmadeTotalAmount, type PaymentMadeFormValues } from './utils';
import intl from 'react-intl-universal';

/**
 * Payment made header form.
 */
export function PaymentMadeFormHeader() {
  // Formik form context.
  const {
    values: { currencyCode },
  } = useFormikContext<PaymentMadeFormValues>();

  const totalAmount = usePaymentmadeTotalAmount();

  return (
    <PageForm.Header>
      <PaymentMadeFormHeaderFields />
      <PageFormBigNumber
        label={intl.get('amount_received')}
        amount={
          // PageFormBigNumber declares `amount: string | number` but renders
          // it inside an <h1>; passing a <Money> element works at runtime.
          (
            <Money amount={totalAmount} currency={currencyCode} />
          ) as unknown as number
        }
      />
    </PageForm.Header>
  );
}
