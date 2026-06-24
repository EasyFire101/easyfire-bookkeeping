// @ts-nocheck
import React, { useEffect } from 'react';

import { DashboardPageContent } from '@/components';
import { TaxRatesLandingProvider } from '../containers/TaxRatesLandingProvider';
import { TaxRatesLandingActionsBar } from '../containers/TaxRatesLandingActionsBar';
import { TaxRatesLandingTable as TaxRatesDataTable } from '../containers/TaxRatesLandingTable';
import { TaxRatesLandingDrawers } from '../containers/TaxRatesLandingDrawers';

/**
 * Tax rates landing page.
 * @returns {JSX.Element}
 */
export function TaxRatesLanding() {
  return (
    <TaxRatesLandingProvider>
      <TaxRatesLandingActionsBar />
      <TaxRatesLandingDrawers />

      <DashboardPageContent>
        <TaxRatesDataTable />
      </DashboardPageContent>
    </TaxRatesLandingProvider>
  );
}
