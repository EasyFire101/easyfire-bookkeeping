import React from 'react';
import type { ExcludedBankTransactionsListPage } from '@bigcapital/sdk-ts';
import { IntersectionObserver } from '@/components';
import { useAccountTransactionsContext } from '../AccountTransactionsProvider';
import { useExcludedBankTransactionsInfinity } from '@/hooks/query/banking';
import { useFlattenInfinityPages } from '@/hooks/utils';
import { withBanking } from '../../withBanking';
import type { WithBankingProps } from '../../withBanking';
import { compose } from '@/utils';
import type { ExcludedTransactionRow } from './_utils';

export interface ExcludedBankTransactionsContextValue {
  excludedBankTransactions: ExcludedTransactionRow[];
  isExcludedTransactionsLoading: boolean;
  isExcludedTransactionsFetching: boolean;
}

interface ExcludedBankTransactionsTableBootProps
  extends Pick<WithBankingProps, 'uncategorizedTransactionsFilter'> {
  children: React.ReactNode;
}

const ExcludedTransactionsContext = React.createContext<ExcludedBankTransactionsContextValue>(
  {} as ExcludedBankTransactionsContextValue,
);

/**
 * Account excluded transactions provider.
 */
function ExcludedBankTransactionsTableBootRoot({
  // #withBanking
  uncategorizedTransactionsFilter,

  // #ownProps
  children,
}: ExcludedBankTransactionsTableBootProps) {
  const { accountId } = useAccountTransactionsContext();

  // Fetches the excluded transactions.
  const {
    data: excludedTransactionsPage,
    isFetching: isExcludedTransactionsFetching,
    isLoading: isExcludedTransactionsLoading,
    isSuccess: isExcludedTransactionsSuccess,
    hasNextPage: hasExcludedTransactionsNextPage,
    fetchNextPage: fetchNextExcludedTransactionsPage,
  } = useExcludedBankTransactionsInfinity({
    pageSize: 50,
    accountId,
    minDate: uncategorizedTransactionsFilter?.fromDate || undefined,
    maxDate: uncategorizedTransactionsFilter?.toDate || undefined,
  });
  // Memorized the excluded bank transactions.
  const excludedBankTransactions = useFlattenInfinityPages<
    ExcludedBankTransactionsListPage,
    ExcludedTransactionRow
  >(
    isExcludedTransactionsSuccess ? excludedTransactionsPage : undefined,
    (page) => (page?.data ?? []) as ExcludedTransactionRow[],
  );
  // Handle the observer ineraction.
  const handleObserverInteract = React.useCallback(() => {
    if (
      !isExcludedTransactionsFetching &&
      hasExcludedTransactionsNextPage
    ) {
      fetchNextExcludedTransactionsPage();
    }
  }, [
    isExcludedTransactionsFetching,
    hasExcludedTransactionsNextPage,
    fetchNextExcludedTransactionsPage,
  ]);
  // Provider payload.
  const provider: ExcludedBankTransactionsContextValue = {
    excludedBankTransactions: excludedBankTransactions ?? [],
    isExcludedTransactionsFetching,
    isExcludedTransactionsLoading,
  };

  return (
    <ExcludedTransactionsContext.Provider value={provider}>
      {children}
      <IntersectionObserver onIntersect={handleObserverInteract} />
    </ExcludedTransactionsContext.Provider>
  );
}

const ExcludedBankTransactionsTableBoot = compose(
  withBanking(({ uncategorizedTransactionsFilter }) => ({
    uncategorizedTransactionsFilter,
  })),
)(ExcludedBankTransactionsTableBootRoot);

const useExcludedTransactionsBoot = () =>
  React.useContext(ExcludedTransactionsContext);

export { ExcludedBankTransactionsTableBoot, useExcludedTransactionsBoot };
