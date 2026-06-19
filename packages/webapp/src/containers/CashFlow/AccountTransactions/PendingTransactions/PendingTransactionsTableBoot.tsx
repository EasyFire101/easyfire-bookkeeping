// @ts-nocheck
import React from 'react';
import { IntersectionObserver } from '@/components';
import { useAccountTransactionsContext } from '../AccountTransactionsProvider';
import { usePendingBankTransactionsInfinity } from '@/hooks/query/banking';
import { useFlattenInfinityPages } from '@/hooks/utils';

const PendingTransactionsContext = React.createContext();

/**
 * Account pending transctions provider.
 */
function PendingTransactionsBoot({ children }) {
  const { accountId } = useAccountTransactionsContext();

  // Fetches the pending transactions.
  const {
    data: pendingTransactionsPage,
    isFetching: isPendingTransactionFetching,
    isLoading: isPendingTransactionsLoading,
    isSuccess: isPendingTransactionsSuccess,
    isFetchingNextPage: isPendingTransactionFetchNextPage,
    fetchNextPage: fetchNextPendingTransactionsPage,
    hasNextPage: hasPendingTransactionsNextPage,
  } = usePendingBankTransactionsInfinity({
    account_id: accountId,
    page_size: 50,
  });
  // Memorized the cashflow account transactions.
  const pendingTransactions = useFlattenInfinityPages(
    isPendingTransactionsSuccess ? pendingTransactionsPage : undefined,
  );
  // Handle the observer ineraction.
  const handleObserverInteract = React.useCallback(() => {
    if (!isPendingTransactionFetching && hasPendingTransactionsNextPage) {
      fetchNextPendingTransactionsPage();
    }
  }, [
    isPendingTransactionFetching,
    hasPendingTransactionsNextPage,
    fetchNextPendingTransactionsPage,
  ]);
  // Provider payload.
  const provider = {
    pendingTransactions,
    isPendingTransactionFetching,
    isPendingTransactionsLoading,
  };

  return (
    <PendingTransactionsContext.Provider value={provider}>
      {children}
      <IntersectionObserver
        onIntersect={handleObserverInteract}
        enabled={!isPendingTransactionFetchNextPage}
      />
    </PendingTransactionsContext.Provider>
  );
}

const usePendingTransactionsContext = () =>
  React.useContext(PendingTransactionsContext);

export { PendingTransactionsBoot, usePendingTransactionsContext };
