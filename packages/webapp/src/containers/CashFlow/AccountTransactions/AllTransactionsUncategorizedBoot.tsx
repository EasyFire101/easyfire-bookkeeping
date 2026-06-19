// @ts-nocheck

import React from 'react';
import * as R from 'ramda';
import { IntersectionObserver } from '@/components';
import { useAccountUncategorizedTransactionsInfinity } from '@/hooks/query';
import { useFlattenInfinityPages } from '@/hooks/utils';
import { useAccountTransactionsContext } from './AccountTransactionsProvider';
import { withBanking } from '../withBanking';

const AccountUncategorizedTransactionsContext = React.createContext();

/**
 * Account un-categorized transactions provider.
 */
function AccountUncategorizedTransactionsBootRoot({
  // #withBanking
  uncategorizedTransactionsFilter,

  // #ownProps
  children,
}) {
  const { accountId } = useAccountTransactionsContext();

  // Fetches the uncategorized transactions.
  const {
    data: uncategorizedTransactionsPage,
    isFetching: isUncategorizedTransactionFetching,
    isLoading: isUncategorizedTransactionsLoading,
    isSuccess: isUncategorizedTransactionsSuccess,
    isFetchingNextPage: isUncategorizedTransactionFetchNextPage,
    fetchNextPage: fetchNextUncategorizedTransactionsPage,
    hasNextPage: hasUncategorizedTransactionsNextPage,
  } = useAccountUncategorizedTransactionsInfinity(accountId, {
    page_size: 50,
    min_date: uncategorizedTransactionsFilter?.fromDate || null,
    max_date: uncategorizedTransactionsFilter?.toDate || null,
  });
  // Memorized the cashflow account transactions.
  const uncategorizedTransactions = useFlattenInfinityPages(
    isUncategorizedTransactionsSuccess ? uncategorizedTransactionsPage : undefined,
  );
  // Handle the observer ineraction.
  const handleObserverInteract = React.useCallback(() => {
    if (
      !isUncategorizedTransactionFetching &&
      hasUncategorizedTransactionsNextPage
    ) {
      fetchNextUncategorizedTransactionsPage();
    }
  }, [
    isUncategorizedTransactionFetching,
    hasUncategorizedTransactionsNextPage,
    fetchNextUncategorizedTransactionsPage,
  ]);
  // Provider payload.
  const provider = {
    uncategorizedTransactions,
    isUncategorizedTransactionFetching,
    isUncategorizedTransactionsLoading,
  };

  return (
    <AccountUncategorizedTransactionsContext.Provider value={provider}>
      {children}
      <IntersectionObserver
        onIntersect={handleObserverInteract}
        enabled={!isUncategorizedTransactionFetchNextPage}
      />
    </AccountUncategorizedTransactionsContext.Provider>
  );
}

const AccountUncategorizedTransactionsBoot = R.compose(
  withBanking(({ uncategorizedTransactionsFilter }) => ({
    uncategorizedTransactionsFilter,
  })),
)(AccountUncategorizedTransactionsBootRoot);

const useAccountUncategorizedTransactionsContext = () =>
  React.useContext(AccountUncategorizedTransactionsContext);

export {
  AccountUncategorizedTransactionsBoot,
  useAccountUncategorizedTransactionsContext,
};
