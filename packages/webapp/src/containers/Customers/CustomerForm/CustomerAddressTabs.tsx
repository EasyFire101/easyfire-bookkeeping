// @ts-nocheck
import React from 'react';
import { Row } from '@/components';

import CustomerBillingAddress from './CustomerBillingAddress';
import CustomerShippingAddress from './CustomerShippingAddress';

export default function CustomerAddressTabs() {
  return (
    <div className={'tab-panel--address'}>
      <Row>
        <CustomerBillingAddress />
        <CustomerShippingAddress />
      </Row>
    </div>
  );
}
