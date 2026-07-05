// @ts-nocheck
import React, { useEffect } from 'react';
import intl from 'react-intl-universal';
import { CurrenciesDataTable } from './CurrenciesDataTable';
import { CurrenciesProvider } from './CurrenciesProvider';
import { withDashboardActions } from '@/containers/Dashboard/withDashboardActions';
import { compose } from '@/utils';

function CurrenciesListInner({
  // #withDashboardActions
  changePreferencesPageTitle,
}) {
  useEffect(() => {
    changePreferencesPageTitle(intl.get('currencies'));
  }, [changePreferencesPageTitle]);

  return (
    <CurrenciesProvider>
      <CurrenciesDataTable />
    </CurrenciesProvider>
  );
}

export const CurrenciesList =
  compose(withDashboardActions)(CurrenciesListInner);
