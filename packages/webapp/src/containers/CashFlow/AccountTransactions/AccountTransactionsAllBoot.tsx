// @ts-nocheck
import React from 'react';
import { IntersectionObserver } from '@/components';
import { useAccountTransactionsInfinity } from '@/hooks/query';
import { useFlattenInfinityPages } from '@/hooks/utils';
import { useAccountTransactionsContext } from './AccountTransactionsProvider';

const AccountTransactionsAllBootContext = React.createContext();

interface AccountTransactionsAllPoviderProps {
  children: React.ReactNode;
}

/**
 * Account transctions all provider.
 */
function AccountTransactionsAllProvider({
  children,
}: AccountTransactionsAllPoviderProps) {
  const { accountId } = useAccountTransactionsContext();

  // Fetch cashflow account transactions list
  const {
    data: cashflowTransactionsPages,
    isFetching: isCashFlowTransactionsFetching,
    isLoading: isCashFlowTransactionsLoading,
    isSuccess: isCashflowTransactionsSuccess,
    fetchNextPage: fetchNextTransactionsPage,
    isFetchingNextPage: isCashflowTransactionsFetchingNextPage,
    hasNextPage: hasCashflowTransactionsNextPgae,
  } = useAccountTransactionsInfinity(accountId, {
    page_size: 50,
    account_id: accountId,
  });
  // Memorized the cashflow account transactions.
  const cashflowTransactions = useFlattenInfinityPages(
    isCashflowTransactionsSuccess ? cashflowTransactionsPages : undefined,
    (page) => page.transactions,
  );
  // Handle the observer ineraction.
  const handleObserverInteract = React.useCallback(() => {
    if (!isCashFlowTransactionsFetching && hasCashflowTransactionsNextPgae) {
      fetchNextTransactionsPage();
    }
  }, [
    isCashFlowTransactionsFetching,
    hasCashflowTransactionsNextPgae,
    fetchNextTransactionsPage,
  ]);
  // Provider payload.
  const provider = {
    cashflowTransactions,
    isCashFlowTransactionsFetching,
    isCashFlowTransactionsLoading,
  };

  return (
    <AccountTransactionsAllBootContext.Provider value={provider}>
      {children}
      <IntersectionObserver
        onIntersect={handleObserverInteract}
        enabled={!isCashflowTransactionsFetchingNextPage}
      />
    </AccountTransactionsAllBootContext.Provider>
  );
}

const useAccountTransactionsAllContext = () =>
  React.useContext(AccountTransactionsAllBootContext);

export { AccountTransactionsAllProvider, useAccountTransactionsAllContext };
