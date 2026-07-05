// @ts-nocheck
import { css } from '@emotion/css';
import React, { createContext } from 'react';
import { DashboardInsider } from '@/components/Dashboard';
import { Features } from '@/constants';
import { useProjects } from '@/containers/Projects/hooks';
import {
  useCurrencies,
  useCustomers,
  useExpense,
  useAccounts,
  useBranches,
  useCreateExpense,
  useEditExpense,
} from '@/hooks/query';
import { useFeatureCan } from '@/hooks/state';

const ExpenseFormPageContext = createContext();

/**
 * Accounts chart data provider.
 */
function ExpenseFormPageProvider({ query, expenseId, ...props }) {
  // Features guard.
  const { featureCan } = useFeatureCan();
  const isBranchFeatureCan = featureCan(Features.Branches);
  const isProjectsFeatureCan = featureCan(Features.Projects);

  const { data: currencies, isLoading: isCurrenciesLoading } = useCurrencies();

  // Fetches customers list.
  const { data: customersData, isLoading: isCustomersLoading } = useCustomers();

  // Fetch the expense details.
  const { data: expense, isLoading: isExpenseLoading } = useExpense(expenseId, {
    enabled: !!expenseId,
  });

  // Fetches the branches list.
  const {
    data: branches,
    isLoading: isBranchesLoading,
    isSuccess: isBranchesSuccess,
  } = useBranches(query, { enabled: isBranchFeatureCan });

  // Fetch accounts list.
  const { data: accounts, isLoading: isAccountsLoading } = useAccounts();

  // Fetch the  projects list.
  const { data: projectsData, isLoading: isProjectsLoading } = useProjects(
    {},
    { enabled: !!isProjectsFeatureCan },
  );

  // Create and edit expense mutate.
  const { mutateAsync: createExpenseMutate } = useCreateExpense();
  const { mutateAsync: editExpenseMutate } = useEditExpense();

  // Submit form payload - using ref for synchronous access.
  const submitPayloadRef = React.useRef({});

  // Setter to update the ref.
  const setSubmitPayload = React.useCallback((payload) => {
    submitPayloadRef.current = payload;
  }, []);

  // Detarmines whether the form in new mode.
  const isNewMode = !expenseId;

  // Provider payload.
  const provider = {
    isNewMode,
    expenseId,
    submitPayloadRef, // Expose ref for synchronous access

    currencies: currencies ?? [],
    customers: customersData?.data ?? [],
    expense,
    accounts: accounts ?? [],
    branches: branches ?? [],
    projects: projectsData?.projects ?? [],

    isCurrenciesLoading,
    isExpenseLoading,
    isCustomersLoading,
    isAccountsLoading,
    isBranchesSuccess,

    createExpenseMutate,
    editExpenseMutate,
    setSubmitPayload,
  };

  return (
    <DashboardInsider
      loading={
        isCurrenciesLoading ||
        isExpenseLoading ||
        isCustomersLoading ||
        isAccountsLoading ||
        isProjectsLoading
      }
      name={'expense-form'}
      className={css`
        min-height: calc(100vh - var(--top-offset));
        max-height: calc(100vh - var(--top-offset));
      `}
    >
      <ExpenseFormPageContext.Provider value={provider} {...props} />
    </DashboardInsider>
  );
}

const useExpenseFormContext = () => React.useContext(ExpenseFormPageContext);

export { ExpenseFormPageProvider, useExpenseFormContext };
