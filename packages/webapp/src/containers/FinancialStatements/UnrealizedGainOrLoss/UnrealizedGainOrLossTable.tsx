import React from 'react';
import intl from 'react-intl-universal';

import { FinancialSheet } from '@/components';

interface UnrealizedGainOrLossTableProps {
  companyName: string;
}

export function UnrealizedGainOrLossTable({
  companyName,
}: UnrealizedGainOrLossTableProps) {
  return (
    <FinancialSheet
      name="unrealized-gain-loss"
      companyName={companyName}
      sheetType={intl.get('unrealized_gain_or_loss.label')}
    ></FinancialSheet>
  );
}
