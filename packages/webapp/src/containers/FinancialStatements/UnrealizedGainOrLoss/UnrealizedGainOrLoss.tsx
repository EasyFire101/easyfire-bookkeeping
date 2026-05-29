import React from 'react';

import { FinancialStatement, DashboardPageContent } from '@/components';
import { UnrealizedGainOrLossProvider } from './UnrealizedGainOrLossProvider';
import { UnrealizedGainOrLossLoadingBar } from './components';

import { UnrealizedGainOrLossHeader } from './UnrealizedGainOrLossHeader';
import { UnrealizedGainOrLossActionsBar } from './UnrealizedGainOrLossActionsBar';

import { WithUnrealizedGainOrLossActionsProps } from './withUnrealizedGainOrLossActions';

type UnrealizedGainOrLossProps = {
  organizationName: string;
} & Pick<WithUnrealizedGainOrLossActionsProps, 'toggleUnrealizedGainOrLossFilterDrawer'>;

export function UnrealizedGainOrLoss({
  toggleUnrealizedGainOrLossFilterDrawer,
}: UnrealizedGainOrLossProps) {
  const handleFilterSubmit = (_filter: Record<string, unknown>) => {};

  React.useEffect(
    () => () => {
      toggleUnrealizedGainOrLossFilterDrawer(false);
    },
    [toggleUnrealizedGainOrLossFilterDrawer],
  );

  return (
    <UnrealizedGainOrLossProvider>
      <UnrealizedGainOrLossActionsBar />
      <DashboardPageContent>
        <FinancialStatement>
          <UnrealizedGainOrLossHeader
            pageFilter={{}}
            onSubmitFilter={handleFilterSubmit}
          />

          <UnrealizedGainOrLossLoadingBar />
        </FinancialStatement>
      </DashboardPageContent>
    </UnrealizedGainOrLossProvider>
  );
}
