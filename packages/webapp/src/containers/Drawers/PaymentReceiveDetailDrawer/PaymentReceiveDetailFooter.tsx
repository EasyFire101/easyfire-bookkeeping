// @ts-nocheck
import React from 'react';

import {
  CommercialDocFooter,
  T,
  If,
  DetailsMenu,
  DetailItem,
} from '@/components';
import { usePaymentReceiveDetailContext } from './PaymentReceiveDetailProvider';
import intl from 'react-intl-universal';

/**
 * Payment receive detail footer.
 * @returns {React.JSX}
 */
export function PaymentReceiveDetailFooter() {
  const { paymentReceive } = usePaymentReceiveDetailContext();

  return (
    <CommercialDocFooter>
      <DetailsMenu direction={'horizantal'} minLabelSize={'180px'}>
        <If condition={paymentReceive.statement}>
          <DetailItem
            label={intl.get('payment_receive.details.statement')}
            multiline
          >
            {paymentReceive.statement}
          </DetailItem>
        </If>
      </DetailsMenu>
    </CommercialDocFooter>
  );
}
