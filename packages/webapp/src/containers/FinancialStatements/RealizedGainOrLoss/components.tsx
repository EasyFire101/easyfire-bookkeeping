import React from 'react';

import { If } from '@/components';

import { FinancialLoadingBar } from '../FinancialLoadingBar';

export function RealizedGainOrLossLoadingBar() {
  return (
    <If condition={false}>
      <FinancialLoadingBar />
    </If>
  );
}
