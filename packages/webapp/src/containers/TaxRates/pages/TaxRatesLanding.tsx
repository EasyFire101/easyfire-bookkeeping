// @ts-nocheck
import React, { useEffect } from 'react';

import { DashboardPageContent } from '@/components';
import { TaxRatesLandingProvider } from '../containers/TaxRatesLandingProvider';
import { TaxRatesLandingActionsBar } from '../containers/TaxRatesLandingActionsBar';
import { TaxRatesLandingTable as TaxRatesDataTable } from '../containers/TaxRatesLandingTable';

/**
 * Tax rates landing page.
 * @returns {JSX.Element}
 */
export function TaxRatesLanding() {
  return (
    <TaxRatesLandingProvider>
      <TaxRatesLandingActionsBar />

      <DashboardPageContent>
        <TaxRatesDataTable />
      </DashboardPageContent>
    </TaxRatesLandingProvider>
  );
}
