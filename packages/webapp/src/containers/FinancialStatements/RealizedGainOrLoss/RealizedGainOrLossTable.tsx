import React from 'react';
import intl from 'react-intl-universal';

import { FinancialSheet } from '@/components';

interface RealizedGainOrLossTableProps {
  companyName: string;
}

export function RealizedGainOrLossTable({
  companyName,
}: RealizedGainOrLossTableProps) {
  return (
    <FinancialSheet
      name="realized-gain-loss"
      companyName={companyName}
      sheetType={intl.get('realized_gain_or_loss.label')}
    ></FinancialSheet>
  );
}
